import { Injectable, Logger } from '@nestjs/common';
import {
  avaliarCobranca, usoDoEstoque, STATUS_QUE_CONTA_NO_LIMITE,
  type UsoDoEstoque, type Veredito,
} from '@autoconnect/shared';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';

/**
 * Quanto tempo o veredito fica em memória.
 *
 * O guard roda em **toda escrita**, e a API está numa região diferente do
 * banco (~0,6 s por consulta): sem cache, cadastrar um veículo passaria a
 * custar uma ida a mais ao Postgres. Meio minuto é curto o bastante para que
 * um trial que venceu bloqueie quase na hora, e a volta depois do pagamento
 * **não espera o TTL** — o webhook chama `invalidar()`.
 */
const TTL_MS = 30_000;

export interface EstadoDaLoja {
  veredito: Veredito;
  plano: string;
  status: string;
  trialEndsAt: Date | null;
  uso: UsoDoEstoque;
}

interface Entrada {
  estado: EstadoDaLoja;
  expiraEm: number;
}

/**
 * O estado de cobrança de uma loja, com cache curto.
 *
 * Lê pela conexão privilegiada de propósito: quem pergunta é o guard, que roda
 * **antes** de qualquer contexto de tenant existir na consulta, e a resposta é
 * sobre a própria loja do usuário autenticado. A travessia é mínima — uma
 * linha de `tenant_subscriptions` e uma contagem de veículos, sempre pelo
 * `tenantId` que veio do JWT. O arquivo está na lista de "atravessa pela
 * conexão privilegiada, e isso é visível" do `isolamento.spec.ts`.
 */
@Injectable()
export class EstadoDaLojaService {
  private readonly logger = new Logger(EstadoDaLojaService.name);
  private readonly cache = new Map<string, Entrada>();

  constructor(private readonly privilegiado: PrivilegedPrismaService) {}

  /** Derruba o cache de uma loja — chamado pelo webhook, pelo painel e ao contratar. */
  invalidar(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  invalidarTudo(): void {
    this.cache.clear();
  }

  async estado(tenantId: string): Promise<EstadoDaLoja> {
    const agora = Date.now();
    const guardado = this.cache.get(tenantId);
    if (guardado && guardado.expiraEm > agora) return guardado.estado;

    const [assinatura, veiculos] = await Promise.all([
      this.privilegiado.tenantSubscription.findUnique({
        where: { tenantId },
        select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true, graceUntil: true },
      }),
      this.privilegiado.vehicle.count({
        where: { tenantId, status: { in: [...STATUS_QUE_CONTA_NO_LIMITE] } },
      }),
    ]);

    const estado: EstadoDaLoja = {
      veredito: avaliarCobranca(assinatura, new Date(agora)),
      plano: assinatura?.plan ?? 'trial',
      status: assinatura?.status ?? 'active',
      trialEndsAt: assinatura?.trialEndsAt ?? null,
      uso: usoDoEstoque(assinatura?.plan ?? 'trial', veiculos),
    };

    // Poda preguiçosa: sem isto o mapa cresceria com uma entrada por loja que
    // já passou por aqui e nunca mais voltaria a encolher. É o mesmo cuidado
    // do `limite-por-ip.ts`, e é a parte que derruba o processo quando falta.
    if (this.cache.size > 500) {
      for (const [chave, e] of this.cache) if (e.expiraEm <= agora) this.cache.delete(chave);
      if (this.cache.size > 500) this.logger.warn(`Cache de cobrança com ${this.cache.size} lojas vivas.`);
    }

    this.cache.set(tenantId, { estado, expiraEm: agora + TTL_MS });
    return estado;
  }
}
