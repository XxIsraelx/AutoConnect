import { Prisma } from '@autoconnect/db';

/**
 * Quem é "cliente desta loja".
 *
 * A resposta é a mesma da policy `cliente_relacionado` do banco: cliente com
 * **lead, agendamento ou conversa** nesta loja — nunca a base inteira de
 * consumidores do AutoConnect. A definição mora aqui, num lugar só, porque ela
 * é consumida por dois caminhos diferentes (a busca de cliente das telas e a
 * exportação de portabilidade) e duas cópias divergiriam no primeiro ajuste —
 * o mesmo erro que já deu dois valores de comissão para a mesma pessoa.
 *
 * As contagens acompanham o cliente porque é o que distingue homônimos na hora
 * de escolher: "João da Silva, 3 leads" é escolhível; três "João da Silva"
 * iguais, não.
 */
export interface ClienteRelacionado {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  leads: number;
  agendamentos: number;
  conversas: number;
  primeiroContato: Date | null;
  ultimoContato: Date | null;
}

export function consultaDeClientesRelacionados(
  tenantId: string,
  { termo, limite }: { termo?: string | null; limite: number },
): Prisma.Sql {
  const busca = termo?.trim() ? `%${termo.trim()}%` : null;

  return Prisma.sql`
    WITH relacao AS (
      SELECT customer_user_id AS user_id, created_at FROM leads
        WHERE tenant_id = ${tenantId}::uuid AND customer_user_id IS NOT NULL
      UNION ALL
      SELECT customer_user_id, created_at FROM appointments
        WHERE tenant_id = ${tenantId}::uuid AND customer_user_id IS NOT NULL
      UNION ALL
      SELECT customer_user_id, created_at FROM conversations
        WHERE tenant_id = ${tenantId}::uuid AND customer_user_id IS NOT NULL
    )
    SELECT u.id,
           u.full_name AS "fullName",
           u.email,
           u.phone,
           (SELECT count(*)::int FROM leads l
             WHERE l.customer_user_id = u.id AND l.tenant_id = ${tenantId}::uuid) AS leads,
           (SELECT count(*)::int FROM appointments a
             WHERE a.customer_user_id = u.id AND a.tenant_id = ${tenantId}::uuid) AS agendamentos,
           (SELECT count(*)::int FROM conversations c
             WHERE c.customer_user_id = u.id AND c.tenant_id = ${tenantId}::uuid) AS conversas,
           min(r.created_at) AS "primeiroContato",
           max(r.created_at) AS "ultimoContato"
      FROM users u
      JOIN relacao r ON r.user_id = u.id
     WHERE u.role = 'customer'
       AND u.status <> 'deleted'
       AND (${busca}::text IS NULL OR u.full_name ILIKE ${busca} OR u.email ILIKE ${busca})
     GROUP BY u.id, u.full_name, u.email, u.phone
     ORDER BY u.full_name
     LIMIT ${limite}`;
}
