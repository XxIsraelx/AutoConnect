import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { cabecalhoHmac } from '../contracts/assinatura/hmac';
import { ProvedorIndisponivelDeWhatsApp, provedorDeWhatsAppConfigurado } from './provedor';
import { ProvedorSimuladoDeWhatsApp } from './provedor-simulado';
import { ProvedorMetaDeWhatsApp } from './provedor-meta';
import { RecusaDoWhatsApp } from './recusa';

const config = (v: Record<string, string | undefined>) =>
  ({ get: (k: string) => v[k] }) as unknown as ConfigService;

const BASE = { WHATSAPP_APP_SECRET: 'segredo', WHATSAPP_VERIFY_TOKEN: 'verifica' };

describe('provedorDeWhatsAppConfigurado', () => {
  it('sem WHATSAPP_FORNECEDOR, indisponível — a opção some da tela', () => {
    const p = provedorDeWhatsAppConfigurado(config({}));
    expect(p).toBeInstanceOf(ProvedorIndisponivelDeWhatsApp);
    expect(p.disponivel).toBe(false);
  });

  it('simulado fora de produção', () => {
    const p = provedorDeWhatsAppConfigurado(config({ ...BASE, WHATSAPP_FORNECEDOR: 'simulado', NODE_ENV: 'development' }));
    expect(p).toBeInstanceOf(ProvedorSimuladoDeWhatsApp);
  });

  it('simulado é recusado em produção', () => {
    const p = provedorDeWhatsAppConfigurado(config({ ...BASE, WHATSAPP_FORNECEDOR: 'simulado', NODE_ENV: 'production' }));
    expect(p).toBeInstanceOf(ProvedorIndisponivelDeWhatsApp);
  });

  it('sem segredo do app ou sem token de verificação, nenhum provedor liga', () => {
    expect(provedorDeWhatsAppConfigurado(config({ WHATSAPP_FORNECEDOR: 'simulado', WHATSAPP_VERIFY_TOKEN: 'v' })))
      .toBeInstanceOf(ProvedorIndisponivelDeWhatsApp);
    expect(provedorDeWhatsAppConfigurado(config({ WHATSAPP_FORNECEDOR: 'simulado', WHATSAPP_APP_SECRET: 's' })))
      .toBeInstanceOf(ProvedorIndisponivelDeWhatsApp);
  });

  it('meta exige token e URL https', () => {
    const meta = { ...BASE, WHATSAPP_FORNECEDOR: 'meta' };
    expect(provedorDeWhatsAppConfigurado(config(meta))).toBeInstanceOf(ProvedorIndisponivelDeWhatsApp);
    expect(provedorDeWhatsAppConfigurado(config({
      ...meta, WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_GRAPH_URL: 'http://graph.facebook.com/v21.0',
    }))).toBeInstanceOf(ProvedorIndisponivelDeWhatsApp);
    expect(provedorDeWhatsAppConfigurado(config({
      ...meta, WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_GRAPH_URL: 'https://graph.facebook.com/v21.0',
    }))).toBeInstanceOf(ProvedorMetaDeWhatsApp);
  });

  it('fornecedor sem adaptador fica indisponível', () => {
    expect(provedorDeWhatsAppConfigurado(config({ ...BASE, WHATSAPP_FORNECEDOR: 'twilio' })))
      .toBeInstanceOf(ProvedorIndisponivelDeWhatsApp);
  });
});

describe('ProvedorIndisponivelDeWhatsApp', () => {
  const p = new ProvedorIndisponivelDeWhatsApp();

  it('recusa com 503 os envios e o webhook, e não responde o desafio', async () => {
    await expect(p.enviarTexto()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(p.enviarModelo()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(() => p.interpretarWebhook()).toThrow(ServiceUnavailableException);
    expect(p.responderDesafio()).toBeNull();
  });
});

describe('ProvedorSimuladoDeWhatsApp', () => {
  const novo = () => new ProvedorSimuladoDeWhatsApp('segredo', 'verifica');

  it('registra o que teria enviado, com id no formato do WhatsApp', async () => {
    const p = novo();
    const r = await p.enviarTexto({ conta: '1', para: '5511987654321', texto: 'oi' });
    expect(r.idExterno).toMatch(/^wamid\.SIM\./);
    expect(p.enviados).toEqual([{ tipo: 'texto', conta: '1', para: '5511987654321', texto: 'oi', idExterno: r.idExterno }]);
  });

  it('recusa o próximo envio quando pedido — o caminho da falha', async () => {
    const p = novo();
    p.recusarProximo('131026 — número sem WhatsApp');
    await expect(p.enviarModelo({ conta: '1', para: '55', modelo: 'x', idioma: 'pt_BR', parametros: [] }))
      .rejects.toEqual(new RecusaDoWhatsApp('131026 — número sem WhatsApp'));
    await expect(p.enviarTexto({ conta: '1', para: '55', texto: 'depois passa' })).resolves.toBeTruthy();
  });

  it('a entrega que ele monta passa pela própria conferência de assinatura', () => {
    const p = novo();
    const { corpo, cabecalhos } = p.entrega([{
      tipo: 'status', idExterno: 'w', conta: '1', status: 'entregue', em: new Date(1000), erro: null,
    }]);
    expect(p.interpretarWebhook(cabecalhos, corpo)).toEqual([
      { tipo: 'status', idExterno: 'w', conta: '1', status: 'entregue', em: new Date(1000), erro: null },
    ]);
  });

  it('corpo alterado ou assinado com outro segredo é 401', () => {
    const p = novo();
    const { corpo, cabecalhos } = p.entrega([]);
    const adulterado = Buffer.from(corpo.toString().replace('whatsapp', 'whatsApp'));
    expect(() => p.interpretarWebhook(cabecalhos, adulterado)).toThrow(UnauthorizedException);
    expect(() => p.interpretarWebhook({ 'x-hub-signature-256': cabecalhoHmac(corpo, 'outro') }, corpo))
      .toThrow(UnauthorizedException);
    expect(() => p.interpretarWebhook({}, corpo)).toThrow(UnauthorizedException);
  });
});
