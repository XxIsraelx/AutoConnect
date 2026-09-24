import type { Prisma } from '@autoconnect/db';

/** Quem está pedindo. O papel decide o que ele enxerga da fila. */
export interface Ator {
  id: string;
  role: string;
}

/**
 * A carteira do vendedor.
 *
 * Com o interruptor desligado, `salesperson` vê **só os próprios leads e os
 * sem responsável**. Os sem responsável entram de propósito: é a fila, e
 * escondê-la faria o lead que o rodízio não conseguiu distribuir ficar
 * invisível para quem poderia atendê-lo.
 *
 * Gerente e administrador veem tudo — é o trabalho deles distribuir e cobrar.
 * Papel nenhum além de `salesperson` é restringido: `customer` não chega a
 * estas rotas (o guard barra antes) e super admin já tem escopo próprio.
 *
 * Devolve `{}` quando não há restrição, para poder ser espalhado direto no
 * `where` sem `if` no chamador — é o que evita que uma das quatro superfícies
 * (lista, contagem, CSV, detalhe) fique de fora por esquecimento.
 */
export function carteiraDe(
  ator: Ator | null,
  vendedorVeTodosOsLeads: boolean,
): Prisma.LeadWhereInput {
  if (vendedorVeTodosOsLeads) return {};
  if (!ator || ator.role !== 'salesperson') return {};

  return { OR: [{ assignedTo: ator.id }, { assignedTo: null }] };
}
