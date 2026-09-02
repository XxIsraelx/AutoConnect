import { ForbiddenException } from '@nestjs/common';

/**
 * De quem são os dados que esta requisição pode ver.
 *
 * Existe como tipo, e não como um `tenantId: string | null`, porque `null`
 * significando "vê tudo" é a forma clássica de um bug virar vazamento: basta
 * o tenant se perder no meio do caminho para a consulta abrir a base inteira.
 *
 * Aqui o caminho global só pode ser construído por `escopoDa()`, que exige
 * `super_admin`. Um `tenantId` ausente em qualquer outro papel vira erro.
 */
export type Escopo =
  | { tipo: 'tenant'; tenantId: string }
  | { tipo: 'global' };

/** Verdadeiro quando a requisição enxerga todas as concessionárias. */
export function ehGlobal(e: Escopo): e is { tipo: 'global' } {
  return e.tipo === 'global';
}

export function escopoDa(user: { role: string; tenantId: string | null }): Escopo {
  if (user.tenantId) return { tipo: 'tenant', tenantId: user.tenantId };

  // Super admin sem concessionária selecionada: vê o consolidado da plataforma.
  if (user.role === 'super_admin') return { tipo: 'global' };

  // Qualquer outro papel sem tenant é estado inválido — falha alto, em vez de
  // seguir com uma consulta sem filtro.
  throw new ForbiddenException('Sua conta não está vinculada a uma concessionária.');
}
