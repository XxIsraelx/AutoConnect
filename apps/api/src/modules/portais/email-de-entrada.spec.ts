import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  EmailDeEntradaIndisponivel,
  EmailDeEntradaPostmark,
  EmailDeEntradaSimulado,
  emailDeEntradaConfigurado,
} from './email-de-entrada';
import { lerEmail, lerWebhook } from './leitores';

const config = (v: Record<string, string | undefined>) =>
  ({ get: (k: string) => v[k] }) as unknown as ConfigService;
const basic = (senha: string) => ({ authorization: `Basic ${Buffer.from(`entrada:${senha}`).toString('base64')}` });
const BASE = { EMAIL_ENTRADA_TOKEN: 't', EMAIL_ENTRADA_ENDERECO: 'leads@entrada.exemplo.com' };

describe('emailDeEntradaConfigurado', () => {
  it('sem fornecedor, desligado', () => {
    expect(emailDeEntradaConfigurado(config({}))).toBeInstanceOf(EmailDeEntradaIndisponivel);
  });

  it('simulado fora de produção; recusado em produção', () => {
    expect(emailDeEntradaConfigurado(config({ ...BASE, EMAIL_ENTRADA_FORNECEDOR: 'simulado', NODE_ENV: 'test' })))
      .toBeInstanceOf(EmailDeEntradaSimulado);
    expect(emailDeEntradaConfigurado(config({ ...BASE, EMAIL_ENTRADA_FORNECEDOR: 'simulado', NODE_ENV: 'production' })))
      .toBeInstanceOf(EmailDeEntradaIndisponivel);
  });

  it('sem token ou sem endereço, desligado; endereço com "+" também', () => {
    expect(emailDeEntradaConfigurado(config({ EMAIL_ENTRADA_FORNECEDOR: 'postmark', EMAIL_ENTRADA_ENDERECO: 'a@b.com' })))
      .toBeInstanceOf(EmailDeEntradaIndisponivel);
    expect(emailDeEntradaConfigurado(config({ EMAIL_ENTRADA_FORNECEDOR: 'postmark', EMAIL_ENTRADA_TOKEN: 't' })))
      .toBeInstanceOf(EmailDeEntradaIndisponivel);
    expect(emailDeEntradaConfigurado(config({
      EMAIL_ENTRADA_FORNECEDOR: 'postmark', EMAIL_ENTRADA_TOKEN: 't', EMAIL_ENTRADA_ENDERECO: 'leads+x@b.com',
    }))).toBeInstanceOf(EmailDeEntradaIndisponivel);
  });

  it('postmark com tudo configurado', () => {
    expect(emailDeEntradaConfigurado(config({ ...BASE, EMAIL_ENTRADA_FORNECEDOR: 'postmark' })))
      .toBeInstanceOf(EmailDeEntradaPostmark);
  });
});

describe('EmailDeEntradaPostmark', () => {
  const p = new EmailDeEntradaPostmark('leads@entrada.exemplo.com', 'senha-do-webhook');
  const corpo = Buffer.from(JSON.stringify({
    MessageID: '22c74902-a0c1-4511-804f2-341342852c90',
    From: 'notificacoes@olx.com.br',
    FromFull: { Email: 'notificacoes@olx.com.br', Name: 'OLX' },
    To: 'vendas@autosul.com.br',
    ToFull: [{ Email: 'vendas@autosul.com.br', Name: '', MailboxHash: '' }],
    OriginalRecipient: `leads+${'b'.repeat(40)}@entrada.exemplo.com`,
    Subject: 'Nova mensagem',
    TextBody: 'Nome: Ana\nTelefone: 11987654321',
    HtmlBody: '<p>Nome: Ana</p>',
  }));

  it('traduz o formato do Postmark, com o destinatário original entre os destinatários', () => {
    expect(p.interpretar(basic('senha-do-webhook'), corpo)).toEqual({
      idExterno: '22c74902-a0c1-4511-804f2-341342852c90',
      de: 'notificacoes@olx.com.br',
      para: ['vendas@autosul.com.br', 'vendas@autosul.com.br', `leads+${'b'.repeat(40)}@entrada.exemplo.com`],
      assunto: 'Nova mensagem',
      texto: 'Nome: Ana\nTelefone: 11987654321',
      html: '<p>Nome: Ana</p>',
    });
  });

  it('senha errada ou ausente no Basic auth é 401', () => {
    expect(() => p.interpretar(basic('chute'), corpo)).toThrow(UnauthorizedException);
    expect(() => p.interpretar({}, corpo)).toThrow(UnauthorizedException);
    expect(() => p.interpretar({ authorization: 'Bearer senha-do-webhook' }, corpo)).toThrow(UnauthorizedException);
  });

  it('o endereço da loja é o base com o token', () => {
    expect(p.endereco('c'.repeat(40))).toBe(`leads+${'c'.repeat(40)}@entrada.exemplo.com`);
  });
});

describe('leitores', () => {
  it('e-mail com rótulos vira lead; o que não tem contato, "não entendido" com o assunto', () => {
    const base = { idExterno: 'x', de: 'a@olx.com.br', para: [], html: null };
    expect(lerEmail('olx', { ...base, assunto: 'Lead', texto: 'Nome: Ana\nTelefone: (11) 98765-4321' }))
      .toMatchObject({ tipo: 'leads', resumo: 'Ana' });
    expect(lerEmail('olx', { ...base, assunto: 'Seu plano vence amanhã', texto: 'Renove já.' }))
      .toEqual({ tipo: 'nao_entendido', resumo: 'Seu plano vence amanhã' });
  });

  it('a confirmação do Gmail é ignorada com o código à mostra', () => {
    expect(lerEmail('olx', {
      idExterno: 'x', de: 'forwarding-noreply@google.com', para: [], html: null,
      assunto: '(#123456789) Confirmação de encaminhamento', texto: '',
    })).toEqual({
      tipo: 'ignorado',
      resumo: 'O Gmail pediu para confirmar o encaminhamento. Código de confirmação: 123456789',
    });
  });

  it('webhook: formato AutoConnect vira leads; fora do formato fica guardado, sem erro', () => {
    expect(lerWebhook('webmotors', JSON.stringify([{ nome: 'A', telefone: '11987654321' }, { nome: 'Sem contato' }])))
      .toMatchObject({ tipo: 'leads', resumo: 'A' });
    expect(lerWebhook('olx', 'nome=Ana&tel=1')).toMatchObject({ tipo: 'nao_entendido' });
    expect(lerWebhook('olx', JSON.stringify({ lead: { name: 'Ana' } }))).toMatchObject({ tipo: 'nao_entendido' });
    expect(lerWebhook('olx', JSON.stringify({ nome: 'Ana' }))).toEqual({
      tipo: 'nao_entendido', resumo: 'Lead sem telefone nem e-mail',
    });
  });
});
