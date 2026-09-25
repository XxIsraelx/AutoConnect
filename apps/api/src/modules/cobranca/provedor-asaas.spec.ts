import { UnauthorizedException } from '@nestjs/common';
import { ErroAsaas, EVENTOS_ASAAS, ProvedorAsaas, dataAsaas, paraReais, statusDaFatura } from './provedor-asaas';
import { CABECALHO_TOKEN_ASAAS } from './token-webhook';

/**
 * O adaptador da Asaas nunca falou com a Asaas — não há conta ainda. O que
 * este teste prova é o que **não** depende da conta: o que sai no corpo da
 * chamada, o que entra pelo webhook e o que acontece quando ela responde erro.
 *
 * O `fetch` é dublado. Nenhuma requisição sai daqui.
 */

const TOKEN_WEBHOOK = 'token-do-webhook';
const CHAVE = '$aact_hmlg_chave_ficticia';

interface Chamada { url: string; init: RequestInit }

function provedor(respostas: (c: Chamada) => { status?: number; corpo?: unknown }) {
  const chamadas: Chamada[] = [];
  const falso = ((url: string, init: RequestInit) => {
    const chamada = { url, init };
    chamadas.push(chamada);
    const { status = 200, corpo = {} } = respostas(chamada);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(corpo)),
    } as Response);
  }) as unknown as typeof fetch;

  return {
    chamadas,
    p: new ProvedorAsaas({
      apiUrl: 'https://api-sandbox.asaas.com',
      apiKey: CHAVE,
      tokenWebhook: TOKEN_WEBHOOK,
      fetch: falso,
    }),
  };
}

const corpoDe = (c: Chamada) => JSON.parse(String(c.init.body)) as Record<string, unknown>;

describe('ProvedorAsaas — configuração', () => {
  it('monta a base com /v3 e reconhece o sandbox', () => {
    const { p } = provedor(() => ({}));
    expect(p.nome).toBe('asaas');
    expect(p.disponivel).toBe(true);
    // Sandbox em destaque: nada cobrado ali é dinheiro de verdade.
    expect(p.sandbox).toBe(true);
  });

  it('a chave vai no cabeçalho access_token, não em Authorization: Bearer', async () => {
    const { p, chamadas } = provedor(() => ({ corpo: { id: 'cus_1' } }));
    await p.salvarCliente({
      referencia: 't1', nome: 'Loja LTDA', email: 'loja@exemplo.test', cnpj: '11.222.333/0001-81',
    });

    const cabecalhos = chamadas[0]!.init.headers as Record<string, string>;
    expect(cabecalhos.access_token).toBe(CHAVE);
    expect(cabecalhos.Authorization).toBeUndefined();
    expect(chamadas[0]!.url).toBe('https://api-sandbox.asaas.com/v3/customers');
  });
});

describe('ProvedorAsaas — o que sai no corpo', () => {
  it('cliente vai com CNPJ só em dígitos e a loja como referência externa', async () => {
    const { p, chamadas } = provedor(() => ({ corpo: { id: 'cus_1' } }));
    await p.salvarCliente({
      referencia: 'tenant-uuid', nome: 'Loja LTDA', email: 'loja@exemplo.test',
      cnpj: '11.222.333/0001-81', telefone: '(11) 99999-8888', cep: '01310-100',
    });

    expect(corpoDe(chamadas[0]!)).toMatchObject({
      cpfCnpj: '11222333000181',
      externalReference: 'tenant-uuid',
      mobilePhone: '11999998888',
      postalCode: '01310100',
    });
  });

  it('atualizar cliente existente vai no id, não cria um segundo', async () => {
    const { p, chamadas } = provedor(() => ({ corpo: { id: 'cus_ja_existe' } }));
    await p.salvarCliente(
      { referencia: 't1', nome: 'Loja', email: 'l@e.test', cnpj: '11222333000181' },
      'cus_ja_existe',
    );
    expect(chamadas[0]!.url).toBe('https://api-sandbox.asaas.com/v3/customers/cus_ja_existe');
  });

  it('assinatura mensal, valor em reais e a nossa assinatura como referência', async () => {
    const { p, chamadas } = provedor(() => ({ corpo: { id: 'sub_1', nextDueDate: '2026-10-04' } }));
    const r = await p.criarAssinatura({
      idClienteExterno: 'cus_1',
      plano: 'crescimento',
      valorCentavos: 47_900n,
      meio: 'indefinido',
      primeiroVencimento: new Date('2026-10-04T12:00:00.000Z'),
      descricao: 'AutoConnect — plano Crescimento',
      referencia: 'assinatura-uuid',
    });

    expect(corpoDe(chamadas[0]!)).toMatchObject({
      customer: 'cus_1',
      // `UNDEFINED` deixa o cliente escolher Pix, boleto ou cartão na fatura —
      // 55,9% dos compradores de SaaS no Brasil não usam cartão.
      billingType: 'UNDEFINED',
      value: 479,
      cycle: 'MONTHLY',
      nextDueDate: '2026-10-04',
      externalReference: 'assinatura-uuid',
    });
    expect(r.idExterno).toBe('sub_1');
  });

  it('centavos viram reais sem ponto flutuante pelo caminho', () => {
    expect(paraReais(27_900n)).toBe(279);
    expect(paraReais(47_901n)).toBe(479.01);
    expect(paraReais(1n)).toBe(0.01);
  });

  it('a data vai no formato da Asaas, em UTC — nenhum fuso do Brasil pula o dia', () => {
    expect(dataAsaas(new Date('2026-10-04T23:30:00.000Z'))).toBe('2026-10-04');
  });
});

describe('ProvedorAsaas — erros', () => {
  it('400 e 422 viram 422 com o motivo da Asaas, e nunca com a chave', async () => {
    const { p } = provedor(() => ({
      status: 400,
      corpo: { errors: [{ code: 'invalid_cpfCnpj', description: 'CPF/CNPJ inválido' }] },
    }));

    await expect(
      p.salvarCliente({ referencia: 't', nome: 'x', email: 'a@b.test', cnpj: '1' }),
    ).rejects.toMatchObject({ status: 422 });

    await p
      .salvarCliente({ referencia: 't', nome: 'x', email: 'a@b.test', cnpj: '1' })
      .catch((e: ErroAsaas) => {
        expect(e.message).toContain('CPF/CNPJ inválido');
        expect(e.message).not.toContain(CHAVE);
      });
  });

  it('401 vira 503 apontando a variável certa, sem a chave na mensagem', async () => {
    const { p } = provedor(() => ({ status: 401, corpo: {} }));
    await p
      .criarAssinatura({
        idClienteExterno: 'cus_1', plano: 'essencial', valorCentavos: 27_900n,
        meio: 'pix', primeiroVencimento: new Date(), descricao: 'x', referencia: 'r',
      })
      .catch((e: ErroAsaas) => {
        expect(e.getStatus()).toBe(503);
        expect(e.message).toContain('ASAAS_API_KEY');
        expect(e.message).not.toContain(CHAVE);
      });
  });

  it('429 vira 503, e o resto vira 502', async () => {
    const limite = provedor(() => ({ status: 429, corpo: {} }));
    await limite.p.faturaAtual('sub_1').catch((e: ErroAsaas) => expect(e.getStatus()).toBe(503));

    const quebrou = provedor(() => ({ status: 500, corpo: {} }));
    await quebrou.p.faturaAtual('sub_1').catch((e: ErroAsaas) => expect(e.getStatus()).toBe(502));
  });

  it('cancelar assinatura que já não existe é no-op, não erro', async () => {
    // Cancelar duas vezes acontece: o cliente clica, a resposta demora, ele
    // clica de novo. Estourar aí seria um erro na tela sobre algo que deu certo.
    const { p } = provedor(() => ({ status: 404, corpo: {} }));
    await expect(p.cancelarAssinatura('sub_sumiu')).resolves.toBeUndefined();
  });
});

describe('ProvedorAsaas — webhook', () => {
  const entrega = (payload: unknown, token = TOKEN_WEBHOOK) => ({
    cabecalhos: { [CABECALHO_TOKEN_ASAAS]: token },
    corpo: Buffer.from(JSON.stringify(payload)),
  });

  const pagamentoRecebido = {
    id: 'evt_1',
    event: 'PAYMENT_RECEIVED',
    dateCreated: '2026-10-05T10:00:00.000Z',
    payment: {
      id: 'pay_1', subscription: 'sub_1', externalReference: 'assinatura-uuid',
      value: 279, dueDate: '2026-10-04', billingType: 'PIX',
      invoiceUrl: 'https://sandbox.asaas.com/i/pay_1', paymentDate: '2026-10-05',
      status: 'RECEIVED',
    },
  };

  it('token errado, ausente ou vazio é 401 — antes de qualquer acesso ao banco', () => {
    const { p } = provedor(() => ({}));
    const e = entrega(pagamentoRecebido, 'token-errado');

    expect(() => p.interpretarWebhook(e.cabecalhos, e.corpo)).toThrow(UnauthorizedException);
    expect(() => p.interpretarWebhook({}, e.corpo)).toThrow(UnauthorizedException);
    expect(() => p.interpretarWebhook({ [CABECALHO_TOKEN_ASAAS]: '' }, e.corpo)).toThrow(UnauthorizedException);
    // Cabeçalho repetido chega como array — não pode passar por acidente.
    expect(() =>
      p.interpretarWebhook({ [CABECALHO_TOKEN_ASAAS]: [TOKEN_WEBHOOK] }, e.corpo),
    ).toThrow(UnauthorizedException);
  });

  it('traduz o pagamento recebido e normaliza a fatura', () => {
    const { p } = provedor(() => ({}));
    const e = entrega(pagamentoRecebido);
    const evento = p.interpretarWebhook(e.cabecalhos, e.corpo);

    expect(evento).toMatchObject({
      tipo: 'pagamento_confirmado',
      idEvento: 'evt_1',
      idAssinaturaExterna: 'sub_1',
      referencia: 'assinatura-uuid',
    });
    expect(evento.fatura).toMatchObject({
      idExterno: 'pay_1', status: 'paga', valorCentavos: 27_900n, meio: 'pix',
      urlPagamento: 'https://sandbox.asaas.com/i/pay_1',
    });
    expect(evento.fatura!.vencimento.toISOString()).toBe('2026-10-04T12:00:00.000Z');
  });

  it('CONFIRMED e RECEIVED liberam os dois', () => {
    // Para o cliente o pagamento já aconteceu; segurar a loja bloqueada até o
    // dinheiro compensar puniria quem pagou. A repetição é tratada pela chave
    // de idempotência.
    expect(EVENTOS_ASAAS.PAYMENT_CONFIRMED).toBe('pagamento_confirmado');
    expect(EVENTOS_ASAAS.PAYMENT_RECEIVED).toBe('pagamento_confirmado');
  });

  it('evento que não conhecemos é `ignorado`, não erro', () => {
    const { p } = provedor(() => ({}));
    const e = entrega({ id: 'evt_2', event: 'PAYMENT_CREATED', payment: { id: 'pay_2', value: 279, dueDate: '2026-10-04' } });
    expect(p.interpretarWebhook(e.cabecalhos, e.corpo).tipo).toBe('ignorado');
  });

  it('nome de evento vindo do protótipo não vira tipo por acidente', () => {
    const { p } = provedor(() => ({}));
    const e = entrega({ event: 'constructor' });
    expect(p.interpretarWebhook(e.cabecalhos, e.corpo).tipo).toBe('ignorado');
  });

  it('corpo que não é JSON, ou sem evento, é 400', () => {
    const { p } = provedor(() => ({}));
    const cab = { [CABECALHO_TOKEN_ASAAS]: TOKEN_WEBHOOK };
    expect(() => p.interpretarWebhook(cab, Buffer.from('não é json'))).toThrow();
    expect(() => p.interpretarWebhook(cab, Buffer.from('{}'))).toThrow();
  });

  it('o status da Asaas vira o nosso vocabulário', () => {
    expect(statusDaFatura('RECEIVED')).toBe('paga');
    expect(statusDaFatura('CONFIRMED')).toBe('paga');
    expect(statusDaFatura('OVERDUE')).toBe('vencida');
    expect(statusDaFatura('REFUNDED')).toBe('estornada');
    expect(statusDaFatura('DELETED')).toBe('cancelada');
    expect(statusDaFatura('PENDING')).toBe('pendente');
    expect(statusDaFatura(undefined)).toBe('pendente');
  });
});
