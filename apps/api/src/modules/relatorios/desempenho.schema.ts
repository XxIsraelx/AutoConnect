import { z } from 'zod';

/**
 * Período do relatório de desempenho.
 *
 * `days` e não `from`/`to` porque é assim que a tela pergunta (7, 30, 90) e é
 * o que o restante de `/relatorios` já usa. O teto de 366 existe para que a
 * consulta não varra a base inteira por um `?days=99999` — a API roda numa
 * região diferente do banco, e cada varredura extra custa ida e volta.
 */
export const desempenhoQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
});

export type DesempenhoQuery = z.infer<typeof desempenhoQuerySchema>;
