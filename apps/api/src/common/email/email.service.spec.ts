import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService, esc } from './email.service';
import { montarEmail } from './layout';

type Enviado = { to: string; subject: string; html: string };

/** Serviço com um transporte SMTP falso que guarda o que seria enviado. */
function servico() {
  const enviados: Enviado[] = [];
  const svc = new EmailService(new ConfigService({ WEB_URL: 'https://app.test' }));
  Object.assign(svc, {
    smtp: {
      sendMail: async (m: Enviado) => {
        enviados.push(m);
        return { messageId: 'x' };
      },
    },
  });
  return { svc, enviados };
}

beforeAll(() => Logger.overrideLogger(false));

describe('esc', () => {
  it('escapa os cinco caracteres que abrem HTML ou atributo', () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('EmailService — conteúdo vindo de formulário', () => {
  it('nome e mensagem do cliente não viram HTML no e-mail da loja', async () => {
    const { svc, enviados } = servico();

    await svc.sendLeadNotification({
      to: 'loja@test',
      dealerName: 'Silva & Filhos',
      customerName: '<a href="https://golpe.test">Clique aqui</a>',
      vehicleInfo: 'Onix LT 2024',
      message: '<img src=x onerror=alert(1)>',
      leadUrl: 'https://app.test/leads',
    });

    const { html, subject } = enviados[0];
    expect(html).not.toContain('href="https://golpe.test"');
    // O layout tem a imagem do logo; o que não pode aparecer é a do formulário.
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;a href=&quot;https://golpe.test&quot;&gt;');
    expect(html).toContain('Silva &amp; Filhos');
    // Assunto é cabeçalho, não HTML: escapar mostraria "&amp;" na caixa de entrada.
    expect(subject).toBe('Novo interesse recebido — Onix LT 2024');
  });

  it('observação da loja na avaliação de troca também é escapada', async () => {
    const { svc, enviados } = servico();

    await svc.sendTradeInAppraisal({
      to: 'cliente@test',
      customerName: 'Ana',
      dealerName: 'Loja',
      offeredVehicle: 'Gol 2015',
      value: 30000,
      desiredVehicle: null,
      desiredPrice: null,
      note: '</p><a href="https://golpe.test">pague aqui</a>',
    });

    expect(enviados[0].html).not.toContain('href="https://golpe.test"');
  });

  it('o nome da loja no convite vai escapado no corpo e cru no assunto', async () => {
    const { svc, enviados } = servico();

    await svc.sendTeamInvite({
      to: 'vendedor@test',
      inviteUrl: 'https://app.test/invite/abc',
      roleLabel: 'Vendedor',
      tenantName: 'Silva & Filhos',
    });

    expect(enviados[0].html).toContain('<strong>Silva &amp; Filhos</strong>');
    expect(enviados[0].subject).toBe('Convite para a equipe da Silva & Filhos');
  });
});

describe('EmailService — diagnóstico do provedor na inicialização', () => {
  const nu = () => new EmailService(new ConfigService({}));

  it('SMTP bloqueado (porta fechada no Railway) é acusado, não "ativado"', async () => {
    const svc = nu();
    Object.assign(svc, {
      smtp: { verify: async () => { throw new Error('Connection timeout'); } },
    });

    await expect(svc.verificarProvedor()).resolves.toBe(false);
  });

  it('SMTP que responde passa', async () => {
    const svc = nu();
    Object.assign(svc, { smtp: { verify: async () => true } });

    await expect(svc.verificarProvedor()).resolves.toBe(true);
  });

  it('sem provedor nenhum não finge estar pronto', async () => {
    await expect(nu().verificarProvedor()).resolves.toBe(false);
  });

  const comResend = (from: string, list: () => Promise<unknown>) => {
    const svc = nu();
    Object.assign(svc, { from, resend: { domains: { list } } });
    return svc;
  };

  it('remetente de teste da Resend é acusado — só entrega ao dono da conta', async () => {
    const svc = comResend('AutoConnect <onboarding@resend.dev>', async () => {
      throw new Error('não deveria nem consultar');
    });

    await expect(svc.verificarProvedor()).resolves.toBe(false);
  });

  it('domínio do EMAIL_FROM sem verificação é acusado', async () => {
    const svc = comResend('AutoConnect <nao-responda@loja.com.br>', async () => ({
      data: { data: [{ name: 'loja.com.br', status: 'pending' }] },
      error: null,
    }));

    await expect(svc.verificarProvedor()).resolves.toBe(false);
  });

  it('domínio verificado passa', async () => {
    const svc = comResend('AutoConnect <nao-responda@loja.com.br>', async () => ({
      data: { data: [{ name: 'loja.com.br', status: 'verified' }] },
      error: null,
    }));

    await expect(svc.verificarProvedor()).resolves.toBe(true);
  });

  it('chave só de envio (não lista domínios) é válida', async () => {
    const svc = comResend('AutoConnect <nao-responda@loja.com.br>', async () => ({
      data: null,
      error: { name: 'restricted_api_key', message: 'restricted' },
    }));

    await expect(svc.verificarProvedor()).resolves.toBe(true);
  });

  it('chave inválida é acusada', async () => {
    const svc = comResend('AutoConnect <nao-responda@loja.com.br>', async () => ({
      data: null,
      error: { name: 'invalid_api_key', message: 'API key is invalid' },
    }));

    await expect(svc.verificarProvedor()).resolves.toBe(false);
  });
});

describe('EmailService — Resend', () => {
  it('e-mail recusado pela Resend vira erro, não "enviado"', async () => {
    const { svc } = servico();
    // O SDK devolve o erro em vez de lançar.
    Object.assign(svc, {
      resend: {
        emails: {
          send: async () => ({
            data: null,
            error: { name: 'validation_error', message: 'domain is not verified' },
          }),
        },
      },
    });

    await expect(svc.sendPasswordReset('ana@test', 'Ana', 'tok')).rejects.toThrow(
      /domain is not verified/,
    );
  });
});

describe('layout único', () => {
  const marca = { webUrl: 'https://app.test/', suporte: 'suporte@app.test' };

  it('escapa os campos de texto puro e leva preheader, botão com endereço por extenso e rodapé', () => {
    const html = montarEmail({
      etiqueta: 'Cobrança <x>',
      titulo: 'Título & cia',
      preheader: 'Linha da caixa de entrada',
      paragrafos: ['<strong>seguro</strong>'],
      detalhes: [{ rotulo: 'Loja', valor: '<script>alert(1)</script>' }],
      botao: { texto: 'Abrir', url: 'https://app.test/x?a=1&b=2' },
      motivo: 'Você recebeu porque sim.',
    }, marca);

    expect(html).toContain('Cobrança &lt;x&gt;');
    expect(html).toContain('<title>Título &amp; cia</title>');
    expect(html).toContain('Linha da caixa de entrada');
    expect(html).toContain('<strong>seguro</strong>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('href="https://app.test/x?a=1&amp;b=2"');
    expect(html).toContain('Se o botão não funcionar');
    expect(html).toContain('mailto:suporte@app.test');
    expect(html).toContain('src="https://app.test/icon-192.png"');
  });
});

describe('EmailService — cobrança', () => {
  it('contratação traz plano, ciclo, valor em reais, vencimento e o link de pagamento', async () => {
    const { svc, enviados } = servico();
    await svc.sendAssinaturaContratada({
      to: 'loja@test', dealerName: 'Auto Sul', plano: 'Essencial', ciclo: 'anual',
      valor: '1970.00', vencimento: new Date('2026-10-01T15:00:00Z'), urlPagamento: 'https://pagar.test/1',
    });
    const { html, subject } = enviados[0];
    expect(subject).toBe('Assinatura contratada: plano Essencial — AutoConnect');
    expect(html).toContain('Anual');
    expect(html).toMatch(/R\$\s1\.970,00/);
    expect(html).toContain('01 de outubro de 2026');
    expect(html).toContain('href="https://pagar.test/1"');
  });

  it('pagamento confirmado, cancelamento e cortesia saem com o assunto certo', async () => {
    const { svc, enviados } = servico();
    await svc.sendPagamentoConfirmado({
      to: 'l@t', dealerName: 'Auto Sul', plano: 'Crescimento', valor: '347.00',
      pagoEm: new Date('2026-10-01T15:00:00Z'), proximaCobranca: new Date('2026-10-31T15:00:00Z'),
    });
    await svc.sendAssinaturaCancelada({ to: 'l@t', dealerName: 'Auto Sul', plano: 'Crescimento', origem: 'estorno' });
    await svc.sendCortesiaConcedida({ to: 'l@t', dealerName: 'Auto Sul', motivo: 'Loja fundadora', plano: 'Crescimento' });
    await svc.sendCortesiaRevogada({ to: 'l@t', dealerName: 'Auto Sul', prazo: new Date('2026-10-04T15:00:00Z') });

    expect(enviados.map((e) => e.subject)).toEqual([
      'Pagamento confirmado — AutoConnect',
      'Assinatura cancelada — AutoConnect',
      'Sua loja agora é cortesia — AutoConnect',
      'A cortesia da sua loja foi encerrada — AutoConnect',
    ]);
    expect(enviados[0].html).toContain('31 de outubro de 2026');
    expect(enviados[1].html).toContain('foi estornado');
    expect(enviados[2].html).toContain('loja fundadora');
    expect(enviados[3].html).toContain('04 de outubro de 2026');
  });
});
