import { PrismaClient } from './node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();

// Tenant: Central Cars (Goiânia/GO)
const TENANT_ID = 'ff9c0305-7134-492b-8738-3cd4ab060b8e';

// Clientes de teste — cidades variadas (todas existem no CITY_COORDS da API)
const CLIENTES = [
  { nome: 'João Silva',        cidade: 'Goiânia',        uf: 'GO' },
  { nome: 'Maria Oliveira',    cidade: 'Aparecida de Goiânia', uf: 'GO' },
  { nome: 'Pedro Santos',      cidade: 'Anápolis',       uf: 'GO' },
  { nome: 'Ana Costa',         cidade: 'Brasília',       uf: 'DF' },
  { nome: 'Carlos Pereira',    cidade: 'Uberlândia',     uf: 'MG' },
  { nome: 'Juliana Lima',      cidade: 'Uberaba',        uf: 'MG' },
  { nome: 'Rafael Souza',      cidade: 'Cuiabá',         uf: 'MT' },
  { nome: 'Fernanda Alves',    cidade: 'Campo Grande',   uf: 'MS' },
  { nome: 'Bruno Rodrigues',   cidade: 'Belo Horizonte', uf: 'MG' },
  { nome: 'Camila Ferreira',   cidade: 'São Paulo',      uf: 'SP' },
  { nome: 'Lucas Martins',     cidade: 'Campinas',       uf: 'SP' },
  { nome: 'Beatriz Rocha',     cidade: 'Ribeirão Preto', uf: 'SP' },
  { nome: 'Gabriel Nunes',     cidade: 'Rio de Janeiro', uf: 'RJ' },
  { nome: 'Larissa Gomes',     cidade: 'Curitiba',       uf: 'PR' },
  { nome: 'Thiago Barbosa',    cidade: 'Palmas',         uf: 'TO' },
  { nome: 'Mariana Dias',      cidade: 'Salvador',       uf: 'BA' },
  { nome: 'Felipe Cardoso',    cidade: 'Porto Alegre',   uf: 'RS' },
  { nome: 'Patrícia Ramos',    cidade: 'Recife',         uf: 'PE' },
  { nome: 'Rodrigo Teixeira',  cidade: 'Fortaleza',      uf: 'CE' },
  { nome: 'Vanessa Moraes',    cidade: 'Manaus',         uf: 'AM' },
  { nome: 'André Carvalho',    cidade: 'Belém',          uf: 'PA' },
  { nome: 'Isabela Pinto',     cidade: 'Goiânia',        uf: 'GO' },
];

async function main() {
  console.log(`Populando ${CLIENTES.length} clientes na Central Cars...`);

  for (let i = 0; i < CLIENTES.length; i++) {
    const c = CLIENTES[i];
    const email = `cliente.galaxy.${i}@teste.com`;

    // upsert do usuário customer
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        fullName: c.nome,
        role: 'customer',
        status: 'active',
        emailVerifiedAt: new Date(),
      },
    });

    // perfil com cidade/estado
    await prisma.customerProfile.upsert({
      where: { userId: user.id },
      update: { city: c.cidade, state: c.uf },
      create: { userId: user.id, city: c.cidade, state: c.uf },
    });

    // lead vinculando o cliente à concessionária
    const existing = await prisma.lead.findFirst({
      where: { tenantId: TENANT_ID, customerUserId: user.id },
    });
    if (!existing) {
      await prisma.lead.create({
        data: {
          tenantId: TENANT_ID,
          customerUserId: user.id,
          contactName: c.nome,
          contactEmail: email,
          source: 'website',
          status: 'new',
          message: `Interesse de ${c.cidade}/${c.uf}`,
        },
      });
    }

    console.log(`  ✓ ${c.nome} — ${c.cidade}/${c.uf}`);
  }

  console.log('\nConcluído! Acesse o dashboard da Central Cars para ver o mapa.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
