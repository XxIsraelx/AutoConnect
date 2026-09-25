import type { ConfigService } from '@nestjs/config';
import { CobrancaIndisponivel, cobrancaConfigurada } from './provedor';
import { ProvedorSimuladoDeCobranca } from './provedor-simulado';
import { ProvedorAsaas } from './provedor-asaas';

function config(valores: Record<string, string | undefined>): ConfigService {
  return { get: (chave: string) => valores[chave] } as unknown as ConfigService;
}

/** Silencia o Logger do Nest: a fábrica loga erro de propósito em vários casos. */
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('cobrancaConfigurada', () => {
  it('sem COBRANCA_FORNECEDOR fica indisponível — a tela esconde a contratação', () => {
    expect(cobrancaConfigurada(config({}))).toBeInstanceOf(CobrancaIndisponivel);
  });

  it('o indisponível recusa alto em vez de fingir que cobrou', async () => {
    const p = cobrancaConfigurada(config({}));
    expect(p.disponivel).toBe(false);
    await expect(p.criarAssinatura({} as never)).rejects.toMatchObject({ status: 503 });
    await expect(p.cancelarAssinatura('x')).rejects.toMatchObject({ status: 503 });
    // O webhook também: sem gateway não há token para conferir, e aceitar
    // evento sem conferir deixaria qualquer um marcar uma loja como paga.
    expect(() => p.interpretarWebhook({}, Buffer.alloc(0))).toThrow();
  });

  it('sem token de webhook nenhum gateway liga', () => {
    expect(cobrancaConfigurada(config({ COBRANCA_FORNECEDOR: 'simulado' })))
      .toBeInstanceOf(CobrancaIndisponivel);
    expect(cobrancaConfigurada(config({
      COBRANCA_FORNECEDOR: 'asaas', ASAAS_API_KEY: 'k', ASAAS_API_URL: 'https://api-sandbox.asaas.com',
    }))).toBeInstanceOf(CobrancaIndisponivel);
  });

  it('simulado liga fora de produção e é recusado em produção', () => {
    const base = { COBRANCA_FORNECEDOR: 'simulado', COBRANCA_WEBHOOK_TOKEN: 't' };
    expect(cobrancaConfigurada(config(base))).toBeInstanceOf(ProvedorSimuladoDeCobranca);
    // Uma loja marcada como paga por simulação é uma loja usando de graça — e
    // do outro lado, uma loja bloqueada sem dever nada.
    expect(cobrancaConfigurada(config({ ...base, NODE_ENV: 'production' })))
      .toBeInstanceOf(CobrancaIndisponivel);
  });

  it('asaas exige chave e URL https; faltando qualquer uma, desliga sem derrubar o boot', () => {
    const base = { COBRANCA_FORNECEDOR: 'asaas', COBRANCA_WEBHOOK_TOKEN: 't' };

    expect(cobrancaConfigurada(config({ ...base, ASAAS_API_URL: 'https://api-sandbox.asaas.com' })))
      .toBeInstanceOf(CobrancaIndisponivel);
    expect(cobrancaConfigurada(config({ ...base, ASAAS_API_KEY: 'k' })))
      .toBeInstanceOf(CobrancaIndisponivel);
    // http simples: a chave iria em claro pela rede.
    expect(cobrancaConfigurada(config({
      ...base, ASAAS_API_KEY: 'k', ASAAS_API_URL: 'http://api-sandbox.asaas.com',
    }))).toBeInstanceOf(CobrancaIndisponivel);

    expect(cobrancaConfigurada(config({
      ...base, ASAAS_API_KEY: 'k', ASAAS_API_URL: 'https://api-sandbox.asaas.com',
    }))).toBeInstanceOf(ProvedorAsaas);
  });

  it('fornecedor sem adaptador desliga em vez de subir com um gateway errado', () => {
    expect(cobrancaConfigurada(config({
      COBRANCA_FORNECEDOR: 'pagarme', COBRANCA_WEBHOOK_TOKEN: 't',
    }))).toBeInstanceOf(CobrancaIndisponivel);
  });
});
