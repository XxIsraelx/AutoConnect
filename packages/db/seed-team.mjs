import { PrismaClient } from './node_modules/@prisma/client/index.js';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const TENANT_SLUG = 'central-cars-go';

const SELLERS = [
  { email: 'carlos.vendedor@centralcars.com.br', name: 'Carlos Mendes',   role: 'salesperson' },
  { email: 'ana.vendedora@centralcars.com.br',   name: 'Ana Beatriz',     role: 'salesperson' },
  { email: 'rafael.gerente@centralcars.com.br',  name: 'Rafael Lopes',    role: 'manager' },
];

function period(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error('tenant não encontrado');
  const tenantId = tenant.id;
  const hash = await bcrypt.hash('Senha@123', 10);

  // cria vendedores
  const sellers = [];
  for (const s of SELLERS) {
    const u = await prisma.user.upsert({
      where: { email: s.email },
      update: { tenantId, role: s.role, status: 'active' },
      create: { email: s.email, fullName: s.name, role: s.role, status: 'active', tenantId, passwordHash: hash, emailVerifiedAt: new Date() },
    });
    sellers.push(u);
  }
  console.log('Vendedores:', sellers.map((s) => s.fullName).join(', '));

  // pega leads do tenant e distribui entre os vendedores
  const leads = await prisma.lead.findMany({ where: { tenantId }, select: { id: true } });
  console.log('Leads do tenant:', leads.length);

  const now = new Date();
  let won = 0;
  for (let i = 0; i < leads.length; i++) {
    const seller = sellers[i % sellers.length];
    // ~40% ganhos, resto distribuído
    const isWon = i % 5 < 2; // 0,1 de cada 5 → 40%
    await prisma.lead.update({
      where: { id: leads[i].id },
      data: {
        assignedTo: seller.id,
        createdAt: now,
        ...(isWon ? { status: 'won', wonAt: now } : {}),
      },
    });
    if (isWon) won++;
  }
  console.log(`Leads atribuídos. Ganhos marcados: ${won}`);

  // define metas para o período atual
  const p = period(now);
  async function setGoal(userId, target) {
    const existing = await prisma.salesGoal.findFirst({ where: { tenantId, userId: userId ?? null, period: p } });
    if (existing) await prisma.salesGoal.update({ where: { id: existing.id }, data: { target } });
    else await prisma.salesGoal.create({ data: { tenantId, userId: userId ?? null, period: p, target } });
  }
  await setGoal(null, 15);              // meta da equipe
  for (const s of sellers) await setGoal(s.id, 6); // meta de cada vendedor
  console.log(`Metas definidas para ${p}: equipe 15, cada vendedor 6`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
