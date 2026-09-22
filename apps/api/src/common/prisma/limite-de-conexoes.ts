/**
 * Teto de conexões por cliente Prisma.
 *
 * O pooler do Supabase em modo sessão (porta 5432) aceita **15 clientes no
 * projeto inteiro**, somando todas as réplicas, os dois clientes desta API e
 * quem mais estiver conectado (uma API local apontando para produção, uma
 * migration). Sem `connection_limit` na URL, o Prisma abre até
 * `núcleos × 2 + 1` conexões por cliente — no Railway isso passa de 15 sozinho,
 * e um `Promise.all` largo (o painel do super admin dispara ~20 consultas)
 * esgotava o pooler: `EMAXCONNSESSION max clients reached`, e a tela caía.
 *
 * Com o teto, o excesso espera na fila do próprio Prisma em vez de derrubar a
 * requisição. Um `connection_limit` já presente na URL é respeitado: é a forma
 * de ajustar sem deploy.
 */
export const CONEXOES_APP = 6;
export const CONEXOES_PRIVILEGIADO = 3;

export function comLimiteDeConexoes(url: string | undefined, limite: number): string | undefined {
  if (!url) return url;
  if (/[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${limite}`;
}
