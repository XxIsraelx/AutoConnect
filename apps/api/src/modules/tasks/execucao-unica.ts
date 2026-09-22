import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@autoconnect/db';

/**
 * Namespace do advisory lock dos crons — primeiro argumento da forma
 * `(int4, int4)`, para que a trava de um job nunca colida com outro uso de
 * advisory lock no mesmo banco. O valor é arbitrário; só não pode mudar entre
 * réplicas de versões diferentes rodando ao mesmo tempo.
 */
export const NAMESPACE_CRON = 0x41c0; // "AC" + 0

/**
 * Tempo máximo que a trava fica de pé. Precisa ser menor que o intervalo do
 * cron mais frequente (1h): se um job passar disso, o Prisma desfaz a
 * transação, a trava cai e a próxima execução poderia se sobrepor.
 */
const DURACAO_MAXIMA_MS = 50 * 60 * 1000;

type ClienteComTransacao = Pick<PrismaClient, '$transaction'>;

/**
 * Executa `corpo` em no máximo uma réplica por vez.
 *
 * Com duas réplicas no Railway, cada `@Cron` dispara nas duas no mesmo segundo.
 * A primeira que pegar `pg_try_advisory_xact_lock` executa; a outra loga e sai.
 *
 * **Por que a trava de transação, e não a de sessão.** O Prisma usa um pool: um
 * `pg_advisory_lock` pego numa conexão e liberado com `pg_advisory_unlock` em
 * outra não libera nada — e a trava fica presa até a conexão morrer. A de
 * transação mora na conexão da transação e cai sozinha no commit, no rollback
 * ou se o processo morrer (a conexão fecha).
 *
 * **Por que o corpo roda FORA da transação.** A transação só segura a trava; o
 * corpo usa o cliente normal, em outras conexões do pool, e cada gravação
 * confirma na hora. Se o corpo rodasse dentro dela, um e-mail já enviado
 * teria o `reminderSentAt` desfeito por qualquer erro posterior — e o lembrete
 * sairia de novo na hora seguinte.
 *
 * **O que isto não cobre sozinho:** a réplica A terminar antes de a B disparar
 * (relógios com alguns ms de diferença). Aí a B pega a trava livre e roda de
 * novo. Quem cobre é a idempotência de cada job, que precisa existir: como
 * tudo que A gravou foi confirmado antes de a trava cair, a B enxerga.
 *   - lembretes: filtram `reminderSentAt: null`;
 *   - leads frios: pulam lead com alerta nos últimos 6 dias.
 * A trava resolve o caso que a idempotência não resolve — as duas lendo a
 * mesma lista antes de qualquer uma gravar.
 *
 * @returns `true` se executou, `false` se outra réplica já estava executando.
 */
export async function executarEmUmaReplica(
  prisma: ClienteComTransacao,
  job: string,
  logger: Pick<Logger, 'log' | 'warn'>,
  corpo: () => Promise<void>,
): Promise<boolean> {
  const inicio = Date.now();
  let executou = false;

  try {
    return await prisma.$transaction(
      async (tx) => {
        const [{ obtida }] = await tx.$queryRaw<{ obtida: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${NAMESPACE_CRON}::int4, hashtext(${job})) AS obtida`;

        if (!obtida) {
          logger.log(`Job "${job}" já em execução em outra réplica — pulando`);
          return false;
        }

        executou = true;
        await corpo();
        return true;
      },
      { maxWait: 15_000, timeout: DURACAO_MAXIMA_MS },
    );
  } catch (err) {
    // Passou do tempo: o Prisma desfez a transação e a trava caiu no meio do
    // caminho, e o commit final falha. O corpo terminou (o que ele gravou está
    // confirmado), mas é sinal de que o job cresceu além do que a trava cobre.
    if (executou && Date.now() - inicio >= DURACAO_MAXIMA_MS) {
      logger.warn(
        `Job "${job}" passou de ${DURACAO_MAXIMA_MS / 60_000} min — a trava expirou antes do fim`,
      );
      return true;
    }
    throw err;
  }
}
