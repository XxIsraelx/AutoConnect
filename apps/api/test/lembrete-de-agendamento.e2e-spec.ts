import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { EmailRecusado, type EmailService } from '../src/common/email/email.service';
import { TasksService } from '../src/modules/tasks/tasks.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Lembrete de agendamento: o que fazer quando o e-mail não sai.
 *
 * Antes, toda falha deixava `reminderSentAt` nulo e o cron da hora seguinte
 * tentava de novo — 24 vezes para um endereço que o provedor recusa por
 * validação (os `@example.com` da loja de demonstração, um endereço digitado
 * errado). Agora: recusa definitiva conta como tratado; falha passageira tenta
 * de novo; loja de demonstração não entra.
 */
describe('lembrete de agendamento (e2e)', () => {
  const db = new PrivilegedPrismaService();
  let f: DoisTenants;
  const criados: string[] = [];

  const agendamento = async (tenantId: string, email: string) => {
    const daqui = (h: number) => new Date(Date.now() + h * 3_600_000);
    const a = await db.appointment.create({
      data: {
        tenantId, type: 'test_drive', contactName: 'Cliente', contactPhone: '11999990000',
        contactEmail: email, scheduledStart: daqui(5), scheduledEnd: daqui(6),
      },
      select: { id: true },
    });
    criados.push(a.id);
    return a.id;
  };

  const enviadoEm = async (id: string) =>
    (await db.appointment.findUniqueOrThrow({ where: { id }, select: { reminderSentAt: true } })).reminderSentAt;

  /** Um EmailService que falha do jeito pedido para um endereço e aceita os outros. */
  const email = (falhaPara: string, erro: Error) =>
    ({
      sendAppointmentReminder: async (o: { to: string }) => {
        if (o.to === falhaPara) throw erro;
      },
    }) as unknown as EmailService;

  beforeAll(async () => {
    await db.$connect();
    f = await criarDoisTenants(db);
  }, 60_000);

  afterAll(async () => {
    await db.appointment.deleteMany({ where: { id: { in: criados } } });
    await f?.limpar();
    await db.$disconnect();
  });

  it('endereço recusado pelo provedor conta como tratado: uma tentativa, não 24', async () => {
    const id = await agendamento(f.a.id, 'recusado@exemplo.test');
    const tarefas = new TasksService(db, email('recusado@exemplo.test', new EmailRecusado('validation_error')));
    await tarefas.sendAppointmentReminders();
    expect(await enviadoEm(id)).not.toBeNull();
  });

  it('falha passageira deixa para a hora seguinte', async () => {
    const id = await agendamento(f.a.id, 'passageiro@exemplo.test');
    const tarefas = new TasksService(db, email('passageiro@exemplo.test', new Error('rede fora')));
    await tarefas.sendAppointmentReminders();
    expect(await enviadoEm(id)).toBeNull();
  });

  it('a loja de demonstração não recebe lembrete — os clientes dela não existem', async () => {
    await db.tenant.update({ where: { id: f.b.id }, data: { isDemo: true } });
    const id = await agendamento(f.b.id, 'demo.cliente@example.com');
    let tentou = false;
    const tarefas = new TasksService(db, {
      sendAppointmentReminder: async (o: { to: string }) => { if (o.to === 'demo.cliente@example.com') tentou = true; },
    } as unknown as EmailService);
    await tarefas.sendAppointmentReminders();
    expect(tentou).toBe(false);
    expect(await enviadoEm(id)).toBeNull();
  });
});
