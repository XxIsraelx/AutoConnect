import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { provedorConfigurado, ProvedorIndisponivel } from './provedor';
import { ProvedorSimulado } from './provedor-simulado';
import { cabecalhoHmac } from './hmac';

const config = (v: Record<string, string | undefined>) =>
  ({ get: (k: string) => v[k] }) as unknown as ConfigService;

describe('provedorConfigurado', () => {
  it('sem ASSINATURA_FORNECEDOR, indisponível — a opção some da tela', () => {
    const p = provedorConfigurado(config({}));
    expect(p).toBeInstanceOf(ProvedorIndisponivel);
    expect(p.disponivel).toBe(false);
  });

  it('simulado fora de produção, com segredo', () => {
    const p = provedorConfigurado(config({
      ASSINATURA_FORNECEDOR: 'simulado', ASSINATURA_WEBHOOK_SECRET: 's', NODE_ENV: 'development',
    }));
    expect(p).toBeInstanceOf(ProvedorSimulado);
  });

  it('simulado é recusado em produção', () => {
    const p = provedorConfigurado(config({
      ASSINATURA_FORNECEDOR: 'simulado', ASSINATURA_WEBHOOK_SECRET: 's', NODE_ENV: 'production',
    }));
    expect(p).toBeInstanceOf(ProvedorIndisponivel);
  });

  it('sem segredo de webhook, nenhum provedor liga', () => {
    const p = provedorConfigurado(config({ ASSINATURA_FORNECEDOR: 'simulado', NODE_ENV: 'test' }));
    expect(p).toBeInstanceOf(ProvedorIndisponivel);
  });

  it('provedor sem adaptador fica indisponível', () => {
    const p = provedorConfigurado(config({
      ASSINATURA_FORNECEDOR: 'clicksign', ASSINATURA_WEBHOOK_SECRET: 's',
    }));
    expect(p).toBeInstanceOf(ProvedorIndisponivel);
  });

  it('indisponível recusa alto em tudo, inclusive no webhook', async () => {
    const p = new ProvedorIndisponivel();
    await expect(p.criarEnvelope()).rejects.toMatchObject({ status: 503 });
    expect(() => p.interpretarWebhook()).toThrow(/Nenhum provedor/);
  });
});

describe('ProvedorSimulado — normalização do webhook', () => {
  const segredo = 'segredo';
  const p = new ProvedorSimulado(segredo);

  const entregar = (payload: object, seg = segredo) => {
    const corpo = Buffer.from(JSON.stringify(payload));
    return p.interpretarWebhook({ 'content-hmac': cabecalhoHmac(corpo, seg) }, corpo);
  };

  it.each([
    ['sign', 'assinou'],
    ['refusal', 'recusou'],
    ['close', 'concluido'],
    ['auto_close', 'concluido'],
    ['deadline', 'expirou'],
    ['cancel', 'cancelado'],
    ['upload', 'ignorado'],
    ['evento_que_nao_existe', 'ignorado'],
  ])('%s → %s', (nome, tipo) => {
    const e = entregar({
      event: { name: nome, occurred_at: '2026-09-22T10:00:00Z', data: { signer: { key: 'env1.customer' } } },
      document: { key: 'env1' },
    });

    expect(e).toMatchObject({
      idExterno: 'env1', tipo, papel: 'customer', idSignatarioExterno: 'env1.customer',
    });
    expect(e.ocorridoEm.toISOString()).toBe('2026-09-22T10:00:00.000Z');
  });

  it('segredo errado → 401', () => {
    expect(() => entregar({ event: { name: 'close' }, document: { key: 'x' } }, 'outro'))
      .toThrow(UnauthorizedException);
  });

  it('corpo que não é JSON → 400, mas só depois de conferir o HMAC', () => {
    const corpo = Buffer.from('não é json');
    expect(() => p.interpretarWebhook({ 'content-hmac': cabecalhoHmac(corpo, segredo) }, corpo))
      .toThrow(BadRequestException);
    expect(() => p.interpretarWebhook({}, corpo)).toThrow(UnauthorizedException);
  });

  it('o último signatário a assinar gera também a conclusão', async () => {
    const pdf = Buffer.from('%PDF-1.4 teste');
    const { createHash } = await import('crypto');
    const env = await p.criarEnvelope({
      documento: pdf,
      nomeArquivo: 'c.pdf',
      hash: createHash('sha256').update(pdf).digest('hex'),
      prazo: new Date(),
      signatarios: [
        { papel: 'dealer', nome: 'Loja', email: 'l@x.test' },
        { papel: 'customer', nome: 'Cliente', email: 'c@x.test' },
      ],
    });

    expect(p.simular(env.idExterno, 'assinar', 'dealer')).toHaveLength(1);
    const ultimas = p.simular(env.idExterno, 'assinar', 'customer')
      .map((e) => p.interpretarWebhook(e.cabecalhos, e.corpo).tipo);
    expect(ultimas).toEqual(['assinou', 'concluido']);

    const assinado = Buffer.from(await p.baixarAssinado(env.idExterno));
    expect(assinado.subarray(0, pdf.length).equals(pdf)).toBe(true);
    expect(assinado.length).toBeGreaterThan(pdf.length);
  });

  it('recusa criar envelope com documento que não confere com o hash', async () => {
    await expect(p.criarEnvelope({
      documento: Buffer.from('x'), nomeArquivo: 'x.pdf', hash: '0'.repeat(64),
      prazo: new Date(), signatarios: [],
    })).rejects.toThrow(/não confere/);
  });
});
