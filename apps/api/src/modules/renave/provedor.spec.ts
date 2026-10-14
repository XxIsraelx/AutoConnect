import type { ConfigService } from '@nestjs/config';
import { provedorDeRenaveConfigurado, ProvedorRenaveIndisponivel } from './provedor';
import { ProvedorRenaveSimulado } from './provedor-simulado';

const config = (vars: Record<string, string | undefined>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

/**
 * A fábrica é a chave de liga/desliga do envio ao RENAVE: nenhum caminho de
 * configuração incompleta pode derrubar o boot nem ligar uma integradora sem
 * como conferir o webhook.
 */
describe('provedorDeRenaveConfigurado', () => {
  it('sem RENAVE_FORNECEDOR: desligado — o registro manual segue', () => {
    expect(provedorDeRenaveConfigurado(config({}))).toBeInstanceOf(ProvedorRenaveIndisponivel);
  });

  it('sem segredo de webhook: desligado, qualquer que seja a integradora', () => {
    expect(provedorDeRenaveConfigurado(config({ RENAVE_FORNECEDOR: 'simulado' })))
      .toBeInstanceOf(ProvedorRenaveIndisponivel);
  });

  it('simulado fora de produção: liga', () => {
    const p = provedorDeRenaveConfigurado(config({ RENAVE_FORNECEDOR: 'simulado', RENAVE_WEBHOOK_SECRET: 's' }));
    expect(p).toBeInstanceOf(ProvedorRenaveSimulado);
    expect(p.disponivel).toBe(true);
  });

  it('simulado em produção: recusado — confirmação simulada seria declaração falsa', () => {
    expect(provedorDeRenaveConfigurado(config({
      RENAVE_FORNECEDOR: 'simulado', RENAVE_WEBHOOK_SECRET: 's', NODE_ENV: 'production',
    }))).toBeInstanceOf(ProvedorRenaveIndisponivel);
  });

  it('integradora sem adaptador: desligado, com erro no log', () => {
    expect(provedorDeRenaveConfigurado(config({ RENAVE_FORNECEDOR: 'integrarenave', RENAVE_WEBHOOK_SECRET: 's' })))
      .toBeInstanceOf(ProvedorRenaveIndisponivel);
  });

  it('o indisponível recusa com 503 em vez de fingir', async () => {
    await expect(new ProvedorRenaveIndisponivel().consultar()).rejects.toMatchObject({ status: 503 });
  });
});
