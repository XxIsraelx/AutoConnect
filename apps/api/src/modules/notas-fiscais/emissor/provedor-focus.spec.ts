import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { NOME_DO_DESTINATARIO_EM_HOMOLOGACAO, type NotaMontada } from '@autoconnect/shared';
import { pedidoFocus, ProvedorFocusNfe, traduzirStatusFocus } from './provedor-focus';

/**
 * Adaptador da Focus NFe. O `fetch` é dublado — nenhuma requisição sai daqui.
 *
 * O que importa fixar: o pedido no formato da Focus (é a parte que erra
 * calada), o token da loja buscado pelo master e nunca vazado, e a tradução
 * de cada resposta para o vocabulário do domínio.
 */

const MASTER = 'token-master-de-teste';
const SEGREDO = 'segredo-do-webhook';
const TOKENS = { token_homologacao: 'tok-homolog-loja', token_producao: 'tok-prod-loja' };

const nota: NotaMontada = {
  operacao: 'venda', direcao: 'saida', natureza: 'Venda de veículo usado', cfop: '5102', destino: 'interna',
  presencial: true, crt: 1, situacaoTributaria: '102', pisCofinsSituacaoTributaria: '07',
  ambiente: 'homologacao', serie: 1,
  emitente: {
    cnpj: '11222333000181', inscricaoEstadual: '110042490114', razaoSocial: 'Loja Ltda', nomeFantasia: 'Loja',
    endereco: { logradouro: 'Av. Brasil', numero: '1000', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', cep: '01000000' },
  },
  contraparte: {
    nome: 'Maria Compradora', tipoDeDocumento: 'cpf', documento: '52998224725', email: null,
    endereco: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', cep: '01001000' },
  },
  item: {
    descricao: 'Fiat Argo 2021/2022', ncm: '87032100', cfop: '5102', origem: 0, quantidade: '1',
    valorUnitario: '84900.50', valorTotal: '84900.50', chassi: '9BD358A4NMYL12345', placa: 'ABC1D23', renavam: '00123456789',
  },
  valorTotal: '84900.50',
  informacoesComplementares: 'Simples Nacional',
};

interface Chamada { url: string; metodo: string; auth: string; corpo: unknown }

/** Um fetch falso que responde por URL e método, e anota tudo o que recebeu. */
function falso(rotas: Record<string, { status: number; corpo?: unknown; texto?: string }>) {
  const chamadas: Chamada[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const metodo = init.method ?? 'GET';
    const auth = Buffer.from(String((init.headers as Record<string, string>).Authorization).replace('Basic ', ''), 'base64')
      .toString().replace(/:$/, '');
    chamadas.push({ url, metodo, auth, corpo: init.body ? JSON.parse(String(init.body)) : undefined });
    const chave = Object.keys(rotas).find((k) => `${metodo} ${url}`.startsWith(k));
    const r = chave ? rotas[chave]! : { status: 404, corpo: { codigo: 'nao_encontrado' } };
    const corpo = r.texto ?? (r.corpo === undefined ? '' : JSON.stringify(r.corpo));
    return new Response(corpo, { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, chamadas };
}

const provedor = (fetch: typeof globalThis.fetch, extra: Partial<ConstructorParameters<typeof ProvedorFocusNfe>[0]> = {}) =>
  new ProvedorFocusNfe({
    tokenMaster: MASTER, segredoWebhook: SEGREDO, producaoLiberada: false, urlDoWebhook: null, fetch, ...extra,
  });

const EMPRESA = { 'GET https://api.focusnfe.com.br/v2/empresas/77': { status: 200, corpo: { id: 77, ...TOKENS } } };
const emitente = { contaExterna: '77', ambiente: 'homologacao' as const };

describe('pedidoFocus', () => {
  it('monta a venda presencial a pessoa física, com o nome de homologação exigido pela SEFAZ', () => {
    const p = pedidoFocus(nota, new Date('2026-10-14T15:00:00Z'));
    expect(p).toMatchObject({
      natureza_operacao: 'Venda de veículo usado',
      data_emissao: '2026-10-14T12:00:00-03:00',
      tipo_documento: 1, finalidade_emissao: 1, local_destino: 1, consumidor_final: 1, presenca_comprador: 1,
      cnpj_emitente: '11222333000181', regime_tributario_emitente: 1,
      nome_destinatario: NOME_DO_DESTINATARIO_EM_HOMOLOGACAO,
      cpf_destinatario: '52998224725', indicador_inscricao_estadual_destinatario: 9,
      municipio_destinatario: 'São Paulo', uf_destinatario: 'SP', modalidade_frete: 9,
      valor_total: 84900.5, valor_produtos: 84900.5,
    });
    expect(p).not.toHaveProperty('cnpj_destinatario');
    expect((p.items as Record<string, unknown>[])[0]).toEqual(expect.objectContaining({
      numero_item: 1, codigo_produto: '9BD358A4NMYL12345', cfop: '5102', codigo_ncm: '87032100',
      quantidade_comercial: 1, valor_unitario_comercial: 84900.5, valor_bruto: 84900.5,
      icms_origem: 0, icms_situacao_tributaria: '102',
      pis_situacao_tributaria: '07', cofins_situacao_tributaria: '07',
    }));
  });

  it('em produção vai o nome de verdade; entrada é tipo 0 e não é consumidor final', () => {
    const p = pedidoFocus({ ...nota, ambiente: 'producao', direcao: 'entrada', presencial: false, destino: 'interestadual' });
    expect(p).toMatchObject({
      nome_destinatario: 'Maria Compradora', tipo_documento: 0, consumidor_final: 0,
      presenca_comprador: 9, local_destino: 2,
    });
  });
});

describe('traduzirStatusFocus', () => {
  it.each([
    ['processando_autorizacao', 'processando'], ['autorizado', 'autorizada'], ['cancelado', 'cancelada'],
    ['erro_autorizacao', 'rejeitada'], ['denegado', 'denegada'], ['erro_cancelamento', 'cancelamento_rejeitado'],
    [undefined, 'processando'],
  ])('%s → %s', (focus, dominio) => {
    expect(traduzirStatusFocus(focus)).toBe(dominio);
  });
});

describe('ProvedorFocusNfe', () => {
  it('emite em homologação com o token da loja, buscado uma vez pelo master', async () => {
    const f = falso({
      ...EMPRESA,
      'POST https://homologacao.focusnfe.com.br/v2/nfe?ref=': { status: 202, corpo: { status: 'processando_autorizacao' } },
    });
    const p = provedor(f.fn);
    const r1 = await p.emitir(emitente, { referencia: 'ref-1', nota });
    await p.emitir(emitente, { referencia: 'ref-2', nota });

    expect(r1).toMatchObject({ referencia: 'ref-1', situacao: 'processando' });
    const empresa = f.chamadas.filter((c) => c.url.includes('/v2/empresas/'));
    expect(empresa).toHaveLength(1);
    expect(empresa[0]!.auth).toBe(MASTER);
    const emissoes = f.chamadas.filter((c) => c.url.includes('/v2/nfe'));
    expect(emissoes.map((c) => c.url)).toEqual([
      'https://homologacao.focusnfe.com.br/v2/nfe?ref=ref-1',
      'https://homologacao.focusnfe.com.br/v2/nfe?ref=ref-2',
    ]);
    expect(emissoes.every((c) => c.auth === TOKENS.token_homologacao)).toBe(true);
  });

  it('pedido recusado pela Focus vira rejeitada, com o campo e a mensagem', async () => {
    const f = falso({
      ...EMPRESA,
      'POST https://homologacao.focusnfe.com.br/v2/nfe': {
        status: 422,
        corpo: { codigo: 'erro_validacao_schema', erros: [{ campo: 'codigo_ncm', mensagem: 'NCM inválido' }] },
      },
    });
    const r = await provedor(f.fn).emitir(emitente, { referencia: 'ref-1', nota });
    expect(r).toMatchObject({ situacao: 'rejeitada', motivo: expect.stringContaining('codigo_ncm: NCM inválido') });
  });

  it('referência já recebida não é reenviada: o estado vem da consulta completa', async () => {
    const f = falso({
      ...EMPRESA,
      'POST https://homologacao.focusnfe.com.br/v2/nfe': { status: 422, corpo: { codigo: 'already_processed' } },
      'GET https://homologacao.focusnfe.com.br/v2/nfe/ref-1?completa=1': {
        status: 200,
        corpo: {
          status: 'autorizado', chave_nfe: 'NFe35261011222333000181550010000012341123456787', numero: '1234', serie: '1',
          protocolo_nota_fiscal: { numero_protocolo: '135260000000001', data_recebimento: '2026-10-14T12:01:00-03:00' },
        },
      },
    });
    const r = await provedor(f.fn).emitir(emitente, { referencia: 'ref-1', nota });
    expect(r).toMatchObject({
      situacao: 'autorizada', chave: '35261011222333000181550010000012341123456787',
      numero: 1234, serie: 1, protocolo: '135260000000001', ocorridoEm: '2026-10-14T12:01:00-03:00',
    });
  });

  it('cancelamento: 200 cancela; recusa vira cancelamento_rejeitado com o motivo da SEFAZ', async () => {
    const ok = falso({ ...EMPRESA, 'DELETE https://homologacao.focusnfe.com.br/v2/nfe/ref-1': { status: 200, corpo: { status: 'cancelado', status_sefaz: '135' } } });
    expect((await provedor(ok.fn).cancelar(emitente, 'ref-1', 'Venda desfeita pelo comprador')).situacao).toBe('cancelada');
    expect(ok.chamadas.at(-1)!.corpo).toEqual({ justificativa: 'Venda desfeita pelo comprador' });

    const nao = falso({ ...EMPRESA, 'DELETE https://homologacao.focusnfe.com.br/v2/nfe/ref-1': { status: 422, corpo: { status: 'erro_cancelamento', status_sefaz: '501', mensagem_sefaz: 'Prazo de cancelamento superior' } } });
    expect(await provedor(nao.fn).cancelar(emitente, 'ref-1', 'Venda desfeita pelo comprador')).toMatchObject({
      situacao: 'cancelamento_rejeitado', motivo: expect.stringContaining('501 Prazo'),
    });
  });

  it('carta de correção autorizada traz a sequência da Focus', async () => {
    const f = falso({
      ...EMPRESA,
      'POST https://homologacao.focusnfe.com.br/v2/nfe/ref-1/carta_correcao': { status: 200, corpo: { status: 'autorizado', numero_carta_correcao: 2 } },
    });
    const r = await provedor(f.fn).cartaDeCorrecao(emitente, 'ref-1', 'Cor do veículo é prata, não preta');
    expect(r).toMatchObject({ situacao: 'autorizada', sequencia: 2 });
    expect(f.chamadas.at(-1)!.corpo).toEqual({ correcao: 'Cor do veículo é prata, não preta' });
  });

  it('o XML vem do caminho da consulta, no host do ambiente', async () => {
    const f = falso({
      ...EMPRESA,
      'GET https://homologacao.focusnfe.com.br/v2/nfe/ref-1': { status: 200, corpo: { status: 'autorizado', caminho_xml_nota_fiscal: '/arquivos/x/nfe.xml' } },
      'GET https://homologacao.focusnfe.com.br/arquivos/x/nfe.xml': { status: 200, texto: '<nfeProc/>' },
    });
    expect(Buffer.from(await provedor(f.fn).baixarXml(emitente, 'ref-1')).toString()).toBe('<nfeProc/>');
  });

  it('sem conta da loja, ou em produção sem a liberação, recusa antes de chamar a Focus', async () => {
    const f = falso({});
    const p = provedor(f.fn);
    await expect(p.emitir({ contaExterna: null, ambiente: 'homologacao' }, { referencia: 'r', nota })).rejects.toThrow(ConflictException);
    await expect(p.emitir({ contaExterna: '77', ambiente: 'producao' }, { referencia: 'r', nota })).rejects.toThrow(/homologação/);
    expect(f.chamadas).toHaveLength(0);
  });

  it('credencial recusada não vaza o token na mensagem', async () => {
    const f = falso({ 'GET https://api.focusnfe.com.br/v2/empresas/77': { status: 401, texto: 'HTTP Basic: Access denied.' } });
    const erro = await provedor(f.fn).consultar(emitente, 'ref-1').catch((e: Error) => e);
    expect((erro as Error).message).toContain('recusou a credencial');
    expect((erro as Error).message).not.toContain(MASTER);
  });

  describe('cadastro da empresa com o certificado', () => {
    const dados = {
      contaExterna: null, cnpj: '11222333000181', razaoSocial: 'Loja Ltda', nomeFantasia: 'Loja',
      inscricaoEstadual: '110042490114', regime: 'simples_nacional' as const, email: 'loja@exemplo.test',
      endereco: nota.emitente.endereco,
    };
    const cert = { arquivoBase64: 'QUJD'.repeat(40), senha: 'senha-do-pfx' };

    it('cria a empresa pelo master, devolve o id e cria o gatilho com o nosso token', async () => {
      const f = falso({
        'POST https://api.focusnfe.com.br/v2/empresas': {
          status: 200, corpo: { id: 77, certificado_valido_ate: '2027-10-01T00:00:00-03:00', certificado_cnpj: '11222333000181' },
        },
        ...EMPRESA,
        'POST https://homologacao.focusnfe.com.br/v2/hooks': { status: 200, corpo: { id: 'h1' } },
      });
      const r = await provedor(f.fn, { urlDoWebhook: 'https://api.exemplo.test/api/v1/webhooks/nota-fiscal' })
        .registrarEmitente(dados, cert);

      expect(r).toEqual({ contaExterna: '77', certificadoValidoAte: '2027-10-01T00:00:00-03:00', certificadoCnpj: '11222333000181' });
      const cadastro = f.chamadas[0]!;
      expect(cadastro.auth).toBe(MASTER);
      expect(cadastro.corpo).toMatchObject({
        cnpj: '11222333000181', regime_tributario: 1, habilita_nfe: true,
        arquivo_certificado_base64: cert.arquivoBase64, senha_certificado: 'senha-do-pfx',
      });
      const gatilho = f.chamadas.find((c) => c.url.endsWith('/v2/hooks'))!;
      expect(gatilho.auth).toBe(TOKENS.token_homologacao);
      expect(gatilho.corpo).toEqual({
        cnpj: '11222333000181', event: 'nfe', url: 'https://api.exemplo.test/api/v1/webhooks/nota-fiscal',
        authorization: SEGREDO, authorization_header: 'x-nfe-token',
      });
    });

    it('com conta já existente, atualiza (PUT) em vez de criar outra', async () => {
      const f = falso({ 'PUT https://api.focusnfe.com.br/v2/empresas/77': { status: 200, corpo: { id: 77 } } });
      await provedor(f.fn).registrarEmitente({ ...dados, contaExterna: '77' }, cert);
      expect(f.chamadas[0]!.metodo).toBe('PUT');
    });

    it('certificado recusado vira 400 com o motivo da Focus', async () => {
      const f = falso({
        'POST https://api.focusnfe.com.br/v2/empresas': {
          status: 422, corpo: { codigo: 'erro_validacao', erros: [{ campo: 'arquivo_certificado_base64', mensagem: 'Certificado de outro CNPJ' }] },
        },
      });
      await expect(provedor(f.fn).registrarEmitente(dados, cert)).rejects.toThrow(BadRequestException);
    });
  });

  describe('webhook', () => {
    const corpo = Buffer.from(JSON.stringify({ ref: 'ref-1', status: 'autorizado', chave_nfe: 'NFe35261011222333000181550010000012341123456787' }));

    it('sem o nosso token é 401', () => {
      expect(() => provedor(falso({}).fn).interpretarWebhook({ 'x-nfe-token': 'outro' }, corpo)).toThrow(UnauthorizedException);
    });

    it('com o token, traduz; a mesma entrega tem sempre o mesmo id', () => {
      const p = provedor(falso({}).fn);
      const a = p.interpretarWebhook({ 'x-nfe-token': SEGREDO }, corpo);
      const b = p.interpretarWebhook({ 'x-nfe-token': SEGREDO }, corpo);
      expect(a.retorno).toMatchObject({ referencia: 'ref-1', situacao: 'autorizada', chave: '35261011222333000181550010000012341123456787', protocolo: null });
      expect(a.idDaEntrega).toBe(b.idDaEntrega);
    });
  });
});
