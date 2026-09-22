import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import type { EmailService } from '../src/common/email/email.service';
import { TasksService } from '../src/modules/tasks/tasks.service';
import { executarEmUmaReplica } from '../src/modules/tasks/execucao-unica';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Com duas réplicas, cada `@Cron` dispara nas duas no mesmo segundo. Aqui cada
 * "réplica" tem o seu próprio PrismaClient — pool próprio, conexões próprias,
 * exatamente como dois processos — e as duas disputam a mesma trava no banco.
 */

const silencioso = { log: () => undefined, warn: () => undefined };

function portao() {
  let abrir!: () => void;
  const aberto = new Promise<void>((r) => (abrir = r));
  return { aberto, abrir };
}

describe('crons em mais de uma réplica (e2e)', () => {
  const replicaA = new PrivilegedPrismaService();
  const replicaB = new PrivilegedPrismaService();

  afterAll(async () => {
    await replicaA.$disconnect();
    await replicaB.$disconnect();
  });

  describe('executarEmUmaReplica', () => {
    it('a segunda execução concorrente não roda o corpo', async () => {
      const { aberto, abrir } = portao();
      let entrouA!: () => void;
      const aDentro = new Promise<void>((r) => (entrouA = r));
      const corpoB = jest.fn(async () => undefined);

      const a = executarEmUmaReplica(replicaA, 'job-de-teste', silencioso, async () => {
        entrouA();
        await aberto;
      });
      await aDentro; // A segura a trava

      const b = await executarEmUmaReplica(replicaB, 'job-de-teste', silencioso, corpoB);

      expect(b).toBe(false);
      expect(corpoB).not.toHaveBeenCalled();

      abrir();
      expect(await a).toBe(true);
    });

    it('a trava cai no fim da execução — a próxima rodada executa', async () => {
      expect(await executarEmUmaReplica(replicaA, 'job-de-teste', silencioso, async () => undefined)).toBe(true);
      expect(await executarEmUmaReplica(replicaB, 'job-de-teste', silencioso, async () => undefined)).toBe(true);
    });

    it('a trava cai também quando o corpo lança', async () => {
      await expect(
        executarEmUmaReplica(replicaA, 'job-de-teste', silencioso, async () => {
          throw new Error('falhou');
        }),
      ).rejects.toThrow('falhou');

      expect(await executarEmUmaReplica(replicaB, 'job-de-teste', silencioso, async () => undefined)).toBe(true);
    });

    it('jobs diferentes não se bloqueiam', async () => {
      const { aberto, abrir } = portao();
      let entrouA!: () => void;
      const aDentro = new Promise<void>((r) => (entrouA = r));

      const a = executarEmUmaReplica(replicaA, 'job-um', silencioso, async () => {
        entrouA();
        await aberto;
      });
      await aDentro;

      expect(await executarEmUmaReplica(replicaB, 'job-dois', silencioso, async () => undefined)).toBe(true);

      abrir();
      await a;
    });
  });

  describe('lembrete de agendamento', () => {
    let dados: DoisTenants;

    beforeAll(async () => {
      dados = await criarDoisTenants(replicaA);
    });

    afterAll(async () => {
      await dados?.limpar();
    });

    it('sai uma vez só, com as duas réplicas disparando juntas e uma atrasada', async () => {
      const enviados: string[] = [];
      const { aberto, abrir } = portao();
      let entrouA!: () => void;
      const aDentro = new Promise<void>((r) => (entrouA = r));

      // A réplica A trava no primeiro envio: é a janela em que, sem a trava, a
      // B leria a mesma lista com `reminderSentAt` ainda nulo.
      let primeiro = true;
      const emailA = {
        sendAppointmentReminder: async (o: { to: string }) => {
          if (primeiro) {
            primeiro = false;
            entrouA();
            await aberto;
          }
          enviados.push(o.to);
        },
      } as unknown as EmailService;
      const emailB = {
        sendAppointmentReminder: async (o: { to: string }) => {
          enviados.push(o.to);
        },
      } as unknown as EmailService;

      const tarefasA = new TasksService(replicaA, emailA);
      const tarefasB = new TasksService(replicaB, emailB);

      const a = tarefasA.sendAppointmentReminders();
      await aDentro;

      // Disparo simultâneo: pula.
      expect(await tarefasB.sendAppointmentReminders()).toBe(false);

      abrir();
      expect(await a).toBe(true);

      // Disparo atrasado (A já terminou e soltou a trava): executa, mas a
      // idempotência do job faz ele não achar nada para reenviar.
      expect(await tarefasB.sendAppointmentReminders()).toBe(true);

      const clientes = await replicaA.user.findMany({
        where: { id: { in: [dados.a.usuarioId, dados.b.usuarioId] } },
        select: { email: true },
      });
      for (const { email } of clientes) {
        expect(enviados.filter((e) => e === email)).toHaveLength(1);
      }
    });
  });
});
