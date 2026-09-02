import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * A regra "todo acesso a tabela com tenant_id passa por withTenant" só sobrevive
 * se for verificada. Revisão de PR esquece; este teste não.
 *
 * É unitário de propósito — lê o código-fonte, não precisa de banco, e roda em
 * milissegundos junto do resto.
 */

const RAIZ = join(__dirname, '..', '..');

/**
 * Modelos do Prisma cujas tabelas têm `tenant_id`. Espelha a lista da migration
 * 20260902120000_rls_tenant_isolation — o teste `rls-policies.e2e-spec.ts`
 * garante que a migration cobre o banco; este garante que o código respeita.
 */
const MODELOS_DE_TENANT = [
  'analyticsEvent', 'appointment', 'auditLog', 'conversation',
  'dealershipBranch', 'leadInteraction', 'lead', 'message',
  'notification', 'salesGoal', 'salespersonAvailability',
  'salespersonProfile', 'tenantSubscription', 'userInvitation',
  'user', 'vehicleHistory', 'vehicleImage', 'vehicleView', 'vehicle',
];

/**
 * Tabelas do consumidor final: sem `tenant_id`, isoladas por `app.user_id`.
 * Acesso fora de `withUser` também não enxerga nada sob RLS.
 */
const MODELOS_DE_USUARIO = [
  'customerFavorite', 'customerProfile', 'priceAlert', 'savedSearch', 'userSession',
];

/**
 * Arquivos que acessam essas tabelas fora de `withTenant`, e por quê.
 *
 * Cada linha aqui é dívida declarada, não permissão permanente: são os módulos
 * que ainda não foram migrados. A lista só deve encolher — e o teste falha se
 * alguém adicionar acesso direto num arquivo que não está nela.
 */
const PENDENTES = new Map<string, string>([
  // Vazia: todo acesso a dado de concessionária ou de cliente passa por
  // withTenant/withUser/withPublic, ou pela conexão privilegiada declarada.
  // Uma entrada nova aqui é dívida, não permissão — e precisa de motivo.
]);

function arquivosTs(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosTs(caminho, acc);
    else if (nome.endsWith('.ts') && !nome.endsWith('.spec.ts')) acc.push(caminho);
  }
  return acc;
}

/**
 * Casa só `this.prisma.<modelo>.` — o cliente comum. A conexão privilegiada é
 * sempre `this.privilegiado.`, então a travessia entre concessionárias fica
 * visível no próprio nome da chamada, e não some numa isenção de arquivo.
 */
const ACESSO_DIRETO = new RegExp(
  String.raw`this\.prisma\.(${[...MODELOS_DE_TENANT, ...MODELOS_DE_USUARIO].join('|')})\.`,
  'g',
);

describe('isolamento por tenant — regra de arquitetura', () => {
  const infratores = new Map<string, string[]>();

  beforeAll(() => {
    for (const caminho of arquivosTs(RAIZ)) {
      const rel = relative(RAIZ, caminho);
      const fonte = readFileSync(caminho, 'utf8');

      const achados = fonte.match(ACESSO_DIRETO);
      if (achados) infratores.set(rel, [...new Set(achados)]);
    }
  });

  it('varreu os arquivos da API', () => {
    // Se o caminho estiver errado, a varredura acha zero e o teste passaria
    // sem verificar nada.
    expect(arquivosTs(RAIZ).length).toBeGreaterThan(30);
  });

  it('nenhum arquivo novo acessa tabela de tenant fora de withTenant', () => {
    const novos = [...infratores.keys()].filter((f) => !PENDENTES.has(f));

    expect(novos).toEqual([]);
  });

  it('a lista de pendências não tem entradas mortas', () => {
    // Módulo já migrado que continua na lista mascara a próxima regressão.
    const jaMigrados = [...PENDENTES.keys()].filter((f) => !infratores.has(f));

    expect(jaMigrados).toEqual([]);
  });

  it.each([
    'modules/leads/leads.service.ts',
    'modules/appointments/appointments.service.ts',
    'modules/conversations/conversations.service.ts',
    'modules/team/team.service.ts',
    'modules/catalog/catalog.service.ts',
    'modules/tenants/tenants.service.ts',
    'modules/users/users.service.ts',
    'modules/vehicles/vehicles.service.ts',
    'modules/invitations/invitations.service.ts',
    'modules/map/map.service.ts',
    'gateway/chat.gateway.ts',
  ])('%s está migrado e não pode regredir', (arquivo) => {
    expect(infratores.get(arquivo) ?? []).toEqual([]);
  });

  it.each([
    'modules/admin/admin.service.ts',
    'modules/auth/auth.service.ts',
    'modules/tasks/tasks.service.ts',
    'common/strategies/google.strategy.ts',
  ])('%s atravessa concessionárias pela conexão privilegiada, e isso é visível', (arquivo) => {
    const fonte = readFileSync(join(RAIZ, arquivo), 'utf8');

    expect(fonte).toContain('PrivilegedPrismaService');
    // Nomeada `privilegiado`, nunca `prisma`: quem lê a chamada vê o privilégio.
    expect(fonte).toContain('this.privilegiado.');
  });

  it('a conexão privilegiada não é global — a travessia tem que aparecer no import', () => {
    const mod = readFileSync(
      join(RAIZ, 'common/prisma/privileged-prisma.module.ts'),
      'utf8',
    );

    // O decorador aplicado, não a palavra — o arquivo cita `@Global` no
    // comentário justamente para explicar por que não o usa.
    expect(mod).not.toMatch(/^\s*@Global\(/m);
  });
});
