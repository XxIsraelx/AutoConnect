import {
  BadRequestException, ConflictException, Logger, NotFoundException, ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  crtDoRegime, NOME_DO_DESTINATARIO_EM_HOMOLOGACAO,
  type CabecalhosDoEmissor, type CertificadoA1, type DadosDoEmitente, type EmitenteNoEmissor,
  type EmitenteRegistrado, type NotaMontada, type PedidoDeEmissao, type ProvedorDeNotaFiscal,
  type RetornoDaCartaDeCorrecao, type RetornoDoEmissor, type StatusDaNota,
} from '@autoconnect/shared';
import { tokenConfere } from '../../cobranca/token-webhook';
import { CABECALHO_TOKEN_NFE } from './provedor-simulado';

/**
 * Adaptador da Focus NFe — fase N3 do plano fiscal.
 *
 * Documentação lida em 14/10/2026 em https://doc.focusnfe.com.br (referências
 * de autenticação, emitir, consultar, cancelar, carta de correção, gatilhos e
 * empresas). O que a documentação **não** disse e este arquivo assume está
 * marcado com "A CONFERIR" — a primeira nota em homologação confirma ou corrige.
 *
 * Como a Focus funciona, e o desenho que sai disso:
 *
 *  - **Duas credenciais.** O *token master* da conta cadastra empresas
 *    (`/v2/empresas`, só em produção); cada empresa (cada loja) recebe tokens
 *    próprios de homologação e de produção, e **é com eles que se emite**.
 *  - **Nenhum token de loja no banco.** O master consulta a empresa
 *    (`GET /v2/empresas/{id}` devolve `token_homologacao` e `token_producao`),
 *    e o token fica em memória por alguns minutos. O banco guarda só o id da
 *    empresa; o único segredo é o master, no `.env`.
 *  - **O certificado A1 passa e não fica.** Vai em base64 no cadastro da
 *    empresa, com a senha; o que volta (validade, CNPJ) é o que gravamos.
 *  - **A referência da nota é o id do nosso documento** (`?ref=`), então o
 *    retorno casa sem tabela de-para.
 */

const HOST = {
  producao: 'https://api.focusnfe.com.br',
  homologacao: 'https://homologacao.focusnfe.com.br',
} as const;

const TIMEOUT_PADRAO_MS = 20_000;
/** O token da empresa muda raramente; cinco minutos poupam uma chamada por nota. */
const VALIDADE_DO_TOKEN_MS = 5 * 60_000;

export interface ConfigFocus {
  tokenMaster: string;
  segredoWebhook: string;
  /** Sem a chave, a instalação só emite em homologação. */
  producaoLiberada: boolean;
  /** URL pública do nosso webhook; sem ela, o retorno chega só pela consulta. */
  urlDoWebhook: string | null;
  timeoutMs?: number;
  /** Injetável para teste; o padrão é o `fetch` global do Node 20. */
  fetch?: typeof fetch;
}

/** O JSON da Focus para uma nota (consulta, emissão e — A CONFERIR — webhook). */
interface NotaFocus {
  ref?: string;
  status?: string;
  status_sefaz?: string;
  mensagem_sefaz?: string;
  chave_nfe?: string;
  numero?: string | number;
  serie?: string | number;
  caminho_xml_nota_fiscal?: string;
  caminho_danfe?: string;
  protocolo?: string;
  protocolo_nota_fiscal?: { numero_protocolo?: string; data_recebimento?: string };
  erros?: { mensagem?: string; campo?: string }[];
  codigo?: string;
  mensagem?: string;
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** `NFe4119...` → `4119...`. A Focus devolve a chave com o prefixo do XML. */
const semPrefixo = (chave?: string) => (chave ? chave.replace(/^NFe/i, '') : null);

const inteiro = (v?: string | number) => (v === undefined || v === null || v === '' ? null : Number(v));

function motivoDe(r: NotaFocus): string {
  const erros = (r.erros ?? []).map((e) => (e.campo ? `${e.campo}: ${e.mensagem}` : e.mensagem)).filter(Boolean);
  const sefaz = r.status_sefaz ? `${r.status_sefaz} ${r.mensagem_sefaz ?? ''}`.trim() : r.mensagem_sefaz;
  return [sefaz, ...erros, r.mensagem].filter(Boolean).join(' · ') || 'Sem motivo informado pela Focus';
}

/** O status da Focus no vocabulário do domínio. */
export function traduzirStatusFocus(status?: string): StatusDaNota | 'cancelamento_rejeitado' {
  switch (status) {
    case 'autorizado': return 'autorizada';
    case 'cancelado': return 'cancelada';
    case 'erro_autorizacao': return 'rejeitada';
    case 'denegado': return 'denegada';
    case 'erro_cancelamento': return 'cancelamento_rejeitado';
    default: return 'processando';
  }
}

export class ErroFocus extends Error {
  constructor(mensagem: string, readonly status: number, readonly corpo?: NotaFocus) {
    super(mensagem);
  }
}

/**
 * O pedido de emissão no formato da Focus (referência "Emitir NF-e").
 *
 * Exportado para teste: é aqui que a nota do domínio vira campo da SEFAZ, e é
 * a parte que mais erra calada.
 */
export function pedidoFocus(nota: NotaMontada, agora = new Date()): Record<string, unknown> {
  const homologacao = nota.ambiente === 'homologacao';
  const c = nota.contraparte;
  const e = c.endereco;
  // Data no fuso de Brasília, com o deslocamento explícito, como a doc pede.
  const dataEmissao = new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 19) + '-03:00';

  return {
    natureza_operacao: nota.natureza,
    data_emissao: dataEmissao,
    tipo_documento: nota.direcao === 'entrada' ? 0 : 1,
    finalidade_emissao: 1,
    local_destino: nota.destino === 'interna' ? 1 : 2,
    // A CONFERIR com o contador: na entrada de particular, a loja não vende a
    // consumidor final; na venda a pessoa física, sim.
    consumidor_final: nota.direcao === 'saida' && c.tipoDeDocumento === 'cpf' ? 1 : 0,
    // 1 = presencial; 9 = não presencial, outros.
    presenca_comprador: nota.presencial ? 1 : 9,
    cnpj_emitente: nota.emitente.cnpj,
    inscricao_estadual_emitente: nota.emitente.inscricaoEstadual,
    regime_tributario_emitente: nota.crt,
    // Rejeição 598: em homologação o nome do destinatário é este texto.
    nome_destinatario: homologacao ? NOME_DO_DESTINATARIO_EM_HOMOLOGACAO : c.nome,
    ...(c.tipoDeDocumento === 'cpf' ? { cpf_destinatario: c.documento } : { cnpj_destinatario: c.documento }),
    // 9 = não contribuinte. A loja não guarda IE de quem compra ou vende o carro.
    indicador_inscricao_estadual_destinatario: 9,
    logradouro_destinatario: e.logradouro,
    numero_destinatario: e.numero,
    ...(e.complemento ? { complemento_destinatario: e.complemento } : {}),
    bairro_destinatario: e.bairro,
    municipio_destinatario: e.cidade,
    uf_destinatario: e.uf,
    cep_destinatario: e.cep,
    ...(c.email ? { email_destinatario: c.email } : {}),
    modalidade_frete: 9,
    valor_produtos: Number(nota.item.valorTotal),
    valor_total: Number(nota.valorTotal),
    // A CONFERIR: nome do campo de informações complementares na referência
    // completa (campos.focusnfe.com.br).
    ...(nota.informacoesComplementares
      ? { informacoes_adicionais_contribuinte: nota.informacoesComplementares }
      : {}),
    items: [{
      numero_item: 1,
      codigo_produto: nota.item.chassi,
      descricao: nota.item.descricao,
      cfop: nota.item.cfop,
      codigo_ncm: nota.item.ncm,
      unidade_comercial: 'UN',
      quantidade_comercial: 1,
      valor_unitario_comercial: Number(nota.item.valorUnitario),
      valor_bruto: Number(nota.item.valorTotal),
      unidade_tributavel: 'UN',
      quantidade_tributavel: 1,
      valor_unitario_tributavel: Number(nota.item.valorUnitario),
      inclui_no_total: 1,
      icms_origem: nota.item.origem,
      icms_situacao_tributaria: nota.situacaoTributaria,
      pis_situacao_tributaria: nota.pisCofinsSituacaoTributaria,
      cofins_situacao_tributaria: nota.pisCofinsSituacaoTributaria,
    }],
  };
}

export class ProvedorFocusNfe implements ProvedorDeNotaFiscal {
  readonly nome = 'focusnfe';
  readonly disponivel = true;
  readonly exigeCertificado = true;
  readonly homologacao: boolean;

  private readonly logger = new Logger('NotaFiscal/Focus');
  private readonly buscar: typeof fetch;
  private readonly timeoutMs: number;
  private readonly tokens = new Map<string, { producao: string; homologacao: string; expira: number }>();

  constructor(private readonly config: ConfigFocus) {
    this.buscar = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? TIMEOUT_PADRAO_MS;
    this.homologacao = !config.producaoLiberada;
  }

  /* ── HTTP ────────────────────────────────────────────────── */

  private async chamar(
    url: string,
    token: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<{ status: number; corpo: NotaFocus; bruto: Buffer }> {
    const controlador = new AbortController();
    const relogio = setTimeout(() => controlador.abort(), this.timeoutMs);
    try {
      const res = await this.buscar(url, {
        method: init.method ?? 'GET',
        headers: {
          // HTTP Basic: o token é o usuário, a senha é vazia.
          Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`,
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controlador.signal,
      });
      const bruto = Buffer.from(await res.arrayBuffer());
      let corpo: NotaFocus = {};
      try {
        corpo = bruto.length ? (JSON.parse(bruto.toString('utf8')) as NotaFocus) : {};
      } catch {
        // XML, PDF ou o "HTTP Basic: Access denied" em texto: quem chamou decide.
      }
      if (res.status === 401) {
        // Nunca repassa o token, nem na mensagem.
        throw new ErroFocus('A Focus NFe recusou a credencial.', 401);
      }
      return { status: res.status, corpo, bruto };
    } catch (e) {
      if (e instanceof ErroFocus) throw e;
      if ((e as Error).name === 'AbortError') {
        throw new ErroFocus(`A Focus NFe não respondeu em ${this.timeoutMs / 1000}s.`, 504);
      }
      throw new ErroFocus(`Sem resposta da Focus NFe: ${(e as Error).message}`, 502);
    } finally {
      clearTimeout(relogio);
    }
  }

  /** O token da empresa no ambiente pedido, pela conta da plataforma. */
  private async tokenDa(emitente: EmitenteNoEmissor): Promise<string> {
    if (!emitente.contaExterna) {
      throw new ConflictException('Envie o certificado A1 da loja em Perfil fiscal antes de emitir pela Focus NFe.');
    }
    if (emitente.ambiente === 'producao' && this.homologacao) {
      throw new ConflictException('Esta instalação só emite em homologação: a produção não foi liberada.');
    }
    const agora = Date.now();
    let t = this.tokens.get(emitente.contaExterna);
    if (!t || t.expira < agora) {
      const r = await this.chamar(`${HOST.producao}/v2/empresas/${encodeURIComponent(emitente.contaExterna)}`, this.config.tokenMaster);
      const empresa = r.corpo as unknown as { token_producao?: string; token_homologacao?: string };
      if (r.status !== 200 || !empresa.token_homologacao) {
        throw new ServiceUnavailableException(`A Focus NFe não devolveu os tokens da empresa (${r.status}).`);
      }
      t = {
        producao: empresa.token_producao ?? '',
        homologacao: empresa.token_homologacao,
        expira: agora + VALIDADE_DO_TOKEN_MS,
      };
      this.tokens.set(emitente.contaExterna, t);
    }
    const token = emitente.ambiente === 'producao' ? t.producao : t.homologacao;
    if (!token) throw new ServiceUnavailableException('A empresa ainda não tem token de produção na Focus NFe.');
    return token;
  }

  private retornoDe(referencia: string, r: NotaFocus): RetornoDoEmissor {
    const situacao = traduzirStatusFocus(r.status);
    return {
      referencia,
      situacao,
      chave: semPrefixo(r.chave_nfe),
      numero: inteiro(r.numero),
      serie: inteiro(r.serie),
      protocolo: r.protocolo_nota_fiscal?.numero_protocolo ?? r.protocolo ?? null,
      motivo: situacao === 'rejeitada' || situacao === 'denegada' || situacao === 'cancelamento_rejeitado'
        ? motivoDe(r) : null,
      ocorridoEm: r.protocolo_nota_fiscal?.data_recebimento ?? new Date().toISOString(),
    };
  }

  /* ── Empresa e certificado ───────────────────────────────── */

  async registrarEmitente(dados: DadosDoEmitente, certificado: CertificadoA1): Promise<EmitenteRegistrado> {
    const corpo = {
      nome: dados.razaoSocial,
      nome_fantasia: dados.nomeFantasia,
      cnpj: dados.cnpj,
      inscricao_estadual: dados.inscricaoEstadual,
      regime_tributario: crtDoRegime(dados.regime),
      logradouro: dados.endereco.logradouro,
      numero: dados.endereco.numero,
      ...(dados.endereco.complemento ? { complemento: dados.endereco.complemento } : {}),
      bairro: dados.endereco.bairro,
      municipio: dados.endereco.cidade,
      uf: dados.endereco.uf,
      cep: dados.endereco.cep,
      email: dados.email,
      habilita_nfe: true,
      arquivo_certificado_base64: certificado.arquivoBase64,
      senha_certificado: certificado.senha,
    };
    const r = dados.contaExterna
      ? await this.chamar(`${HOST.producao}/v2/empresas/${encodeURIComponent(dados.contaExterna)}`, this.config.tokenMaster, { method: 'PUT', body: corpo })
      : await this.chamar(`${HOST.producao}/v2/empresas`, this.config.tokenMaster, { method: 'POST', body: corpo });

    if (r.status === 422 || r.status === 400) {
      // Certificado inválido, de outro CNPJ ou vencido — a Focus aponta o campo.
      throw new BadRequestException({ message: `A Focus NFe recusou o cadastro: ${motivoDe(r.corpo)}` });
    }
    if (r.status !== 200 && r.status !== 201) {
      throw new ServiceUnavailableException(`A Focus NFe não cadastrou a empresa (${r.status}).`);
    }
    const empresa = r.corpo as unknown as {
      id?: number | string; certificado_valido_ate?: string; certificado_cnpj?: string;
    };
    if (empresa.id === undefined) throw new ServiceUnavailableException('A Focus NFe não devolveu o id da empresa.');
    const contaExterna = String(empresa.id);
    this.tokens.delete(contaExterna);

    await this.garantirWebhooks(contaExterna, dados.cnpj);

    return {
      contaExterna,
      certificadoValidoAte: empresa.certificado_valido_ate ?? null,
      certificadoCnpj: empresa.certificado_cnpj ?? null,
    };
  }

  /**
   * O gatilho de NF-e da empresa, nos ambientes que a instalação usa, com o
   * nosso token no cabeçalho que o simulado também usa. Falhar aqui não
   * desfaz o cadastro: sem webhook, a nota se resolve pela consulta.
   */
  private async garantirWebhooks(contaExterna: string, cnpj: string): Promise<void> {
    if (!this.config.urlDoWebhook) {
      this.logger.warn('NFE_WEBHOOK_URL ausente: o retorno das notas chega só pela consulta.');
      return;
    }
    const ambientes: EmitenteNoEmissor['ambiente'][] = this.homologacao ? ['homologacao'] : ['homologacao', 'producao'];
    for (const ambiente of ambientes) {
      try {
        const token = await this.tokenDa({ contaExterna, ambiente });
        const r = await this.chamar(`${HOST[ambiente]}/v2/hooks`, token, {
          method: 'POST',
          body: {
            cnpj, event: 'nfe', url: this.config.urlDoWebhook,
            authorization: this.config.segredoWebhook, authorization_header: CABECALHO_TOKEN_NFE,
          },
        });
        if (r.status >= 300) this.logger.warn(`Gatilho de NF-e em ${ambiente} não criado (${r.status}): ${motivoDe(r.corpo)}`);
      } catch (e) {
        this.logger.warn(`Gatilho de NF-e em ${ambiente} não criado: ${(e as Error).message}`);
      }
    }
  }

  /* ── Nota ────────────────────────────────────────────────── */

  async emitir(emitente: EmitenteNoEmissor, { referencia, nota }: PedidoDeEmissao): Promise<RetornoDoEmissor> {
    const token = await this.tokenDa(emitente);
    const r = await this.chamar(
      `${HOST[emitente.ambiente]}/v2/nfe?ref=${encodeURIComponent(referencia)}`,
      token,
      { method: 'POST', body: pedidoFocus(nota) },
    );
    if (r.status === 201 || r.status === 202) return this.retornoDe(referencia, r.corpo);
    if (r.status === 422 && (r.corpo.codigo === 'pending_operation' || r.corpo.codigo === 'already_processed')) {
      // A mesma referência já foi recebida: o estado verdadeiro é o da consulta.
      return this.consultar(emitente, referencia);
    }
    if (r.status === 422 || r.status === 400) {
      // A Focus recusou o pedido antes da SEFAZ — erro de dado, não de rede.
      return { ...this.retornoDe(referencia, r.corpo), situacao: 'rejeitada', motivo: motivoDe(r.corpo) };
    }
    throw new ErroFocus(`A Focus NFe respondeu ${r.status} à emissão.`, r.status, r.corpo);
  }

  async consultar(emitente: EmitenteNoEmissor, referencia: string): Promise<RetornoDoEmissor> {
    const token = await this.tokenDa(emitente);
    // `completa=1` é o que traz o protocolo — sem ele a autorização não fecha.
    const r = await this.chamar(`${HOST[emitente.ambiente]}/v2/nfe/${encodeURIComponent(referencia)}?completa=1`, token);
    if (r.status === 404) throw new NotFoundException('A Focus NFe não conhece esta nota.');
    if (r.status !== 200) throw new ErroFocus(`A Focus NFe respondeu ${r.status} à consulta.`, r.status, r.corpo);
    return this.retornoDe(referencia, r.corpo);
  }

  async cancelar(emitente: EmitenteNoEmissor, referencia: string, justificativa: string): Promise<RetornoDoEmissor> {
    const token = await this.tokenDa(emitente);
    const r = await this.chamar(`${HOST[emitente.ambiente]}/v2/nfe/${encodeURIComponent(referencia)}`, token, {
      method: 'DELETE', body: { justificativa },
    });
    if (r.status === 200) return this.retornoDe(referencia, r.corpo);
    return { ...this.retornoDe(referencia, r.corpo), situacao: 'cancelamento_rejeitado', motivo: motivoDe(r.corpo) };
  }

  async cartaDeCorrecao(emitente: EmitenteNoEmissor, referencia: string, correcao: string): Promise<RetornoDaCartaDeCorrecao> {
    const token = await this.tokenDa(emitente);
    const r = await this.chamar(`${HOST[emitente.ambiente]}/v2/nfe/${encodeURIComponent(referencia)}/carta_correcao`, token, {
      method: 'POST', body: { correcao },
    });
    const corpo = r.corpo as NotaFocus & { numero_carta_correcao?: number | string };
    const autorizada = r.status === 200 && corpo.status === 'autorizado';
    return {
      situacao: autorizada ? 'autorizada' : 'rejeitada',
      sequencia: inteiro(corpo.numero_carta_correcao),
      // A doc da carta não traz protocolo; o XML dela, sim (A CONFERIR).
      protocolo: null,
      motivo: autorizada ? null : motivoDe(corpo),
      ocorridoEm: new Date().toISOString(),
    };
  }

  /**
   * O arquivo pelo caminho que a consulta devolve. A CONFERIR: a doc dá o
   * caminho relativo (`/arquivos/...`) sem dizer o host; usamos o do ambiente,
   * com a mesma autenticação, e seguimos redirecionamento.
   */
  private async arquivo(emitente: EmitenteNoEmissor, referencia: string, campo: 'caminho_xml_nota_fiscal' | 'caminho_danfe') {
    const token = await this.tokenDa(emitente);
    const consulta = await this.chamar(`${HOST[emitente.ambiente]}/v2/nfe/${encodeURIComponent(referencia)}`, token);
    const caminho = consulta.corpo[campo];
    if (!caminho) throw new NotFoundException('A Focus NFe não devolveu o arquivo desta nota.');
    const url = /^https?:\/\//.test(caminho) ? caminho : `${HOST[emitente.ambiente]}${caminho}`;
    const r = await this.chamar(url, token);
    if (r.status !== 200 || r.bruto.length === 0) throw new ErroFocus(`A Focus NFe respondeu ${r.status} ao arquivo.`, r.status);
    return r.bruto;
  }

  baixarXml(emitente: EmitenteNoEmissor, referencia: string): Promise<Uint8Array> {
    return this.arquivo(emitente, referencia, 'caminho_xml_nota_fiscal');
  }

  baixarDanfe(emitente: EmitenteNoEmissor, referencia: string): Promise<Uint8Array> {
    return this.arquivo(emitente, referencia, 'caminho_danfe');
  }

  /**
   * O gatilho da Focus. Autenticado pelo token que nós cadastramos no gatilho,
   * no cabeçalho que escolhemos (`authorization_header`). A CONFERIR: a doc
   * não descreve o corpo do disparo; assumimos o JSON da consulta, com `ref`.
   * Sem id de evento, a idempotência é o hash do corpo — a reentrega idêntica
   * não aplica duas vezes.
   */
  interpretarWebhook(cabecalhos: CabecalhosDoEmissor, corpoCru: Uint8Array) {
    if (!tokenConfere(cabecalhos, CABECALHO_TOKEN_NFE, this.config.segredoWebhook)) {
      throw new UnauthorizedException('Token do webhook de nota fiscal não confere.');
    }
    let corpo: NotaFocus;
    try {
      corpo = JSON.parse(Buffer.from(corpoCru).toString('utf8')) as NotaFocus;
    } catch {
      return { idDaEntrega: `focus:${sha256(corpoCru)}`, retorno: null };
    }
    if (!corpo.ref) return { idDaEntrega: `focus:${sha256(corpoCru)}`, retorno: null };
    return { idDaEntrega: `focus:${sha256(corpoCru)}`, retorno: this.retornoDe(corpo.ref, corpo) };
  }
}
