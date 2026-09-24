import { Injectable } from '@nestjs/common';
import {
  FUSO_PADRAO,
  calcularPrazoDeResposta,
  contaComoPrimeiraResposta,
  expedienteOuPadrao,
} from '@autoconnect/shared';
import type { ScopedClient } from '../../common/prisma/prisma.service';

/**
 * O relógio do primeiro contato, do lado do servidor.
 *
 * A conta em si mora no `@autoconnect/shared` (`domain/sla.ts`), porque a tela
 * precisa da mesma fórmula para dizer quanto falta. Aqui fica o que depende do
 * banco: de qual filial vem o expediente e qual é o fuso da loja.
 */
@Injectable()
export class SlaService {
  /**
   * Até quando alguém tem que ter falado com esta pessoa.
   *
   * O expediente vem da **filial do lead** quando há uma, e da primeira filial
   * ativa quando não há — é a matriz, na prática. Loja sem filial nenhuma
   * cadastrada cai no expediente padrão do shared (seg–sex 09–18, sáb 09–13),
   * e não em 24h por dia: o padrão errado para menos gera alarme falso, o
   * padrão errado para mais deixa o lead esquecido.
   *
   * Devolve `null` quando não há prazo a cobrar — nenhum dia aberto no
   * expediente configurado.
   */
  async prazoDePrimeiroContato(
    tx: ScopedClient,
    tenantId: string,
    opcoes: { branchId?: string | null; minutos: number; criadoEm?: Date },
  ): Promise<Date | null> {
    const criadoEm = opcoes.criadoEm ?? new Date();

    const [loja, filial] = await Promise.all([
      tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
      opcoes.branchId
        ? tx.dealershipBranch.findFirst({
            where: { id: opcoes.branchId, tenantId },
            select: { businessHours: true },
          })
        : tx.dealershipBranch.findFirst({
            where: { tenantId, isActive: true },
            orderBy: { createdAt: 'asc' },
            select: { businessHours: true },
          }),
    ]);

    return calcularPrazoDeResposta(
      criadoEm,
      opcoes.minutos,
      expedienteOuPadrao(filial?.businessHours),
      loja?.timezone || FUSO_PADRAO,
    );
  }

  /**
   * Marca a primeira resposta, se esta interação for uma.
   *
   * **Nota interna não conta** — ver `INTERACOES_DE_PRIMEIRA_RESPOSTA` no
   * shared. E só a primeira conta: o campo é gravado uma vez e nunca
   * reescrito, senão o indicador viraria "tempo até a última mensagem".
   *
   * Devolve `true` quando gravou, que é o que a tela usa para atualizar a
   * etiqueta sem recarregar tudo.
   */
  async registrarPrimeiraResposta(
    tx: ScopedClient,
    lead: { id: string; firstRespondedAt: Date | null },
    kind: string,
    quando: Date = new Date(),
  ): Promise<boolean> {
    if (lead.firstRespondedAt) return false;
    if (!contaComoPrimeiraResposta(kind)) return false;

    await tx.lead.update({
      where: { id: lead.id },
      data: { firstRespondedAt: quando },
    });
    return true;
  }
}
