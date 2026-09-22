import { UnauthorizedException, BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { NovoEnvelope } from '@autoconnect/shared';
import {
  cpfFormatado, ErroClicksign, EVENTOS_CLICKSIGN, hashDoEmail, ProvedorClicksign,
} from './provedor-clicksign';
import { provedorConfigurado, ProvedorIndisponivel } from './provedor';
import { cabecalhoHmac, hmacSha256Hex } from './hmac';

/* ── fetch falso ─────────────────────────────────────────────── */

interface Chamada { metodo: string; url: string; corpo?: any; cabecalhos: Record<string, string> }
type Rota = (c: Chamada) => Response | Promise<Response>;

const API = 'https://sandbox.clicksign.test';
const TOKEN = 'token-de-teste-que-nao-pode-vazar';
const SEGREDO = 'segredo-webhook';

const json = (status: number, corpo?: unknown) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });
const recurso = (id: string, attributes: Record<string, unknown> = {}, links?: object) =>
  ({ data: { id, type: 'x', attributes, ...(links ? { links } : {}) } });

function falso(rotas: [RegExp, Rota][]) {
  const chamadas: Chamada[] = [];
  const fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const c: Chamada = {
      metodo: init?.method ?? 'GET',
      url: String(url),
      corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      cabecalhos: (init?.headers ?? {}) as Record<string, string>,
    };
    chamadas.push(c);
    const linha = `${c.metodo} ${c.url.replace(`${API}/api/v3`, '')}`;
    const rota = rotas.find(([re]) => re.test(linha));
    if (!rota) throw new Error(`rota não prevista: ${linha}`);
    return rota[1](c);
  });
  const provedor = new ProvedorClicksign({
    apiUrl: `${API}/`, token: TOKEN, segredoWebhook: SEGREDO, fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const linhas = () => chamadas.map((c) => `${c.metodo} ${c.url.replace(`${API}/api/v3`, '')}`);
  return { provedor, chamadas, linhas, fetch };
}

const pdf = Buffer.from('%PDF-1.4 contrato');
const novo = (): NovoEnvelope => ({
  documento: pdf,
  nomeArquivo: 'contrato-abcd1234.pdf',
  hash: 'h',
  prazo: new Date('2026-10-22T12:00:00Z'),
  signatarios: [
    { papel: 'dealer', nome: 'Rep Legal Loja', email: 'rep@loja.test' },
    { papel: 'customer', nome: 'Maria da Silva', email: 'Maria@X.test', documento: '52998224725' },
  ],
});

/* ── criarEnvelope ───────────────────────────────────────────── */

describe('ProvedorClicksign.criarEnvelope', () => {
  const caminhoFeliz = (): [RegExp, Rota][] => {
    let signer = 0;
    return [
      [/^POST \/envelopes$/, () => json(201, recurso('env-1', { status: 'draft' }))],
      [/^POST \/envelopes\/env-1\/documents$/, () => json(201, recurso('doc-1'))],
      [/^POST \/envelopes\/env-1\/signers$/, () => json(201, recurso(`sig-${++signer}`))],
      [/^POST \/envelopes\/env-1\/requirements$/, () => json(201, recurso('req'))],
      [/^PATCH \/envelopes\/env-1$/, () => json(200, recurso('env-1', { status: 'running' }))],
      [/^POST \/envelopes\/env-1\/notifications$/, () => json(200, recurso('n'))],
    ];
  };

  it('cria, sobe o PDF, cria signatários e requisitos, ativa e notifica — nessa ordem', async () => {
    const { provedor, linhas, chamadas } = falso(caminhoFeliz());

    const r = await provedor.criarEnvelope(novo());

    expect(r).toEqual({
      idExterno: 'env-1',
      signatarios: [{ papel: 'dealer', idExterno: 'sig-1' }, { papel: 'customer', idExterno: 'sig-2' }],
    });
    expect(linhas()).toEqual([
      'POST /envelopes',
      'POST /envelopes/env-1/documents',
      'POST /envelopes/env-1/signers',
      'POST /envelopes/env-1/signers',
      'POST /envelopes/env-1/requirements',
      'POST /envelopes/env-1/requirements',
      'POST /envelopes/env-1/requirements',
      'POST /envelopes/env-1/requirements',
      'PATCH /envelopes/env-1',
      'POST /envelopes/env-1/notifications',
    ]);

    // JSON:API, token cru no Authorization (sem "Bearer").
    for (const c of chamadas) {
      expect(c.cabecalhos.Authorization).toBe(TOKEN);
      expect(c.cabecalhos.Accept).toBe('application/vnd.api+json');
      expect(c.cabecalhos['Content-Type']).toBe('application/vnd.api+json');
    }

    const [envelope, documento, dealer, cliente, qualD, authD, qualC, authC, ativa] = chamadas;
    expect(envelope!.corpo.data).toEqual({
      type: 'envelopes',
      attributes: {
        name: 'contrato-abcd1234',
        locale: 'pt-BR',
        auto_close: true,
        deadline_at: '2026-10-22T12:00:00.000Z',
        block_after_refusal: true,
        deadline_partial_signature_action: 'canceled',
      },
    });

    const doc = documento!.corpo.data.attributes;
    expect(doc.filename).toBe('contrato-abcd1234.pdf');
    expect(doc.content_base64).toBe(`data:application/pdf;base64,${pdf.toString('base64')}`);
    expect(doc.metadata).toEqual({
      autoconnect_envelope: 'env-1',
      autoconnect_papeis: {
        [hashDoEmail('rep@loja.test')]: 'dealer',
        [hashDoEmail('maria@x.test')]: 'customer',
      },
    });
    // Metadado não carrega e-mail em claro.
    expect(JSON.stringify(doc.metadata)).not.toMatch(/@/);

    expect(dealer!.corpo.data.attributes).toMatchObject({
      name: 'Rep Legal Loja', email: 'rep@loja.test', has_documentation: true, refusable: true,
    });
    expect(dealer!.corpo.data.attributes).not.toHaveProperty('documentation');
    expect(cliente!.corpo.data.attributes.documentation).toBe('529.982.247-25');

    expect(qualD!.corpo.data).toEqual({
      type: 'requirements',
      attributes: { action: 'agree', role: 'seller' },
      relationships: {
        document: { data: { type: 'documents', id: 'doc-1' } },
        signer: { data: { type: 'signers', id: 'sig-1' } },
      },
    });
    expect(authD!.corpo.data.attributes).toEqual({ action: 'provide_evidence', auth: 'email' });
    expect(qualC!.corpo.data.attributes).toEqual({ action: 'agree', role: 'buyer' });
    expect(qualC!.corpo.data.relationships.signer.data.id).toBe('sig-2');
    expect(authC!.corpo.data.attributes.auth).toBe('email');
    expect(ativa!.corpo.data).toEqual({ id: 'env-1', type: 'envelopes', attributes: { status: 'running' } });
  });

  it('falha no meio: exclui o rascunho e propaga o erro da Clicksign, sem o token', async () => {
    const { provedor, linhas } = falso([
      [/^POST \/envelopes$/, () => json(201, recurso('env-1'))],
      [/^POST \/envelopes\/env-1\/documents$/, () => json(201, recurso('doc-1'))],
      [/^POST \/envelopes\/env-1\/signers$/, () => json(422, {
        errors: [{ title: 'inválido', detail: 'documentation - inválido', code: '100', status: '422' }],
      })],
      [/^GET \/envelopes\/env-1$/, () => json(200, recurso('env-1', { status: 'draft' }))],
      [/^DELETE \/envelopes\/env-1$/, () => json(204)],
    ]);

    const erro = await provedor.criarEnvelope(novo()).catch((e: ErroClicksign) => e);

    expect(erro).toBeInstanceOf(ErroClicksign);
    expect((erro as ErroClicksign).getStatus()).toBe(422);
    expect((erro as ErroClicksign).message).toMatch(/documentation - inválido/);
    expect((erro as ErroClicksign).message).not.toContain(TOKEN);
    expect(linhas().slice(-2)).toEqual(['GET /envelopes/env-1', 'DELETE /envelopes/env-1']);
  });

  it('nome sem sobrenome é recusado antes de qualquer chamada', async () => {
    const { provedor, fetch } = falso([]);
    const e = novo();
    e.signatarios[0]!.nome = 'Loja';

    await expect(provedor.criarEnvelope(e)).rejects.toMatchObject({ status: 422 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('credencial recusada vira 503 que aponta a variável', async () => {
    const { provedor } = falso([
      [/^POST \/envelopes$/, () => json(401, { errors: [{ detail: 'Access Token inválido' }] })],
    ]);

    await expect(provedor.criarEnvelope(novo())).rejects.toMatchObject({
      status: 503, message: expect.stringMatching(/CLICKSIGN_ACCESS_TOKEN/),
    });
  });

  it('timeout aborta a chamada e vira 504', async () => {
    const fetch = jest.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
    }));
    const provedor = new ProvedorClicksign({
      apiUrl: API, token: TOKEN, segredoWebhook: SEGREDO, timeoutMs: 10,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await expect(provedor.criarEnvelope(novo())).rejects.toMatchObject({ status: 504 });
  });
});

/* ── cancelar ────────────────────────────────────────────────── */

describe('ProvedorClicksign.cancelar', () => {
  it('rascunho é excluído', async () => {
    const { provedor, linhas } = falso([
      [/^GET \/envelopes\/e$/, () => json(200, recurso('e', { status: 'draft' }))],
      [/^DELETE \/envelopes\/e$/, () => json(204)],
    ]);
    await provedor.cancelar('e');
    expect(linhas()).toEqual(['GET /envelopes/e', 'DELETE /envelopes/e']);
  });

  it('ativo: cancela cada documento em andamento (o envelope não tem status "canceled" na API)', async () => {
    const { provedor, linhas, chamadas } = falso([
      [/^GET \/envelopes\/e$/, () => json(200, recurso('e', { status: 'running' }))],
      [/^GET \/envelopes\/e\/documents$/, () => json(200, {
        data: [{ id: 'd1', attributes: { status: 'running' } }, { id: 'd2', attributes: { status: 'canceled' } }],
      })],
      [/^PATCH \/envelopes\/e\/documents\/d1$/, () => json(200, recurso('d1', { status: 'canceled' }))],
    ]);

    await provedor.cancelar('e');

    expect(linhas()).toEqual(['GET /envelopes/e', 'GET /envelopes/e/documents', 'PATCH /envelopes/e/documents/d1']);
    expect(chamadas[2]!.corpo).toEqual({ data: { id: 'd1', type: 'documents', attributes: { status: 'canceled' } } });
  });

  it('já cancelado é no-op; já finalizado é 409', async () => {
    const cancelado = falso([[/^GET \/envelopes\/e$/, () => json(200, recurso('e', { status: 'canceled' }))]]);
    await cancelado.provedor.cancelar('e');
    expect(cancelado.linhas()).toEqual(['GET /envelopes/e']);

    const fechado = falso([
      [/^GET \/envelopes\/e$/, () => json(200, recurso('e', { status: 'running' }))],
      [/^GET \/envelopes\/e\/documents$/, () => json(200, { data: [{ id: 'd1', attributes: { status: 'closed' } }] })],
    ]);
    await expect(fechado.provedor.cancelar('e')).rejects.toBeInstanceOf(ConflictException);
  });
});

/* ── baixarAssinado ──────────────────────────────────────────── */

describe('ProvedorClicksign.baixarAssinado', () => {
  const S3 = 'https://clicksign-sandbox-content.s3.amazonaws.test/assinado.pdf?X-Amz-Expires=299';

  it('pega o link "signed" do documento e baixa sem mandar o token ao S3', async () => {
    const assinado = Buffer.from('%PDF-1.4 assinado');
    const { provedor, chamadas } = falso([
      [/^GET \/envelopes\/e\/documents$/, () => json(200, { data: [{ id: 'd1', attributes: { status: 'closed' } }] })],
      [/^GET \/envelopes\/e\/documents\/d1$/, () => json(200, recurso('d1', { status: 'closed' }, {
        files: { original: 'https://s3/original.pdf', signed: S3 },
      }))],
      [/^GET https:\/\/clicksign-sandbox-content/, () => new Response(assinado, { status: 200 })],
    ]);

    const bytes = await provedor.baixarAssinado('e');

    expect(Buffer.from(bytes).equals(assinado)).toBe(true);
    const download = chamadas[2]!;
    expect(download.url).toBe(S3);
    expect(JSON.stringify(download.cabecalhos)).not.toContain(TOKEN);
  });

  it('documento ainda não finalizado → 503 (o webhook responde 5xx e a Clicksign reentrega)', async () => {
    const { provedor } = falso([
      [/^GET \/envelopes\/e\/documents$/, () => json(200, { data: [{ id: 'd1', attributes: { status: 'running' } }] })],
      [/^GET \/envelopes\/e\/documents\/d1$/, () => json(200, recurso('d1', { status: 'running' }, {
        files: { original: 'https://s3/original.pdf' },
      }))],
    ]);

    await expect(provedor.baixarAssinado('e')).rejects.toMatchObject({ status: 503 });
  });
});

/* ── Webhook ─────────────────────────────────────────────────── */

/**
 * Payloads dos exemplos da documentação (Eventos do Documento), convertidos do
 * hash Ruby para JSON, com o `document` do "Exemplo do campo Document" e os
 * metadados que este adaptador grava no upload.
 */
const ENVELOPE = '6bb80fa1-4836-424a-9441-0108a7c54d04';
const documento = {
  key: 'db4a2cf7-0a48-481f-b669-54f2a2260ac2',
  account_key: 'f9d9b699-fa73-4949-b8c5-c45df202744b',
  filename: 'contrato-abcd1234.pdf',
  status: 'closed',
  auto_close: true,
  locale: 'pt-BR',
  metadata: {
    autoconnect_envelope: ENVELOPE,
    autoconnect_papeis: {
      [hashDoEmail('rep@loja.test')]: 'dealer',
      [hashDoEmail('maria@x.test')]: 'customer',
    },
  },
  downloads: { signed_file_url: '/2023/03/13/1q42v26p3o_blank_4_Clicksign.pdf' },
};

const FIXTURES: Record<string, object> = {
  sign: {
    event: {
      name: 'sign',
      data: {
        signer: {
          sign_as: 'party', key: '916487c8-9939-0000-0000-4cd7ffd8785b', email: 'maria@x.test',
          name: 'Maria da Silva', auths: ['email'], communicate_by: 'email',
          url: 'https://app.clicksign.com/sign/d46acabf', address: '10.0.5.179',
        },
        secret_hmac: null,
        account: { key: '18ccd207-0000-0000-a73e-585a4109a483' },
      },
      occurred_at: '2026-09-22T10:00:00.000-03:00',
    },
    document: documento,
  },
  refusal: {
    event: {
      name: 'refusal',
      data: {
        signer: {
          key: '09739802-19bb-4352-9c96-1b3af7694f7d', email: 'REP@loja.test',
          name: 'Rep Legal Loja', documentation: '000.007.000-91', sign_as: ['seller'],
        },
        refusal: { reasons: ['Conteúdo do documento'], comment: 'mais de 18 caracteres' },
        account: { key: '18ccd207-58b8-410f-a73e-585a4109a483' },
      },
    },
    document: documento,
  },
  auto_close: { event: { name: 'auto_close', data: null, occurred_at: '2017-05-05T14:57:25.191-03:00' }, document: documento },
  document_closed: {
    event: { name: 'document_closed', data: { account: { key: '857ef357' } }, occurred_at: '2023-09-04T14:31:43.272-03:00' },
    document: documento,
  },
  close: {
    event: { name: 'close', data: { user: { email: 'op@loja.test', name: 'Operador' }, account: { key: 'a' } } },
    document: documento,
  },
  deadline: { event: { name: 'deadline', data: { reached_at: '2023-03-27T14:11:21.973-03:00' } }, document: documento },
  cancel: {
    event: { name: 'cancel', data: { user: { email: 'op@loja.test', name: 'Operador' }, account: { key: 'a' } } },
    document: documento,
  },
  upload: { event: { name: 'upload', data: { user: { email: 'op@loja.test' } } }, document: documento },
  add_signer: { event: { name: 'add_signer', data: { signers: [] } }, document: documento },
};

describe('ProvedorClicksign.interpretarWebhook', () => {
  const { provedor } = falso([]);
  const entregar = (payload: object, cab: Record<string, string> = {}) => {
    const corpo = Buffer.from(JSON.stringify(payload));
    return provedor.interpretarWebhook({ 'content-hmac': cabecalhoHmac(corpo, SEGREDO), ...cab }, corpo);
  };

  it.each([
    ['sign', 'assinou'],
    ['refusal', 'recusou'],
    ['auto_close', 'concluido'],
    ['document_closed', 'concluido'],
    ['close', 'concluido'],
    ['deadline', 'expirou'],
    ['cancel', 'cancelado'],
    ['upload', 'ignorado'],
    ['add_signer', 'ignorado'],
  ])('%s → %s, com o envelope vindo dos metadados do documento', (nome, tipo) => {
    const e = entregar(FIXTURES[nome]!);
    expect(e.tipo).toBe(tipo);
    expect(e.idExterno).toBe(ENVELOPE);
  });

  it('a tabela de tradução cobre todas as fixtures relevantes', () => {
    expect(Object.keys(EVENTOS_CLICKSIGN).sort()).toEqual(
      ['auto_close', 'cancel', 'close', 'deadline', 'document_closed', 'refusal', 'sign'],
    );
  });

  it('sign identifica quem assinou: id do signatário e papel pelo e-mail', () => {
    const e = entregar(FIXTURES.sign!);
    expect(e).toMatchObject({
      papel: 'customer', idSignatarioExterno: '916487c8-9939-0000-0000-4cd7ffd8785b',
    });
    expect(e.ocorridoEm.toISOString()).toBe('2026-09-22T13:00:00.000Z');
  });

  it('refusal identifica quem recusou, com e-mail em caixa diferente', () => {
    expect(entregar(FIXTURES.refusal!)).toMatchObject({ tipo: 'recusou', papel: 'dealer' });
  });

  it('deadline usa o reached_at como horário', () => {
    expect(entregar(FIXTURES.deadline!).ocorridoEm.toISOString()).toBe('2023-03-27T17:11:21.973Z');
  });

  it('metadados como string JSON também servem', () => {
    const p = JSON.parse(JSON.stringify(FIXTURES.sign)) as { document: { metadata: unknown } };
    p.document.metadata = JSON.stringify(p.document.metadata);
    expect(entregar(p)).toMatchObject({ idExterno: ENVELOPE, papel: 'customer' });
  });

  it('sem metadados cai para o id do documento (o service responde envelope-desconhecido)', () => {
    const p = JSON.parse(JSON.stringify(FIXTURES.auto_close)) as { document: { metadata: unknown } };
    p.document.metadata = {};
    expect(entregar(p)).toMatchObject({ idExterno: documento.key, tipo: 'concluido' });
  });

  it('nome de evento como "constructor" não cai no protótipo', () => {
    expect(entregar({ event: { name: 'constructor' }, document: documento }).tipo).toBe('ignorado');
  });

  it('aceita o HMAC também em x-clicksign-signature, com ou sem prefixo', () => {
    const corpo = Buffer.from(JSON.stringify(FIXTURES.sign));
    const hex = hmacSha256Hex(corpo, SEGREDO);
    expect(provedor.interpretarWebhook({ 'x-clicksign-signature': hex }, corpo).tipo).toBe('assinou');
    expect(provedor.interpretarWebhook({ 'x-clicksign-signature': `sha256=${hex}` }, corpo).tipo).toBe('assinou');
  });

  it('Content-Hmac continua exigindo o prefixo sha256=', () => {
    const corpo = Buffer.from(JSON.stringify(FIXTURES.sign));
    expect(() => provedor.interpretarWebhook({ 'content-hmac': hmacSha256Hex(corpo, SEGREDO) }, corpo))
      .toThrow(UnauthorizedException);
  });

  it('HMAC errado, cabeçalho ausente ou desconhecido → 401', () => {
    const corpo = Buffer.from(JSON.stringify(FIXTURES.sign));
    const errado = cabecalhoHmac(corpo, 'outro-segredo');
    expect(() => provedor.interpretarWebhook({ 'content-hmac': errado }, corpo)).toThrow(UnauthorizedException);
    expect(() => provedor.interpretarWebhook({ 'x-clicksign-signature': errado }, corpo)).toThrow(UnauthorizedException);
    expect(() => provedor.interpretarWebhook({}, corpo)).toThrow(UnauthorizedException);
    expect(() => provedor.interpretarWebhook({ 'x-hub-signature-256': cabecalhoHmac(corpo, SEGREDO) }, corpo))
      .toThrow(UnauthorizedException);
  });

  it('corpo adulterado depois de assinado → 401', () => {
    const corpo = Buffer.from(JSON.stringify(FIXTURES.sign));
    const cab = cabecalhoHmac(corpo, SEGREDO);
    const adulterado = Buffer.from(corpo.toString().replace('maria@x.test', 'rep@loja.test'));
    expect(() => provedor.interpretarWebhook({ 'content-hmac': cab }, adulterado)).toThrow(UnauthorizedException);
  });

  it('corpo que não é JSON → 400, só depois do HMAC', () => {
    const corpo = Buffer.from('não é json');
    expect(() => provedor.interpretarWebhook({ 'content-hmac': cabecalhoHmac(corpo, SEGREDO) }, corpo))
      .toThrow(BadRequestException);
  });
});

/* ── Utilitários e fábrica ───────────────────────────────────── */

describe('cpfFormatado', () => {
  it('formata 11 dígitos e ignora o resto', () => {
    expect(cpfFormatado('52998224725')).toBe('529.982.247-25');
    expect(cpfFormatado('529.982.247-25')).toBe('529.982.247-25');
    expect(cpfFormatado('123')).toBeUndefined();
    expect(cpfFormatado(undefined)).toBeUndefined();
  });
});

describe('provedorConfigurado — clicksign', () => {
  const config = (v: Record<string, string | undefined>) =>
    ({ get: (k: string) => v[k] }) as unknown as ConfigService;
  const completo = {
    ASSINATURA_FORNECEDOR: 'clicksign',
    ASSINATURA_WEBHOOK_SECRET: 's',
    CLICKSIGN_ACCESS_TOKEN: 't',
    CLICKSIGN_API_URL: 'https://sandbox.clicksign.com',
  };

  it('com tudo configurado, liga o adaptador', () => {
    const p = provedorConfigurado(config(completo));
    expect(p).toBeInstanceOf(ProvedorClicksign);
    expect(p.nome).toBe('clicksign');
    expect(p.disponivel).toBe(true);
  });

  it.each([
    ['CLICKSIGN_ACCESS_TOKEN'],
    ['CLICKSIGN_API_URL'],
    ['ASSINATURA_WEBHOOK_SECRET'],
  ])('sem %s, indisponível — sem derrubar o boot', (falta) => {
    const p = provedorConfigurado(config({ ...completo, [falta]: '' }));
    expect(p).toBeInstanceOf(ProvedorIndisponivel);
  });

  it('URL sem https é recusada', () => {
    const p = provedorConfigurado(config({ ...completo, CLICKSIGN_API_URL: 'http://sandbox.clicksign.com' }));
    expect(p).toBeInstanceOf(ProvedorIndisponivel);
  });
});
