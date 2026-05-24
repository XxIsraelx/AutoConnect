/**
 * Seed: cria concessionárias demo com filiais em cidades brasileiras.
 * Uso: pnpm --filter @autoconnect/db db:seed
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const dealerships = [
  {
    slug: 'auto-sul',
    legalName: 'Auto Sul Veículos Ltda',
    tradeName: 'Auto Sul',
    taxId: '12.345.678/0001-90',
    primaryEmail: 'contato@autosul.com.br',
    primaryPhone: '(51) 3212-4000',
    admin: { fullName: 'Carlos Souza', email: 'carlos@autosul.com.br' },
    branch: { name: 'Auto Sul – Matriz Porto Alegre', city: 'Porto Alegre', state: 'RS', phone: '(51) 3212-4000', addressLine: 'Av. Assis Brasil, 2500', lat: -30.0332, lng: -51.2307 },
  },
  {
    slug: 'premier-motors',
    legalName: 'Premier Motors Comércio de Veículos S.A.',
    tradeName: 'Premier Motors',
    taxId: '23.456.789/0001-01',
    primaryEmail: 'vendas@premiermotors.com.br',
    primaryPhone: '(11) 4002-8922',
    admin: { fullName: 'Ana Lima', email: 'ana@premiermotors.com.br' },
    branch: { name: 'Premier Motors – Alphaville', city: 'Barueri', state: 'SP', phone: '(11) 4002-8922', addressLine: 'Av. Alphaville, 350', lat: -23.4958, lng: -46.8497 },
  },
  {
    slug: 'norte-car',
    legalName: 'Norte Car Automóveis Ltda',
    tradeName: 'Norte Car',
    taxId: '34.567.890/0001-12',
    primaryEmail: 'contato@nortecar.com.br',
    primaryPhone: '(91) 3248-5500',
    admin: { fullName: 'João Mendes', email: 'joao@nortecar.com.br' },
    branch: { name: 'Norte Car – Belém PA', city: 'Belém', state: 'PA', phone: '(91) 3248-5500', addressLine: 'Trav. Dom Romualdo de Seixas, 1900', lat: -1.4558, lng: -48.4902 },
  },
  {
    slug: 'capital-veiculos',
    legalName: 'Capital Veículos Distribuidora',
    tradeName: 'Capital Veículos',
    taxId: '45.678.901/0001-23',
    primaryEmail: 'atendimento@capitalveiculos.com.br',
    primaryPhone: '(61) 3300-1100',
    admin: { fullName: 'Mariana Costa', email: 'mariana@capitalveiculos.com.br' },
    branch: { name: 'Capital Veículos – Brasília', city: 'Brasília', state: 'DF', phone: '(61) 3300-1100', addressLine: 'SHIN QL 10 Conjunto 4', lat: -15.7801, lng: -47.9292 },
  },
  {
    slug: 'litoral-motors',
    legalName: 'Litoral Motors Florianópolis Ltda',
    tradeName: 'Litoral Motors',
    taxId: '56.789.012/0001-34',
    primaryEmail: 'contato@litoralmotors.com.br',
    primaryPhone: '(48) 3222-9000',
    admin: { fullName: 'Felipe Ramos', email: 'felipe@litoralmotors.com.br' },
    branch: { name: 'Litoral Motors – Florianópolis', city: 'Florianópolis', state: 'SC', phone: '(48) 3222-9000', addressLine: 'Rod. SC-401, km 04', lat: -27.5954, lng: -48.548 },
  },
  {
    slug: 'tupi-auto',
    legalName: 'Tupi Auto Minas Gerais S.A.',
    tradeName: 'Tupi Auto',
    taxId: '67.890.123/0001-45',
    primaryEmail: 'vendas@tupiauto.com.br',
    primaryPhone: '(31) 3001-7000',
    admin: { fullName: 'Beatriz Nunes', email: 'beatriz@tupiauto.com.br' },
    branch: { name: 'Tupi Auto – BH Centro', city: 'Belo Horizonte', state: 'MG', phone: '(31) 3001-7000', addressLine: 'Av. do Contorno, 5100', lat: -19.9217, lng: -43.9380 },
  },
  {
    slug: 'nordeste-auto',
    legalName: 'Nordeste Auto Recife Ltda',
    tradeName: 'Nordeste Auto',
    taxId: '78.901.234/0001-56',
    primaryEmail: 'contato@nordesteauto.com.br',
    primaryPhone: '(81) 3322-4000',
    admin: { fullName: 'Rafael Oliveira', email: 'rafael@nordesteauto.com.br' },
    branch: { name: 'Nordeste Auto – Recife', city: 'Recife', state: 'PE', phone: '(81) 3322-4000', addressLine: 'Av. Boa Viagem, 4000', lat: -8.1195, lng: -34.9031 },
  },
  {
    slug: 'central-cars-go',
    legalName: 'Central Cars Goiânia Distribuidora',
    tradeName: 'Central Cars',
    taxId: '89.012.345/0001-67',
    primaryEmail: 'central@centralcars.com.br',
    primaryPhone: '(62) 3500-2200',
    admin: { fullName: 'Larissa Ferreira', email: 'larissa@centralcars.com.br' },
    branch: { name: 'Central Cars – Goiânia', city: 'Goiânia', state: 'GO', phone: '(62) 3500-2200', addressLine: 'Av. Americano do Brasil, 1200', lat: -16.6869, lng: -49.2648 },
  },
];

async function main() {
  console.log('🌱  Iniciando seed de concessionárias demo…\n');

  const passwordHash = await bcrypt.hash('Senha@123', 10);

  for (const d of dealerships) {
    // Verifica se já existe pelo slug
    const exists = await prisma.tenant.findUnique({ where: { slug: d.slug } });
    if (exists) {
      console.log(`  ⏭  ${d.tradeName} já existe — pulando`);
      continue;
    }

    const tenant = await prisma.tenant.create({
      data: {
        slug: d.slug,
        legalName: d.legalName,
        tradeName: d.tradeName,
        taxId: d.taxId,
        primaryEmail: d.primaryEmail,
        primaryPhone: d.primaryPhone,
        subscription: { create: { plan: 'trial', status: 'active' } },
      },
    });

    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: d.admin.email,
        fullName: d.admin.fullName,
        passwordHash,
        role: 'tenant_admin',
        status: 'active',
        emailVerifiedAt: new Date(),
      },
    });

    await prisma.dealershipBranch.create({
      data: {
        tenantId: tenant.id,
        name: d.branch.name,
        isHeadquarters: true,
        phone: d.branch.phone,
        email: d.primaryEmail,
        addressLine: d.branch.addressLine,
        city: d.branch.city,
        state: d.branch.state,
        country: 'BR',
        // Coordenadas pré-calculadas para não depender do Nominatim no seed
        latitude: d.branch.lat,
        longitude: d.branch.lng,
      },
    });

    console.log(`  ✅  ${d.tradeName} criada (${d.branch.city}, ${d.branch.state})`);
  }

  console.log('\n✨  Seed concluído!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
