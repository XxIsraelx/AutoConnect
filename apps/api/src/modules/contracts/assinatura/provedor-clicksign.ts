import {
  BadGatewayException, BadRequestException, ConflictException, GatewayTimeoutException,
  HttpException, Logger, ServiceUnavailableException, UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  CabecalhosHttp, EnvelopeCriado, EventoDeAssinatura, NovoEnvelope,
  ProvedorDeAssinatura, SignerRoleValue, TipoEventoAssinatura, VerificacaoDoProvedor,
} from '@autoconnect/shared';
import { CABECALHO_HMAC, CABECALHO_HMAC_ALTERNATIVO, hmacConfere, sha256Hex } from './hmac';

/**
 * Adaptador da Clicksign, API 3.0 ("Envelope", JSON:API).
 *
 * Referência: https://developers.clicksign.com/reference/comece-agora
 *
 * Tudo o que é formato da Clicksign mora aqui. O resto do sistema vê só o
 * vocabulário de `ProvedorDeAssinatura`.
 *
 * ── Por que os metadados do documento ───────────────────────────────
 * O webhook da Clicksign é por **documento**: `document.key` é o id do
 * documento, não o do envelope — e o `idExterno` que o sistema guarda é o do
 * envelope (é ele que se cancela e de onde se baixa). A API deixa gravar
 * `metadata` no documento, "enviados com o documento nos webhooks para
 * facilitar a identificação" (Campos e Regras de Negócio do Documento). É por
 * ali que o envelope volta: o id dele e, para saber quem assinou, um mapa
 * `sha256(e-mail) → papel` — hash e não o e-mail, porque metadado não é lugar
 * de dado pessoal. Como o corpo inteiro passa pelo HMAC, os metadados que
 * voltam são tão confiáveis quanto o resto da entrega.
 */

const TIPO_JSONAPI = 'application/vnd.api+json';
const TIMEOUT_PADRAO_MS = 20_000;
/** O PDF assinado de um contrato tem centenas de KB; isto é só um teto contra resposta absurda. */
const PDF_MAXIMO_BYTES = 50 * 1024 * 1024;

/**
 * Qualificação ("assinar como") de cada parte. A tabela de qualificações da
 * Clicksign tem `seller` (Parte vendedora) e `buyer` (Parte compradora), que é
 * exatamente o que as partes são num contrato de compra e venda de veículo —
 * mais preciso que o genérico `party` e que `contractor`/`contractee`
 * (contratante/contratada), próprios de prestação de serviço.
 */
export const QUALIFICACAO_CLICKSIGN: Record<SignerRoleValue, string> = {
  dealer: 'seller',
  customer: 'buyer',
};

/** Nomes dos eventos de webhook (Eventos do Documento) → evento normalizado. */
export const EVENTOS_CLICKSIGN: Record<string, TipoEventoAssinatura> = {
  sign: 'assinou',
  refusal: 'recusou',
  // `auto_close` vem logo após a última assinatura; `document_closed` quando o
  // arquivo assinado está "pronto para download"; `close` é a finalização
  // manual no painel. Os três concluem: se o `auto_close` chegar antes de o
  // arquivo existir, `baixarAssinado` falha, o webhook responde 5xx e a
  // conclusão vem de novo — por ele mesmo ou pelo `document_closed`.
  auto_close: 'concluido',
  document_closed: 'concluido',
  close: 'concluido',
  deadline: 'expirou',
  cancel: 'cancelado',
};

const META_ENVELOPE = 'autoconnect_envelope';
const META_PAPEIS = 'autoconnect_papeis';

export interface ConfigClicksign {
  /** Base sem `/api/v3`, ex.: `https://sandbox.clicksign.com`. */
  apiUrl: string;
  token: string;
  /** O *secret* HMAC do webhook cadastrado na Clicksign. */
  segredoWebhook: string;
  timeoutMs?: number;
  /** Injetável para teste; o padrão é o `fetch` global do Node 20. */
  fetch?: typeof fetch;
}

interface RecursoJsonApi {
  id: string;
  type?: string;
  attributes?: Record<string, unknown>;
  links?: { self?: string; files?: Record<string, string | null | undefined> };
}

interface PayloadWebhook {
  event?: {
    name?: string;
    occurred_at?: string;
    data?: {
      signer?: { key?: string; email?: string };
      reached_at?: string;
    } | null;
  };
  document?: {
    key?: string;
    metadata?: unknown;
  };
}

/** Erro de chamada à Clicksign. A mensagem nunca carrega o token. */
export class ErroClicksign extends HttpException {
  constructor(
    mensagem: string,
    status: number,
    readonly statusClicksign?: number,
  ) {
    super(mensagem, status);
  }
}

export function hashDoEmail(email: string): string {
  return sha256Hex(Buffer.from(email.trim().toLowerCase())).slice(0, 32);
}

/** A Clicksign pede o CPF formatado (000.000.000-00). Fora de 11 dígitos, não manda. */
export function cpfFormatado(documento?: string): string | undefined {
  const d = documento?.replace(/\D/g, '');
  if (!d || d.length !== 11) return undefined;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function detalhesDoErro(corpo: unknown): string {
  const erros = (corpo as { errors?: unknown })?.errors;
  if (!Array.isArray(erros)) return '';
  return erros
    .map((e: { detail?: unknown; title?: unknown }) => String(e?.detail ?? e?.title ?? ''))
    .filter(Boolean)
    .join('; ')
    .slice(0, 400);
}

export class ProvedorClicksign implements ProvedorDeAssinatura {
  readonly nome = 'clicksign';
  readonly disponivel = true;
  /** Conta de homologação: assinatura colhida ali não tem validade jurídica. */
  readonly sandbox: boolean;

  private readonly logger = new Logger('Clicksign');
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof fetch;

  constructor(private readonly cfg: ConfigClicksign) {
    this.base = `${cfg.apiUrl.replace(/\/+$/, '')}/api/v3`;
    this.timeoutMs = cfg.timeoutMs ?? TIMEOUT_PADRAO_MS;
    this.fetch = cfg.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
    this.sandbox = /sandbox/i.test(cfg.apiUrl);
  }

  /**
   * Prova que o token vale sem criar nada: lista um envelope só, com 3s de
   * teto. É o que o painel de sistema chama — leitura, barata, e a mensagem de
   * erro (a mesma de `erroHttp`) nunca carrega o token.
   */
  async verificar(): Promise<VerificacaoDoProvedor> {
    const t0 = Date.now();
    const rotulo = 'GET /envelopes';
    try {
      const resp = await this.comTimeout(
        `${this.base}/envelopes?page%5Bsize%5D=1`,
        { method: 'GET', headers: { Authorization: this.cfg.token, Accept: TIPO_JSONAPI } },
        rotulo,
        3000,
      );
      const latenciaMs = Date.now() - t0;
      if (resp.ok) return { ok: true, latenciaMs };
      let corpo: unknown;
      try { corpo = await resp.json(); } catch { corpo = undefined; }
      return { ok: false, latenciaMs, detalhe: this.erroHttp(rotulo, resp.status, corpo).message };
    } catch (e) {
      return { ok: false, detalhe: (e as Error).message };
    }
  }

  /* ── HTTP ────────────────────────────────────────────────────── */

  private async comTimeout(
    url: string,
    init: RequestInit,
    rotulo: string,
    timeoutMs = this.timeoutMs,
  ): Promise<Response> {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), timeoutMs);
    try {
      return await this.fetch(url, { ...init, signal: controle.signal });
    } catch (e) {
      if (controle.signal.aborted) {
        throw new GatewayTimeoutException(
          `Clicksign não respondeu em ${Math.round(timeoutMs / 1000)}s (${rotulo}).`,
        );
      }
      throw new BadGatewayException(`Falha de rede ao chamar a Clicksign (${rotulo}): ${(e as Error).message}`);
    } finally {
      clearTimeout(relogio);
    }
  }

  /** Uma chamada à API. Devolve o JSON (ou `undefined` em 204). */
  async chamar<T = { data: RecursoJsonApi }>(
    metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    caminho: string,
    corpo?: unknown,
  ): Promise<T> {
    const rotulo = `${metodo} ${caminho}`;
    const resp = await this.comTimeout(`${this.base}${caminho}`, {
      method: metodo,
      headers: {
        Authorization: this.cfg.token,
        Accept: TIPO_JSONAPI,
        ...(corpo === undefined ? {} : { 'Content-Type': TIPO_JSONAPI }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }, rotulo);

    const texto = await resp.text();
    let json: unknown;
    try {
      json = texto ? JSON.parse(texto) : undefined;
    } catch {
      json = undefined;
    }

    if (!resp.ok) throw this.erroHttp(rotulo, resp.status, json);
    return json as T;
  }

  private erroHttp(rotulo: string, status: number, corpo: unknown): ErroClicksign {
    const detalhe = detalhesDoErro(corpo);
    const sufixo = detalhe ? `: ${detalhe}` : '';
    if (status === 401 || status === 403) {
      return new ErroClicksign(
        `Clicksign recusou a credencial (${status}) em ${rotulo}${sufixo}. Verifique CLICKSIGN_ACCESS_TOKEN.`,
        503, status,
      );
    }
    if (status === 400 || status === 422) {
      return new ErroClicksign(`Clicksign recusou os dados (${status}) em ${rotulo}${sufixo}`, 422, status);
    }
    if (status === 429) {
      return new ErroClicksign(`Clicksign limitou as requisições (429) em ${rotulo}. Tente de novo em instantes.`, 503, status);
    }
    return new ErroClicksign(`Clicksign respondeu ${status} em ${rotulo}${sufixo}`, 502, status);
  }

  /* ── Envio ───────────────────────────────────────────────────── */

  async criarEnvelope(e: NovoEnvelope): Promise<EnvelopeCriado> {
    // A Clicksign recusa nome sem sobrenome ou com número ("name não está em
    // um formato válido"). Conferir antes poupa um envelope criado e excluído
    // e devolve uma mensagem que diz o que corrigir.
    for (const s of e.signatarios) {
      if (!/\S+\s+\S+/.test(s.nome.trim()) || /\d/.test(s.nome)) {
        const quem = s.papel === 'dealer' ? 'do representante legal da loja' : 'do comprador';
        throw new UnprocessableEntityException(
          `O nome ${quem} precisa ter nome e sobrenome, sem números, para a assinatura pela Clicksign.`,
        );
      }
    }

    const envelope = await this.chamar('POST', '/envelopes', {
      data: {
        type: 'envelopes',
        attributes: {
          name: e.nomeArquivo.replace(/\.pdf$/i, ''),
          locale: 'pt-BR',
          auto_close: true,
          deadline_at: e.prazo.toISOString(),
          // Recusa de uma parte encerra: o contrato não se fecha pela metade.
          block_after_refusal: true,
          // Sem isto, o prazo vencido com UMA assinatura *finaliza* o
          // documento (evento `deadline`) — contrato bilateral assinado por
          // uma parte só. Cancelado é o único desfecho aceitável.
          deadline_partial_signature_action: 'canceled',
        },
      },
    });
    const idEnvelope = envelope.data.id;

    try {
      const documento = await this.chamar('POST', `/envelopes/${idEnvelope}/documents`, {
        data: {
          type: 'documents',
          attributes: {
            filename: e.nomeArquivo,
            content_base64: `data:application/pdf;base64,${Buffer.from(e.documento).toString('base64')}`,
            metadata: {
              [META_ENVELOPE]: idEnvelope,
              [META_PAPEIS]: Object.fromEntries(
                e.signatarios.map((s) => [hashDoEmail(s.email), s.papel]),
              ),
            },
          },
        },
      });
      const idDocumento = documento.data.id;

      const signatarios: EnvelopeCriado['signatarios'] = [];
      for (const s of e.signatarios) {
        const documentation = cpfFormatado(s.documento);
        const criado = await this.chamar('POST', `/envelopes/${idEnvelope}/signers`, {
          data: {
            type: 'signers',
            attributes: {
              name: s.nome,
              email: s.email,
              has_documentation: true,
              ...(documentation ? { documentation } : {}),
              // O padrão da Clicksign é não deixar recusar; aqui a recusa é
              // um desfecho previsto (vira `refused` no sistema).
              refusable: true,
              communicate_events: {
                signature_request: 'email',
                signature_reminder: 'email',
                document_signed: 'email',
              },
            },
          },
        });
        signatarios.push({ papel: s.papel, idExterno: criado.data.id });
      }

      for (const s of signatarios) {
        const relacao = {
          document: { data: { type: 'documents', id: idDocumento } },
          signer: { data: { type: 'signers', id: s.idExterno } },
        };
        await this.chamar('POST', `/envelopes/${idEnvelope}/requirements`, {
          data: {
            type: 'requirements',
            attributes: { action: 'agree', role: QUALIFICACAO_CLICKSIGN[s.papel] },
            relationships: relacao,
          },
        });
        await this.chamar('POST', `/envelopes/${idEnvelope}/requirements`, {
          data: {
            type: 'requirements',
            attributes: { action: 'provide_evidence', auth: 'email' },
            relationships: relacao,
          },
        });
      }

      await this.chamar('PATCH', `/envelopes/${idEnvelope}`, {
        data: { id: idEnvelope, type: 'envelopes', attributes: { status: 'running' } },
      });
      await this.chamar('POST', `/envelopes/${idEnvelope}/notifications`, {
        data: { type: 'notifications', attributes: {} },
      });

      return { idExterno: idEnvelope, signatarios };
    } catch (erro) {
      // Envelope pela metade não fica para trás: rascunho é excluído, ativo é
      // cancelado. Melhor esforço — o erro que importa é o original.
      await this.cancelar(idEnvelope).catch((c: Error) =>
        this.logger.error(`Envelope ${idEnvelope} ficou na Clicksign após falha no envio: ${c.message}`),
      );
      throw erro;
    }
  }

  /* ── Cancelamento ───────────────────────────────────────────── */

  /**
   * Na API 3.0 o envelope só vai de `draft` a `running`; quem se cancela é o
   * documento (`PATCH …/documents/:id` com `status: canceled`), e só o
   * rascunho pode ser excluído. Idempotente: documento já cancelado é no-op.
   */
  async cancelar(idExterno: string): Promise<void> {
    const envelope = await this.chamar('GET', `/envelopes/${idExterno}`);
    const status = envelope.data.attributes?.status;

    if (status === 'draft') {
      await this.chamar('DELETE', `/envelopes/${idExterno}`);
      return;
    }
    if (status === 'canceled') return;

    const { data: documentos } = await this.chamar<{ data: RecursoJsonApi[] }>(
      'GET', `/envelopes/${idExterno}/documents`,
    );
    for (const d of documentos ?? []) {
      const s = d.attributes?.status;
      if (s === 'canceled') continue;
      if (s === 'closed') {
        throw new ConflictException(
          'O documento já foi finalizado na Clicksign e não pode mais ser cancelado.',
        );
      }
      await this.chamar('PATCH', `/envelopes/${idExterno}/documents/${d.id}`, {
        data: { id: d.id, type: 'documents', attributes: { status: 'canceled' } },
      });
    }
  }

  /* ── PDF assinado ───────────────────────────────────────────── */

  async baixarAssinado(idExterno: string): Promise<Uint8Array> {
    const { data: documentos } = await this.chamar<{ data: RecursoJsonApi[] }>(
      'GET', `/envelopes/${idExterno}/documents`,
    );
    const primeiro = documentos?.[0];
    if (!primeiro) throw new BadGatewayException(`Envelope ${idExterno} sem documento na Clicksign.`);

    // O detalhe traz os links; a URL é pré-assinada no S3 e vale ~5 min, por
    // isso é pedida agora e baixada em seguida.
    const { data: documento } = await this.chamar('GET', `/envelopes/${idExterno}/documents/${primeiro.id}`);
    const url = documento.links?.files?.signed;
    if (documento.attributes?.status !== 'closed' || !url) {
      // 503: o webhook responde 5xx e a Clicksign reentrega a conclusão.
      throw new ServiceUnavailableException(
        'O arquivo assinado ainda não está disponível na Clicksign. Tente de novo em instantes.',
      );
    }

    // Sem `Authorization`: é o S3, e o token não sai para terceiros.
    const resp = await this.comTimeout(url, { method: 'GET' }, 'download do PDF assinado');
    if (!resp.ok) throw new BadGatewayException(`Download do PDF assinado respondeu ${resp.status}.`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.length === 0 || bytes.length > PDF_MAXIMO_BYTES) {
      throw new BadGatewayException(`PDF assinado com tamanho inesperado (${bytes.length} bytes).`);
    }
    return bytes;
  }

  /* ── Webhook ────────────────────────────────────────────────── */

  interpretarWebhook(cabecalhos: CabecalhosHttp, corpoCru: Uint8Array): EventoDeAssinatura {
    const confere =
      hmacConfere(corpoCru, cabecalhos[CABECALHO_HMAC], this.cfg.segredoWebhook) ||
      hmacConfere(corpoCru, cabecalhos[CABECALHO_HMAC_ALTERNATIVO], this.cfg.segredoWebhook, {
        aceitaHexPuro: true,
      });
    if (!confere) throw new UnauthorizedException('Assinatura do webhook não confere.');

    let payload: PayloadWebhook;
    try {
      payload = JSON.parse(Buffer.from(corpoCru).toString('utf8')) as PayloadWebhook;
    } catch {
      throw new BadRequestException('Corpo do webhook não é JSON.');
    }

    const cabecalhoEvento = cabecalhos['event'];
    const nome = payload?.event?.name ?? (typeof cabecalhoEvento === 'string' ? cabecalhoEvento : undefined);
    if (!nome) throw new BadRequestException('Webhook sem nome de evento.');

    const tipo = Object.prototype.hasOwnProperty.call(EVENTOS_CLICKSIGN, nome)
      ? EVENTOS_CLICKSIGN[nome]!
      : 'ignorado';
    const meta = this.metadados(payload.document?.metadata);
    const idDocumento = payload.document?.key;
    const envelope = typeof meta[META_ENVELOPE] === 'string' ? meta[META_ENVELOPE] : undefined;

    if (!envelope && tipo !== 'ignorado') {
      // Documento não criado por este adaptador (ou metadado perdido). Sai com
      // o id do documento: o service não o acha, responde 200 e avisa no log.
      this.logger.warn(`Webhook "${nome}" sem ${META_ENVELOPE} nos metadados (documento ${idDocumento ?? '?'}).`);
    }
    const idExterno = envelope ?? idDocumento;
    if (!idExterno) throw new BadRequestException('Webhook sem documento.');

    const signer = payload.event?.data?.signer;
    const papeis = (meta[META_PAPEIS] ?? {}) as Record<string, unknown>;
    const papelBruto = signer?.email ? papeis[hashDoEmail(signer.email)] : undefined;
    const papel = papelBruto === 'dealer' || papelBruto === 'customer' ? papelBruto : undefined;

    const quando = payload.event?.occurred_at ?? payload.event?.data?.reached_at;
    return {
      idExterno,
      tipo,
      papel,
      idSignatarioExterno: signer?.key,
      ocorridoEm: quando && !Number.isNaN(Date.parse(quando)) ? new Date(quando) : new Date(),
    };
  }

  /** Metadados chegam como objeto; a referência os descreve como "string JSON". Aceita os dois. */
  private metadados(bruto: unknown): Record<string, unknown> {
    if (typeof bruto === 'string') {
      try {
        const obj: unknown = JSON.parse(bruto);
        return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    }
    return bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {};
  }
}
