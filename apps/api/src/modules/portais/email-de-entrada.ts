import { createHash, timingSafeEqual } from 'crypto';
import { Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { enderecoDeEntrada, type EmailDeEntrada } from '@autoconnect/shared';

/**
 * E-mail de entrada: o caminho universal dos portais. Todo portal avisa o lead
 * por e-mail; a loja cria um encaminhamento automático na caixa dela para o
 * endereço que o sistema lhe dá, e um provedor de e-mail de entrada (Postmark,
 * hoje) entrega cada mensagem aqui, por webhook.
 *
 * Mesmo desenho dos outros canais: um contrato, um simulado recusado em
 * produção, e o adaptador real atrás de configuração que nunca derruba o boot.
 */
export interface ProvedorDeEmailDeEntrada {
  readonly nome: string;
  readonly disponivel: boolean;
  /** O endereço que a loja usa no encaminhamento, ou `null` sem provedor. */
  endereco(token: string): string | null;
  /** Confere a autenticidade e traduz. Lança 401 quando não confere. */
  interpretar(cabecalhos: Record<string, string | string[] | undefined>, corpo: Buffer): EmailDeEntrada;
}

export const PROVEDOR_DE_EMAIL_DE_ENTRADA = Symbol('ProvedorDeEmailDeEntrada');

function iguais(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

/**
 * O provedor chama com Basic auth na URL (`https://entrada:<token>@api…`), que
 * é o que o Postmark e a maioria dos provedores de entrada oferecem — eles não
 * assinam o corpo. O usuário é ignorado; a senha é o `EMAIL_ENTRADA_TOKEN`.
 */
function basicConfere(cabecalhos: Record<string, string | string[] | undefined>, token: string): boolean {
  const h = cabecalhos.authorization;
  if (!token || typeof h !== 'string' || !/^basic /i.test(h)) return false;
  const decodificado = Buffer.from(h.slice(6).trim(), 'base64').toString('utf8');
  const senha = decodificado.slice(decodificado.indexOf(':') + 1);
  return decodificado.includes(':') && iguais(senha, token);
}

export class EmailDeEntradaIndisponivel implements ProvedorDeEmailDeEntrada {
  readonly nome = 'nenhum';
  readonly disponivel = false;
  endereco(): string | null {
    return null;
  }
  interpretar(): EmailDeEntrada {
    throw new ServiceUnavailableException('O e-mail de entrada não está configurado neste servidor.');
  }
}

/**
 * Simulado: recebe o e-mail já no formato neutro (`EmailDeEntrada`), com a
 * mesma autenticação do real. **Recusado em produção** pela fábrica.
 */
export class EmailDeEntradaSimulado implements ProvedorDeEmailDeEntrada {
  readonly nome = 'simulado';
  readonly disponivel = true;
  constructor(private readonly base: string, private readonly token: string) {}

  endereco(token: string): string {
    return enderecoDeEntrada(this.base, token);
  }

  interpretar(cabecalhos: Record<string, string | string[] | undefined>, corpo: Buffer): EmailDeEntrada {
    if (!basicConfere(cabecalhos, this.token)) throw new UnauthorizedException();
    const e = JSON.parse(corpo.toString('utf8')) as Partial<EmailDeEntrada>;
    return {
      idExterno: String(e.idExterno ?? ''),
      de: e.de ?? null,
      para: Array.isArray(e.para) ? e.para.map(String) : [],
      assunto: e.assunto ?? null,
      texto: e.texto ?? null,
      html: e.html ?? null,
    };
  }

  /** Os cabeçalhos que o provedor mandaria — para o teste e o simulador. */
  cabecalhos(): Record<string, string> {
    return { authorization: `Basic ${Buffer.from(`entrada:${this.token}`).toString('base64')}` };
  }
}

/**
 * Postmark (Inbound). Formato:
 * https://postmarkapp.com/developer/user-guide/inbound/parse-an-email
 *
 * ⚠ **Ainda não recebeu um e-mail de verdade** — escrito pela documentação.
 */
export class EmailDeEntradaPostmark implements ProvedorDeEmailDeEntrada {
  readonly nome = 'postmark';
  readonly disponivel = true;
  constructor(private readonly base: string, private readonly token: string) {}

  endereco(token: string): string {
    return enderecoDeEntrada(this.base, token);
  }

  interpretar(cabecalhos: Record<string, string | string[] | undefined>, corpo: Buffer): EmailDeEntrada {
    if (!basicConfere(cabecalhos, this.token)) throw new UnauthorizedException();
    const p = JSON.parse(corpo.toString('utf8')) as {
      MessageID?: string;
      From?: string;
      FromFull?: { Email?: string; Name?: string };
      To?: string;
      ToFull?: { Email?: string }[];
      Cc?: string;
      OriginalRecipient?: string;
      Subject?: string;
      TextBody?: string;
      HtmlBody?: string;
    };
    // Todos os destinatários possíveis: o encaminhamento do Gmail preserva o
    // `To` original (o e-mail da loja), e o endereço daqui aparece como
    // destinatário original.
    const para = [
      ...(p.ToFull ?? []).map((t) => t.Email ?? ''),
      ...(p.To ?? '').split(','),
      ...(p.Cc ?? '').split(','),
      p.OriginalRecipient ?? '',
    ].map((s) => s.trim()).filter(Boolean);

    return {
      idExterno: p.MessageID ?? '',
      de: p.FromFull?.Email ?? p.From ?? null,
      para,
      assunto: p.Subject ?? null,
      texto: p.TextBody ?? null,
      html: p.HtmlBody ?? null,
    };
  }
}

/**
 * `EMAIL_ENTRADA_FORNECEDOR`: vazio (desligado), `simulado` (recusado em
 * produção) ou `postmark`. Exigem também `EMAIL_ENTRADA_TOKEN` (a senha do
 * Basic auth que o provedor manda) e `EMAIL_ENTRADA_ENDERECO` (o endereço base,
 * `leads@entrada.seudominio`). Faltando algo, desligado com erro no log.
 */
export function emailDeEntradaConfigurado(config: ConfigService): ProvedorDeEmailDeEntrada {
  const log = new Logger('EmailDeEntrada');
  const escolhido = config.get<string>('EMAIL_ENTRADA_FORNECEDOR')?.trim();
  if (!escolhido) return new EmailDeEntradaIndisponivel();

  const token = config.get<string>('EMAIL_ENTRADA_TOKEN')?.trim();
  const base = config.get<string>('EMAIL_ENTRADA_ENDERECO')?.trim();
  const faltam = [!token && 'EMAIL_ENTRADA_TOKEN', !base && 'EMAIL_ENTRADA_ENDERECO'].filter(Boolean);
  if (faltam.length) {
    log.error(`EMAIL_ENTRADA_FORNECEDOR=${escolhido} sem ${faltam.join(' e ')}: e-mail de entrada desligado.`);
    return new EmailDeEntradaIndisponivel();
  }
  if (!/^[^\s@+]+@[^\s@]+\.[^\s@]+$/.test(base!)) {
    log.error('EMAIL_ENTRADA_ENDERECO precisa ser um endereço sem "+", ex.: leads@entrada.exemplo.com.');
    return new EmailDeEntradaIndisponivel();
  }

  if (escolhido === 'simulado') {
    if (config.get<string>('NODE_ENV') === 'production') {
      log.error('EMAIL_ENTRADA_FORNECEDOR=simulado ignorado em produção.');
      return new EmailDeEntradaIndisponivel();
    }
    return new EmailDeEntradaSimulado(base!, token!);
  }
  if (escolhido === 'postmark') return new EmailDeEntradaPostmark(base!, token!);

  log.error(`EMAIL_ENTRADA_FORNECEDOR="${escolhido}" não tem adaptador. E-mail de entrada desligado.`);
  return new EmailDeEntradaIndisponivel();
}
