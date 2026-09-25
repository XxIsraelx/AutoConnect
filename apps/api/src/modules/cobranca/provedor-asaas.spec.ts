import { UnauthorizedException } from '@nestjs/common';
import {
  ErroAsaas, EVENTOS_ASAAS, ProvedorAsaas, dataAsaas, deDataHoraAsaas, paraReais, statusDaFatura,
} from './provedor-asaas';
import { CABECALHO_TOKEN_ASAAS } from './token-webhook';

/**
 * O `fetch` é dublado — nenhuma requisição sai daqui.
 *
 * **As respostas dubladas são cópias das que o sandbox da Asaas devolveu de
 * verdade** numa validação ponta a ponta em 25/09/2026 (criar cliente,
 * atualizar, criar assinatura, listar cobranças, confirmar o pagamento pelo
 * recurso de sandbox, cancelar duas vezes). Campos que não usamos ficaram no
 * fixture de propósito: é o que faz este teste valer como rede de proteção em
 * vez de só concordar com o adaptador.
 *
 * O que **não** foi validado contra a Asaas: a entrega real do webhook (a URL
 * cadastrada na conta aponta para produção). Os payloads de webhook aqui vêm
 * dos exemplos oficiais da documentação — inclusive o `dateCreated` sem fuso,
 * que é o formato que ela publica.
 */

const TOKEN_WEBHOOK = 'token-do-webhook';
const CHAVE = '$aact_hmlg_chave_ficticia';

interface Chamada { url: string; init: RequestInit }

function provedor(respostas: (c: Chamada) => { status?: number; corpo?: unknown; texto?: string }) {
  const chamadas: Chamada[] = [];
  const falso = ((url: string, init: RequestInit) => {
    const chamada = { url, init };
    chamadas.push(chamada);
    const { status = 200, corpo, texto } = respostas(chamada);
    const conteudo = texto !== undefined ? texto : JSON.stringify(corpo ?? {});
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(conteudo),
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

/* ── Respostas reais do sandbox, copiadas ─────────────────────────── */

/** `POST /v3/customers` — 200. */
const CLIENTE_CRIADO = {
  object: 'customer',
  id: 'cus_000009236901',
  dateCreated: '2026-09-25',
  name: 'Loja de Validação LTDA',
  email: 'loja@exemplo.test',
  company: null,
  phone: null,
  mobilePhone: '11999998888',
  address: 'Avenida Paulista',
  addressNumber: null,
  province: 'Bela Vista',
  postalCode: '01310100',
  cpfCnpj: '11222333000181',
  personType: 'JURIDICA',
  deleted: false,
  externalReference: 'tenant-uuid',
  notificationDisabled: false,
  canDelete: true,
  canEdit: true,
  city: 15873,
  cityName: 'São Paulo',
  state: 'SP',
  country: 'Brasil',
};

/**
 * `POST /v3/subscriptions` — 200.
 *
 * ⚠ Pedimos `nextDueDate: 2026-09-28`. A Asaas gerou a primeira cobrança para
 * 28/09 **e respondeu 28/10**: o campo é o ciclo seguinte.
 */
const ASSINATURA_CRIADA = {
  object: 'subscription',
  id: 'sub_bvd0y3fephsyvduy',
  dateCreated: '2026-09-25',
  customer: 'cus_000009236901',
  paymentLink: null,
  value: 279,
  nextDueDate: '2026-10-28',
  cycle: 'MONTHLY',
  description: 'AutoConnect — plano Essencial',
  billingType: 'UNDEFINED',
  deleted: false,
  status: 'ACTIVE',
  externalReference: 'assinatura-uuid',
  checkoutSession: null,
  sendPaymentByPostalService: false,
  fine: { value: 0, type: 'FIXED' },
  interest: { value: 0, type: 'PERCENTAGE' },
  split: null,
};

/** Um item de `GET /v3/subscriptions/:id/payments` — cobrança em aberto. */
const COBRANCA_PENDENTE = {
  object: 'payment',
  id: 'pay_gzrrsylbm5gefrtp',
  dateCreated: '2026-09-25',
  customer: 'cus_000009236901',
  subscription: 'sub_bvd0y3fephsyvduy',
  paymentLink: null,
  value: 279,
  netValue: 272.96,
  originalValue: null,
  interestValue: null,
  description: 'AutoConnect — plano Essencial',
  // O nosso padrão. A `invoiceUrl` veio preenchida mesmo assim.
  billingType: 'UNDEFINED',
  status: 'PENDING',
  dueDate: '2026-09-28',
  originalDueDate: '2026-09-28',
  paymentDate: null,
  clientPaymentDate: null,
  installmentNumber: null,
  invoiceUrl: 'https://sandbox.asaas.com/i/gzrrsylbm5gefrtp',
  invoiceNumber: '18224402',
  externalReference: 'assinatura-uuid',
  deleted: false,
  nossoNumero: '13371885',
  bankSlipUrl: 'https://sandbox.asaas.com/b/pdf/gzrrsylbm5gefrtp',
  discount: { value: 0, limitDate: null, dueDateLimitDays: 0, type: 'FIXED' },
  fine: { value: 0, type: 'FIXED' },
  interest: { value: 0, type: 'PERCENTAGE' },
  postalService: false,
  escrow: null,
  refunds: null,
};

/** A mesma cobrança depois do `POST /v3/sandbox/payment/:id/confirm`. */
const COBRANCA_PAGA = {
  ...COBRANCA_PENDENTE,
  netValue: 278.01,
  // A Asaas fecha o `UNDEFINED` no meio que o cliente escolheu.
  billingType: 'BOLETO',
  canBePaidAfterDueDate: true,
  confirmedDate: '2026-09-25',
  status: 'RECEIVED',
  paymentDate: '2026-09-25',
  clientPaymentDate: '2026-09-25',
  creditDate: '2026-09-25',
  estimatedCreditDate: '2026-09-25',
  transactionReceiptUrl: 'https://sandbox.asaas.com/comprovantes/h/UEFZTUVOVF9SRUNFSVZFRA',
};

const lista = (itens: unknown[]) => ({
  object: 'list',
  hasMore: false,
  totalCount: itens.length,
  limit: 10,
  offset: 0,
  data: itens,
});

describe('ProvedorAsaas — configuração', () => {
  it('monta a base com /v3 e reconhece o sandbox', () => {
    const { p } = provedor(() => ({}));
    expect(p.nome).toBe('asaas');
    expect(p.disponivel).toBe(true);
    // Sandbox em destaque: nada cobrado ali é dinheiro de verdade.
    expect(p.sandbox).toBe(true);
  });

  it('a chave vai no cabeçalho access_token, não em Authorization: Bearer', async () => {
    const { p, chamadas } = provedor(() => ({ corpo: CLIENTE_CRIADO }));
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
    const { p, chamadas } = provedor(() => ({ corpo: CLIENTE_CRIADO }));
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

  it('atualizar cliente existente vai no id e devolve o MESMO id, não cria um segundo', async () => {
    // Validado no sandbox: o segundo POST em /customers/:id devolveu o mesmo
    // id com os campos novos, e a busca por externalReference seguiu com um só.
    const { p, chamadas } = provedor(() => ({
      corpo: { ...CLIENTE_CRIADO, name: 'Loja LTDA (renomeada)' },
    }));
    const r = await p.salvarCliente(
      { referencia: 't1', nome: 'Loja LTDA (renomeada)', email: 'l@e.test', cnpj: '11222333000181' },
      'cus_000009236901',
    );
    expect(chamadas[0]!.url).toBe('https://api-sandbox.asaas.com/v3/customers/cus_000009236901');
    expect(r.idExterno).toBe('cus_000009236901');
  });

  it('assinatura mensal, valor em reais e a nossa assinatura como referência', async () => {
    const { p, chamadas } = provedor(() => ({ corpo: ASSINATURA_CRIADA }));
    const r = await p.criarAssinatura({
      idClienteExterno: 'cus_000009236901',
      plano: 'essencial',
      valorCentavos: 27_900n,
      meio: 'indefinido',
      primeiroVencimento: new Date('2026-09-28T12:00:00.000Z'),
      descricao: 'AutoConnect — plano Essencial',
      referencia: 'assinatura-uuid',
    });

    expect(corpoDe(chamadas[0]!)).toMatchObject({
      customer: 'cus_000009236901',
      // `UNDEFINED` deixa o cliente escolher Pix, boleto ou cartão na fatura —
      // 55,9% dos compradores de SaaS no Brasil não usam cartão.
      billingType: 'UNDEFINED',
      value: 279,
      cycle: 'MONTHLY',
      nextDueDate: '2026-09-28',
      externalReference: 'assinatura-uuid',
    });
    expect(r.idExterno).toBe('sub_bvd0y3fephsyvduy');
  });

  it('o `proximoVencimento` devolvido é o CICLO SEGUINTE, não a primeira fatura', async () => {
    // A armadilha que custou um mês de carência: pedimos 28/09, a Asaas gerou
    // a cobrança para 28/09 e respondeu `nextDueDate: 2026-10-28`. Quem
    // calcula carência com este campo dá 37 dias em vez de 10 — por isso o
    // `cobranca.service` usa o vencimento que *pediu*.
    const { p } = provedor(() => ({ corpo: ASSINATURA_CRIADA }));
    const r = await p.criarAssinatura({
      idClienteExterno: 'cus_000009236901', plano: 'essencial', valorCentavos: 27_900n,
      meio: 'indefinido', primeiroVencimento: new Date('2026-09-28T12:00:00.000Z'),
      descricao: 'x', referencia: 'assinatura-uuid',
    });
    expect(r.proximoVencimento?.toISOString()).toBe('2026-10-28T12:00:00.000Z');
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

describe('ProvedorAsaas — fatura', () => {
  it('lê o envelope `list` da Asaas e traz a cobrança em aberto com o link', async () => {
    const { p, chamadas } = provedor(() => ({ corpo: lista([COBRANCA_PENDENTE]) }));
    const f = await p.faturaAtual('sub_bvd0y3fephsyvduy');

    expect(chamadas[0]!.url).toBe(
      'https://api-sandbox.asaas.com/v3/subscriptions/sub_bvd0y3fephsyvduy/payments?limit=10',
    );
    expect(f).toMatchObject({
      idExterno: 'pay_gzrrsylbm5gefrtp',
      status: 'pendente',
      valorCentavos: 27_900n,
      // `billingType: UNDEFINED` e a `invoiceUrl` veio preenchida do mesmo
      // jeito — é ela que a tela mostra.
      meio: 'indefinido',
      urlPagamento: 'https://sandbox.asaas.com/i/gzrrsylbm5gefrtp',
      pagoEm: null,
    });
    expect(f!.vencimento.toISOString()).toBe('2026-09-28T12:00:00.000Z');
  });

  it('depois do pagamento o meio deixa de ser indefinido e a data de pagamento aparece', async () => {
    const { p } = provedor(() => ({ corpo: lista([COBRANCA_PAGA]) }));
    const f = await p.faturaAtual('sub_bvd0y3fephsyvduy');
    expect(f).toMatchObject({ status: 'paga', meio: 'boleto' });
    expect(f!.pagoEm?.toISOString()).toBe('2026-09-25T12:00:00.000Z');
  });

  it('assinatura sem cobrança nenhuma é 200 com `data` vazio — e vira null, não erro', async () => {
    // A Asaas não devolve 404 aqui: id inexistente também responde 200 com
    // `totalCount: 0`. Tratar como erro faria a tela quebrar à toa.
    const { p } = provedor(() => ({ corpo: lista([]) }));
    await expect(p.faturaAtual('sub_nao_existe')).resolves.toBeNull();
  });

  it('sem nenhuma em aberto, escolhe a de vencimento mais recente', async () => {
    const antiga = { ...COBRANCA_PAGA, id: 'pay_antiga', dueDate: '2026-08-28' };
    const recente = { ...COBRANCA_PAGA, id: 'pay_recente', dueDate: '2026-09-28' };
    // Fora de ordem de propósito: a ordem da lista não é contrato da Asaas.
    const { p } = provedor(() => ({ corpo: lista([antiga, recente]) }));
    await expect(p.faturaAtual('sub_1')).resolves.toMatchObject({ idExterno: 'pay_recente' });
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

  it('cancelar responde 200 { deleted: true } — e cancelar de novo também', async () => {
    // Validado no sandbox: a Asaas já é idempotente no DELETE da assinatura.
    // O duplo clique do cliente não produz erro nenhum dos dois lados.
    const { p, chamadas } = provedor(() => ({ corpo: { deleted: true, id: 'sub_bvd0y3fephsyvduy' } }));
    await expect(p.cancelarAssinatura('sub_bvd0y3fephsyvduy')).resolves.toBeUndefined();
    await expect(p.cancelarAssinatura('sub_bvd0y3fephsyvduy')).resolves.toBeUndefined();
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]!.init.method).toBe('DELETE');
  });

  it('assinatura que nunca existiu é 404 de CORPO VAZIO — e continua no-op', async () => {
    // Validado no sandbox: 404 sem corpo nenhum. O adaptador não pode depender
    // de `errors` para reconhecer o caso.
    const { p } = provedor(() => ({ status: 404, texto: '' }));
    await expect(p.cancelarAssinatura('sub_nunca_existiu')).resolves.toBeUndefined();
  });
});

describe('ProvedorAsaas — webhook', () => {
  const entrega = (payload: unknown, token = TOKEN_WEBHOOK) => ({
    cabecalhos: { [CABECALHO_TOKEN_ASAAS]: token },
    corpo: Buffer.from(JSON.stringify(payload)),
  });

  /**
   * Envelope do exemplo oficial: `id` de evento com `&`, `dateCreated` com
   * espaço e **sem fuso**, e o objeto `payment` inteiro.
   */
  const pagamentoRecebido = {
    id: 'evt_05b708f961d739ea7eba7e4db318f621&368604920',
    event: 'PAYMENT_RECEIVED',
    dateCreated: '2026-10-05 14:30:00',
    payment: { ...COBRANCA_PAGA, dueDate: '2026-10-04', billingType: 'PIX', status: 'RECEIVED' },
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

  it('o cabeçalho conferido é exatamente `asaas-access-token`', () => {
    // É o que a doc publica e o que sustenta a autenticidade da entrega: um
    // erro de grafia aqui rejeitaria todo webhook legítimo.
    expect(CABECALHO_TOKEN_ASAAS).toBe('asaas-access-token');
  });

  it('traduz o pagamento recebido e normaliza a fatura', () => {
    const { p } = provedor(() => ({}));
    const e = entrega(pagamentoRecebido);
    const evento = p.interpretarWebhook(e.cabecalhos, e.corpo);

    expect(evento).toMatchObject({
      tipo: 'pagamento_confirmado',
      // O id do evento é a chave de idempotência; o SHA-256 do corpo é o plano B.
      idEvento: 'evt_05b708f961d739ea7eba7e4db318f621&368604920',
      idAssinaturaExterna: 'sub_bvd0y3fephsyvduy',
      referencia: 'assinatura-uuid',
    });
    expect(evento.fatura).toMatchObject({
      idExterno: 'pay_gzrrsylbm5gefrtp', status: 'paga', valorCentavos: 27_900n, meio: 'pix',
      urlPagamento: 'https://sandbox.asaas.com/i/gzrrsylbm5gefrtp',
    });
    expect(evento.fatura!.vencimento.toISOString()).toBe('2026-10-04T12:00:00.000Z');
  });

  it('`dateCreated` sem fuso é lido no horário de Brasília, não no do servidor', () => {
    // A Asaas renderiza no fuso da conta e omite o offset. Em `new Date()` cru
    // isso viraria horário LOCAL: 14:30 significaria um instante na máquina do
    // dev (São Paulo) e outro no Railway (UTC). `ocorridoEm` abre a carência
    // quando o evento chega sem fatura — não pode depender de onde roda.
    const { p } = provedor(() => ({}));
    const e = entrega({ ...pagamentoRecebido, payment: undefined });
    expect(p.interpretarWebhook(e.cabecalhos, e.corpo).ocorridoEm.toISOString())
      .toBe('2026-10-05T17:30:00.000Z');
  });

  it('a leitura de data e hora aguenta o que a Asaas manda, e o que ela não manda', () => {
    expect(deDataHoraAsaas('2026-10-05 14:30:00')!.toISOString()).toBe('2026-10-05T17:30:00.000Z');
    // Data pura cai ao meio-dia UTC, como no resto do adaptador.
    expect(deDataHoraAsaas('2026-10-05')!.toISOString()).toBe('2026-10-05T12:00:00.000Z');
    // Se um dia ela passar a mandar o fuso, o que veio manda.
    expect(deDataHoraAsaas('2026-10-05T14:30:00Z')!.toISOString()).toBe('2026-10-05T14:30:00.000Z');
    expect(deDataHoraAsaas('lixo')).toBeNull();
    expect(deDataHoraAsaas(undefined)).toBeNull();
  });

  it('CONFIRMED e RECEIVED liberam os dois', () => {
    // Para o cliente o pagamento já aconteceu; segurar a loja bloqueada até o
    // dinheiro compensar puniria quem pagou. A repetição é tratada pela chave
    // de idempotência.
    expect(EVENTOS_ASAAS.PAYMENT_CONFIRMED).toBe('pagamento_confirmado');
    expect(EVENTOS_ASAAS.PAYMENT_RECEIVED).toBe('pagamento_confirmado');
  });

  it('evento que não conhecemos é `ignorado`, não erro', () => {
    // O webhook da conta está inscrito em TODOS os eventos, então
    // PAYMENT_CREATED, SUBSCRIPTION_CREATED e companhia chegam de verdade.
    const { p } = provedor(() => ({}));
    const e = entrega({ id: 'evt_2', event: 'PAYMENT_CREATED', payment: COBRANCA_PENDENTE });
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
