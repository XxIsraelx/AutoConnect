/**
 * Seed: concessionárias demo, com operação (estoque, leads, agendamentos e
 * negócios) datada em relação a HOJE.
 *
 * Uso: pnpm --filter @autoconnect/db db:seed
 *      SEED_DEMO_RESET=1 pnpm --filter @autoconnect/db db:seed   # refaz a operação com datas de hoje
 *
 * Por que as datas são relativas: `/relatorios` abre com filtro de 30 dias e o
 * gráfico de margem só conta negócio faturado. Um seed com datas fixas fica
 * vazio um mês depois de rodado — e tela vazia é indistinguível de tela
 * quebrada.
 *
 * Reexecução: a concessionária é pulada se o slug já existe; a operação demo é
 * pulada se a loja já tem veículos marcados com `metadata.seed = "demo"`. Com
 * `SEED_DEMO_RESET=1`, a operação demo (e só ela) é apagada e recriada.
 *
 * Roda pela conexão dona das tabelas, que não passa pelo RLS. Por isso cada
 * `where` aqui filtra `tenantId` explicitamente.
 */
import { Prisma, PrismaClient, type DealStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const D = (v: string | number) => new Prisma.Decimal(v);

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

// ─── Utilitários ──────────────────────────────────────────────────────────────

/** PRNG determinístico por loja: a mesma loja recebe sempre a mesma operação. */
function rngDe(semente: string) {
  let h = 1779033703 ^ semente.length;
  for (let i = 0; i < semente.length; i++) {
    h = Math.imul(h ^ semente.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
  };
}
type Rng = ReturnType<typeof rngDe>;

const AGORA = new Date();
/** `dias` atrás, a uma hora do dia estável (9h–18h), para cair em horário comercial. */
function diasAtras(dias: number, hora = 10, minuto = 0): Date {
  const d = new Date(AGORA);
  d.setDate(d.getDate() - dias);
  d.setHours(hora, minuto, 0, 0);
  // "Hoje às 10h" pode ainda estar no futuro se o seed rodar de manhã cedo.
  return d > AGORA ? new Date(AGORA.getTime() - 5 * 60_000) : d;
}
function diasAFrente(dias: number, hora: number): Date {
  const d = new Date(AGORA);
  d.setDate(d.getDate() + dias);
  d.setHours(hora, 0, 0, 0);
  return d;
}

/** CPF com dígitos verificadores válidos (mesma regra de `cpfValido` do shared). */
function gerarCpf(rng: Rng): string {
  let base: number[];
  do {
    base = Array.from({ length: 9 }, () => rng.int(0, 9));
  } while (base.every((d) => d === base[0]));
  const dv = (digs: number[]) => {
    const n = digs.length;
    const s = digs.reduce((acc, d, i) => acc + d * (n + 1 - i), 0);
    const r = (s * 10) % 11;
    return r >= 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

/** Arredonda um valor em reais para centena (preço de loja termina em 900). */
const preco = (reais: number) => D(Math.round(reais / 1000) * 1000 - 100);
const centena = (d: Prisma.Decimal) => d.dividedBy(100).toDecimalPlaces(0).times(100);

// ─── Catálogo e personagens da demo ───────────────────────────────────────────

const ESTOQUE = [
  { marca: 'Chevrolet', modelo: 'Onix', versao: '1.0 Turbo LT', ano: 2023, preco: 89_900, km: 21_000, comb: 'flex', cambio: 'automatic' },
  { marca: 'Volkswagen', modelo: 'T-Cross', versao: '200 TSI Comfortline', ano: 2022, preco: 129_900, km: 38_000, comb: 'flex', cambio: 'automatic' },
  { marca: 'Fiat', modelo: 'Strada', versao: 'Volcano 1.3 CVT', ano: 2024, preco: 119_900, km: 9_000, comb: 'flex', cambio: 'cvt' },
  { marca: 'Toyota', modelo: 'Corolla', versao: '2.0 XEi', ano: 2021, preco: 139_900, km: 52_000, comb: 'flex', cambio: 'cvt' },
  { marca: 'Honda', modelo: 'HR-V', versao: '1.5 EXL', ano: 2022, preco: 149_900, km: 33_000, comb: 'flex', cambio: 'cvt' },
  { marca: 'Hyundai', modelo: 'HB20', versao: '1.0 Comfort', ano: 2023, preco: 79_900, km: 18_000, comb: 'flex', cambio: 'manual' },
  { marca: 'Jeep', modelo: 'Compass', versao: '1.3 T270 Longitude', ano: 2022, preco: 159_900, km: 41_000, comb: 'flex', cambio: 'automatic' },
  { marca: 'Renault', modelo: 'Kwid', versao: '1.0 Zen', ano: 2023, preco: 62_900, km: 15_000, comb: 'flex', cambio: 'manual' },
  { marca: 'Fiat', modelo: 'Argo', versao: '1.3 Drive', ano: 2022, preco: 72_900, km: 36_000, comb: 'flex', cambio: 'manual' },
  { marca: 'Toyota', modelo: 'Hilux', versao: '2.8 SRV 4x4', ano: 2021, preco: 229_900, km: 78_000, comb: 'diesel', cambio: 'automatic' },
  { marca: 'Volkswagen', modelo: 'Polo', versao: '1.0 TSI Highline', ano: 2023, preco: 104_900, km: 17_000, comb: 'flex', cambio: 'automatic' },
  { marca: 'Nissan', modelo: 'Kicks', versao: '1.6 Advance', ano: 2022, preco: 112_900, km: 29_000, comb: 'flex', cambio: 'cvt' },
  { marca: 'Chevrolet', modelo: 'Tracker', versao: '1.2 Turbo Premier', ano: 2023, preco: 142_900, km: 22_000, comb: 'flex', cambio: 'automatic' },
  { marca: 'Ford', modelo: 'Ranger', versao: '2.2 XLS 4x4', ano: 2020, preco: 189_900, km: 91_000, comb: 'diesel', cambio: 'automatic' },
  // Daqui para baixo, só estoque: sem eles a vitrine teria um carro disponível.
  { marca: 'Hyundai', modelo: 'Creta', versao: '1.0 TGDI Limited', ano: 2023, preco: 134_900, km: 24_000, comb: 'flex', cambio: 'automatic' },
  { marca: 'Volkswagen', modelo: 'Gol', versao: '1.0 MPI', ano: 2020, preco: 54_900, km: 67_000, comb: 'flex', cambio: 'manual' },
  { marca: 'Chevrolet', modelo: 'S10', versao: '2.8 LTZ 4x4', ano: 2021, preco: 209_900, km: 83_000, comb: 'diesel', cambio: 'automatic' },
  { marca: 'Fiat', modelo: 'Pulse', versao: '1.0 Turbo Audace', ano: 2023, preco: 109_900, km: 19_000, comb: 'flex', cambio: 'cvt' },
  { marca: 'Renault', modelo: 'Duster', versao: '1.6 Intense', ano: 2021, preco: 94_900, km: 48_000, comb: 'flex', cambio: 'cvt' },
  { marca: 'Toyota', modelo: 'Yaris', versao: '1.5 XS', ano: 2022, preco: 91_900, km: 31_000, comb: 'flex', cambio: 'cvt' },
] as const;

const FOTOS = [
  'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800',
  'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800',
  'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800',
  'https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=800',
  'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=800',
  'https://images.unsplash.com/photo-1542362567-b07e54358753?w=800',
];
const CORES = ['Prata', 'Preto', 'Branco', 'Cinza', 'Vermelho', 'Azul'];

/**
 * Clientes finais da demo. São usuários globais (`tenant_id` nulo), como na
 * plataforma real: o mesmo cliente pode falar com várias lojas. As cidades
 * existem no `CITY_COORDS` da API, para aparecerem no mapa de proximidade.
 */
const CLIENTES = [
  { nome: 'Juliana Martins', cidade: 'Goiânia', uf: 'GO' },
  { nome: 'Pedro Henrique Alves', cidade: 'Brasília', uf: 'DF' },
  { nome: 'Camila Rocha', cidade: 'São Paulo', uf: 'SP' },
  { nome: 'Lucas Ferreira', cidade: 'Belo Horizonte', uf: 'MG' },
  { nome: 'Fernanda Ribeiro', cidade: 'Porto Alegre', uf: 'RS' },
  { nome: 'Bruno Carvalho', cidade: 'Curitiba', uf: 'PR' },
  { nome: 'Patrícia Gomes', cidade: 'Recife', uf: 'PE' },
  { nome: 'Rodrigo Lima', cidade: 'Florianópolis', uf: 'SC' },
  { nome: 'Aline Barbosa', cidade: 'Campinas', uf: 'SP' },
  { nome: 'Gustavo Pereira', cidade: 'Belém', uf: 'PA' },
  { nome: 'Mariana Teixeira', cidade: 'Salvador', uf: 'BA' },
  { nome: 'Thiago Moreira', cidade: 'Uberlândia', uf: 'MG' },
] as const;
const emailDoCliente = (i: number) => `cliente${String(i + 1).padStart(2, '0')}@demo.autoconnect.dev`;

/**
 * Negócios da demo, um por veículo (índice em ESTOQUE). A linha do tempo é
 * `[status, dias atrás]`, em ordem, e cada passo é uma transição válida em
 * `DEAL_TRANSITIONS` (packages/shared/src/domain/deal.ts).
 *
 * Os faturados se espalham pelos últimos ~80 dias, com metade nos últimos 30,
 * para o gráfico de margem ter mais de um mês e o filtro padrão ter conteúdo.
 */
type Passo = readonly [DealStatus, number];
const NEGOCIOS: { veiculo: number; linha: readonly Passo[]; pagamento: 'avista' | 'financiado' }[] = [
  { veiculo: 0, pagamento: 'financiado', linha: [['draft', 86], ['proposal', 85], ['negotiating', 84], ['contract_issued', 81], ['signed', 80], ['invoiced', 79], ['documentation', 77], ['delivered', 72]] },
  { veiculo: 3, pagamento: 'avista', linha: [['draft', 62], ['proposal', 61], ['contract_issued', 58], ['signed', 57], ['invoiced', 56], ['documentation', 54], ['delivered', 50]] },
  { veiculo: 5, pagamento: 'financiado', linha: [['draft', 44], ['proposal', 43], ['awaiting_credit', 42], ['contract_issued', 38], ['signed', 37], ['invoiced', 36], ['documentation', 34], ['delivered', 30]] },
  { veiculo: 9, pagamento: 'financiado', linha: [['draft', 33], ['proposal', 32], ['negotiating', 30], ['contract_issued', 26], ['signed', 25], ['invoiced', 24], ['documentation', 22], ['delivered', 18]] },
  { veiculo: 1, pagamento: 'avista', linha: [['draft', 24], ['proposal', 23], ['contract_issued', 20], ['signed', 19], ['invoiced', 18], ['documentation', 16]] },
  { veiculo: 7, pagamento: 'financiado', linha: [['draft', 15], ['proposal', 14], ['awaiting_credit', 13], ['contract_issued', 10], ['signed', 9], ['invoiced', 8]] },
  { veiculo: 10, pagamento: 'avista', linha: [['draft', 9], ['proposal', 8], ['negotiating', 7], ['contract_issued', 5], ['signed', 4], ['invoiced', 3]] },
  { veiculo: 4, pagamento: 'financiado', linha: [['draft', 8], ['proposal', 7], ['contract_issued', 3], ['signed', 2]] },
  { veiculo: 6, pagamento: 'financiado', linha: [['draft', 6], ['proposal', 5], ['negotiating', 4], ['contract_issued', 1]] },
  { veiculo: 11, pagamento: 'financiado', linha: [['draft', 7], ['proposal', 6], ['awaiting_credit', 3]] },
  { veiculo: 12, pagamento: 'avista', linha: [['draft', 5], ['proposal', 4], ['negotiating', 2]] },
  // Vendido, cancelado e reaberto para outro cliente: o índice único parcial
  // `deals_veiculo_negocio_vivo_idx` libera o veículo quando o negócio morre.
  { veiculo: 2, pagamento: 'financiado', linha: [['draft', 20], ['proposal', 19], ['awaiting_credit', 18], ['canceled', 15]] },
  { veiculo: 2, pagamento: 'avista', linha: [['draft', 3], ['proposal', 2]] },
  { veiculo: 8, pagamento: 'avista', linha: [['draft', 1]] },
];
// Os veículos 13 em diante não têm negócio: ficam no estoque e no giro.

const MOTIVO_CANCELAMENTO = 'Financiamento recusado pelo banco';

// ─── Execução ─────────────────────────────────────────────────────────────────

async function garantirCatalogo() {
  const modelos = new Map<string, { brandId: string; modelId: string }>();
  for (const v of ESTOQUE) {
    const chave = `${v.marca}|${v.modelo}`;
    if (modelos.has(chave)) continue;
    const marca = await prisma.vehicleBrand.upsert({
      where: { name: v.marca }, update: {}, create: { name: v.marca },
    });
    const modelo = await prisma.vehicleModel.upsert({
      where: { brandId_name: { brandId: marca.id, name: v.modelo } },
      update: {},
      create: { brandId: marca.id, name: v.modelo },
    });
    modelos.set(chave, { brandId: marca.id, modelId: modelo.id });
  }
  return modelos;
}

async function garantirClientes(passwordHash: string) {
  const ids: string[] = [];
  for (let i = 0; i < CLIENTES.length; i++) {
    const c = CLIENTES[i];
    const u = await prisma.user.upsert({
      where: { email: emailDoCliente(i) },
      update: {},
      create: {
        email: emailDoCliente(i),
        fullName: c.nome,
        role: 'customer',
        status: 'active',
        passwordHash,
        phone: `(11) 98${String(100 + i * 7).padStart(3, '0')}-${4000 + i * 37}`,
        emailVerifiedAt: AGORA,
        customerProfile: { create: { city: c.cidade, state: c.uf } },
      },
    });
    ids.push(u.id);
  }
  return ids;
}

type Tx = Prisma.TransactionClient;

/** Apaga só a operação demo da loja: veículos marcados e o que pende deles. */
async function apagarDemo(tx: Tx, tenantId: string, clientes: string[]) {
  const veiculos = (
    await tx.vehicle.findMany({
      where: { tenantId, metadata: { path: ['seed'], equals: 'demo' } },
      select: { id: true },
    })
  ).map((v) => v.id);
  const leads = (
    await tx.lead.findMany({
      where: { tenantId, metadata: { path: ['seed'], equals: 'demo' } },
      select: { id: true },
    })
  ).map((l) => l.id);

  // Pagamentos, eventos, comprador e contrato vão em cascata com o negócio.
  await tx.deal.deleteMany({
    where: { tenantId, OR: [{ vehicleId: { in: veiculos } }, { leadId: { in: leads } }] },
  });
  await tx.appointment.deleteMany({
    where: {
      tenantId,
      OR: [
        { customerUserId: { in: clientes } },
        { leadId: { in: leads } },
        { vehicleId: { in: veiculos } },
      ],
    },
  });
  await tx.lead.deleteMany({ where: { tenantId, id: { in: leads } } });
  await tx.vehicle.deleteMany({ where: { tenantId, id: { in: veiculos } } });
}

async function semearOperacao(
  tx: Tx,
  t: { id: string; slug: string; tradeName: string },
  modelos: Map<string, { brandId: string; modelId: string }>,
  clientes: string[],
  passwordHash: string,
) {
  const rng = rngDe(t.slug);
  const tenantId = t.id;
  const dominio = `${t.slug}.demo.autoconnect.dev`;

  const branch = await tx.dealershipBranch.findFirst({
    where: { tenantId }, orderBy: { isHeadquarters: 'desc' }, select: { id: true },
  });
  const branchId = branch?.id ?? null;

  // Representante legal: sem ele o contrato não é emitido, e a demo precisa
  // conseguir emitir contrato dos negócios em aberto.
  await tx.tenant.updateMany({
    where: { id: tenantId, legalRepName: null },
    data: { legalRepName: 'Roberto Almeida Prado', legalRepCpf: gerarCpf(rng), legalRepRole: 'Sócio-administrador' },
  });

  // Equipe: um gerente e dois vendedores.
  const equipe = [
    { email: `gerente@${dominio}`, fullName: 'Rafael Lopes', role: 'manager' as const },
    { email: `vendedor1@${dominio}`, fullName: 'Carla Mendes', role: 'salesperson' as const },
    { email: `vendedor2@${dominio}`, fullName: 'Diego Santana', role: 'salesperson' as const },
  ];
  const vendedores: string[] = [];
  for (const m of equipe) {
    const u = await tx.user.upsert({
      where: { email: m.email },
      update: {},
      create: { ...m, tenantId, passwordHash, status: 'active', emailVerifiedAt: AGORA },
    });
    vendedores.push(u.id);
  }
  const vendedor = (i: number) => vendedores[i % vendedores.length];

  // ── Estoque: aquisição e custos de preparação em todos os veículos ─────────
  const vendidosAntes = new Map<number, number>(); // veículo → dia em que o 1º negócio abriu
  for (const n of NEGOCIOS) {
    const abertura = n.linha[0][1];
    vendidosAntes.set(n.veiculo, Math.max(vendidosAntes.get(n.veiculo) ?? 0, abertura));
  }

  const veiculos: { id: string; preco: Prisma.Decimal; entrada: Date }[] = [];
  for (let i = 0; i < ESTOQUE.length; i++) {
    const e = ESTOQUE[i];
    const m = modelos.get(`${e.marca}|${e.modelo}`)!;
    const valor = preco(e.preco * (0.96 + rng.next() * 0.08));
    // Entra no estoque antes do primeiro negócio; os parados ficam 20–110 dias.
    const diasNoEstoque = (vendidosAntes.get(i) ?? rng.int(20, 90)) + rng.int(12, 25);
    const entrada = diasAtras(diasNoEstoque, 9);

    const compra = centena(valor.times(D(0.8 + rng.next() * 0.06)));
    const v = await tx.vehicle.create({
      data: {
        tenantId, branchId, brandId: m.brandId, modelId: m.modelId,
        versionName: e.versao, yearMake: e.ano, yearModel: e.ano + (rng.next() > 0.5 ? 1 : 0),
        mileageKm: e.km + rng.int(0, 4000), color: rng.pick(CORES),
        fuel: e.comb, transmission: e.cambio, condition: e.ano >= 2024 ? 'semi_new' : 'used',
        status: 'available', price: valor,
        licensePlate: `${String.fromCharCode(65 + rng.int(0, 25))}${String.fromCharCode(65 + rng.int(0, 25))}${String.fromCharCode(65 + rng.int(0, 25))}${rng.int(0, 9)}${String.fromCharCode(65 + rng.int(0, 9))}${rng.int(10, 99)}`,
        // O estoque de demonstração nasce publicado: a loja de exemplo existe
        // para ser navegada, e um catálogo vazio não demonstraria nada.
        listingStatus: 'published', publishedAt: entrada, createdAt: entrada,
        metadata: { seed: 'demo' },
        images: { create: [{ tenantId, url: FOTOS[i % FOTOS.length], isCover: true, position: 0 }] },
        acquisition: {
          create: {
            tenantId,
            origin: rng.pick(['direct_purchase', 'trade_in', 'auction'] as const),
            supplierName: 'Fornecedor demo',
            purchaseValue: compra,
            enteredAt: entrada,
          },
        },
        costs: {
          create: [
            { tenantId, kind: 'preparation', value: D(rng.int(6, 18) * 100), description: 'Higienização e polimento', incurredAt: diasAtras(diasNoEstoque - 2, 14) },
            { tenantId, kind: 'mechanical', value: D(rng.int(4, 30) * 100), description: 'Revisão e troca de pastilhas', incurredAt: diasAtras(diasNoEstoque - 4, 15) },
            { tenantId, kind: 'documentation', value: D(rng.int(3, 7) * 100), description: 'Vistoria e transferência', incurredAt: diasAtras(diasNoEstoque - 5, 11) },
          ],
        },
      },
      select: { id: true },
    });
    veiculos.push({ id: v.id, preco: valor, entrada });
  }

  // ── Negócios ───────────────────────────────────────────────────────────────
  let clienteDaVez = 0;
  let negociosCriados = 0;
  let faturados = 0;
  for (const [k, n] of NEGOCIOS.entries()) {
    const v = veiculos[n.veiculo];
    const clienteIdx = clienteDaVez++ % clientes.length;
    const customerUserId = clientes[clienteIdx];
    const cliente = CLIENTES[clienteIdx];
    const salespersonId = vendedor(k);
    const quando = (dias: number, h: number) => diasAtras(dias, h, rng.int(0, 59));
    const abertura = quando(n.linha[0][1], 10);
    const final = n.linha[n.linha.length - 1][0];
    const marco = (s: DealStatus) => {
      const p = n.linha.find(([st]) => st === s);
      return p ? quando(p[1], 16) : null;
    };

    // Lead de origem e test drive concluído antes da abertura.
    const leadCriado = diasAtras(n.linha[0][1] + rng.int(2, 6), 11, rng.int(0, 59));
    const ganho = marco('signed');
    const lead = await tx.lead.create({
      data: {
        tenantId, branchId, customerUserId, vehicleId: v.id, assignedTo: salespersonId,
        contactName: cliente.nome, contactEmail: emailDoCliente(clienteIdx),
        source: rng.pick(['website', 'whatsapp', 'app', 'walk_in', 'referral', 'ad'] as const),
        status: final === 'canceled' ? 'lost' : ganho ? 'won' : final === 'draft' ? 'qualified' : 'negotiating',
        wonAt: ganho, lostReason: final === 'canceled' ? MOTIVO_CANCELAMENTO : null,
        message: 'Tenho interesse neste veículo. Aceita troca?',
        score: rng.int(55, 95),
        createdAt: leadCriado, lastActivityAt: abertura,
        metadata: { seed: 'demo' },
      },
    });
    const testDrive = diasAtras(n.linha[0][1] + 1, 15);
    await tx.appointment.create({
      data: {
        tenantId, branchId, customerUserId, salespersonId, vehicleId: v.id, leadId: lead.id,
        type: 'test_drive', status: 'completed',
        scheduledStart: testDrive, scheduledEnd: new Date(testDrive.getTime() + 45 * 60_000),
        createdAt: leadCriado,
      },
    });

    // Valores: tabela − desconto = venda, sempre em Decimal.
    const listPrice = v.preco;
    const discount = D(rng.int(0, 25) * 100);
    const saleValue = listPrice.minus(discount);

    const signedAt = marco('signed');
    const invoicedAt = marco('invoiced');
    const deliveredAt = marco('delivered');
    const canceledAt = marco('canceled');

    // Faturado congela custo e margem, exatamente como `DealStateService`.
    let vehicleCostSnapshot: Prisma.Decimal | null = null;
    let grossMargin: Prisma.Decimal | null = null;
    if (invoicedAt) {
      const [aq, custos] = await Promise.all([
        tx.vehicleAcquisition.findFirst({ where: { tenantId, vehicleId: v.id }, select: { purchaseValue: true } }),
        tx.vehicleCost.findMany({ where: { tenantId, vehicleId: v.id }, select: { value: true } }),
      ]);
      vehicleCostSnapshot = custos.reduce((a, c) => a.plus(c.value), aq!.purchaseValue);
      grossMargin = saleValue.minus(vehicleCostSnapshot);
      faturados++;
    }

    const deal = await tx.deal.create({
      data: {
        tenantId, branchId, leadId: lead.id, vehicleId: v.id, customerUserId, salespersonId,
        status: final, listPrice, discount, saleValue,
        vehicleCostSnapshot, grossMargin,
        closedAt: signedAt, deliveredAt,
        canceledAt, cancelReason: canceledAt ? MOTIVO_CANCELAMENTO : null,
        createdAt: abertura,
      },
    });
    negociosCriados++;

    // Histórico: abertura (draft→draft, como o service grava) + cada transição.
    const eventos: { from: DealStatus; to: DealStatus; em: Date; reason?: string }[] = [
      { from: 'draft', to: 'draft', em: abertura, reason: 'Negócio aberto' },
    ];
    for (let p = 1; p < n.linha.length; p++) {
      const [st, dias] = n.linha[p];
      eventos.push({
        from: n.linha[p - 1][0], to: st, em: quando(dias, 16),
        reason: st === 'canceled' ? MOTIVO_CANCELAMENTO : undefined,
      });
    }
    // Os marcos acima usam a mesma hora (16h) com minuto sorteado; o evento
    // grava o valor que foi para o negócio, para os dois baterem.
    for (const e of eventos) {
      const exato =
        e.to === 'signed' ? signedAt : e.to === 'invoiced' ? invoicedAt :
        e.to === 'delivered' ? deliveredAt : e.to === 'canceled' ? canceledAt : null;
      await tx.dealStatusEvent.create({
        data: {
          tenantId, dealId: deal.id, fromStatus: e.from, toStatus: e.to,
          actorUserId: salespersonId, reason: e.reason ?? null,
          occurredAt: exato ?? e.em,
        },
      });
    }

    // Pagamentos: a partir do contrato a composição fecha com a venda — a
    // assinatura é recusada sem isso. Em negociação, só a entrada proposta.
    const chegouAoContrato = n.linha.some(([s]) => s === 'contract_issued');
    const confirmado = signedAt != null;
    if (n.pagamento === 'avista' && chegouAoContrato) {
      await tx.dealPayment.create({
        data: { tenantId, dealId: deal.id, kind: 'cash', value: saleValue,
          status: confirmado ? 'confirmed' : 'pending', confirmedAt: confirmado ? signedAt : null },
      });
    } else if (n.pagamento === 'financiado' || final === 'negotiating') {
      const entrada = centena(saleValue.times(D('0.3')));
      await tx.dealPayment.create({
        data: { tenantId, dealId: deal.id, kind: 'down_payment', value: entrada,
          status: confirmado ? 'confirmed' : 'pending', confirmedAt: confirmado ? signedAt : null },
      });
      if (chegouAoContrato) {
        const financiado = saleValue.minus(entrada);
        await tx.dealPayment.create({
          data: {
            tenantId, dealId: deal.id, kind: 'financing', value: financiado,
            institution: 'Financeira Demo', installments: 48,
            installmentValue: financiado.times(D('1.45')).dividedBy(48).toDecimalPlaces(2),
            status: confirmado ? 'confirmed' : 'pending', confirmedAt: confirmado ? signedAt : null,
          },
        });
      }
    }

    // Comprador identificado (CPF válido): exigido para emitir contrato.
    if (chegouAoContrato) {
      await tx.dealBuyer.create({
        data: {
          dealId: deal.id, tenantId, fullName: cliente.nome, cpf: gerarCpf(rng),
          maritalStatus: rng.pick(['solteiro(a)', 'casado(a)']), occupation: rng.pick(['analista', 'professor(a)', 'engenheiro(a)', 'empresário(a)']),
          addressLine: 'Rua das Acácias', addressNumber: String(rng.int(10, 999)),
          neighborhood: 'Centro', city: cliente.cidade, state: cliente.uf,
        },
      });
    }

    // Veículo como o fluxo real deixa: faturado → vendido; vivo → reservado;
    // cancelado → volta ao estoque (e pode ser reaberto por outro negócio).
    if (invoicedAt) {
      await tx.vehicle.update({ where: { id: v.id }, data: { status: 'sold', soldAt: invoicedAt } });
    } else if (final !== 'canceled') {
      await tx.vehicle.update({ where: { id: v.id }, data: { status: 'reserved' } });
    }
  }

  // ── Leads soltos: metade nos últimos 30 dias, dois hoje ───────────────────
  const STATUS_ANTIGO = ['contacted', 'qualified', 'lost', 'lost', 'archived', 'won'] as const;
  const STATUS_RECENTE = ['new', 'new', 'contacted', 'qualified', 'negotiating', 'lost'] as const;
  const leadsSoltos: { id: string; cliente: number; dias: number }[] = [];
  for (let i = 0; i < 22; i++) {
    const dias = i < 2 ? 0 : i < 12 ? rng.int(1, 29) : rng.int(30, 89);
    const clienteIdx = rng.int(0, clientes.length - 1);
    const status = dias === 0 ? 'new' : dias < 30 ? rng.pick(STATUS_RECENTE) : rng.pick(STATUS_ANTIGO);
    const criado = diasAtras(dias, rng.int(8, 19), rng.int(0, 59));
    const comConta = rng.next() > 0.35;
    const l = await tx.lead.create({
      data: {
        tenantId, branchId,
        customerUserId: comConta ? clientes[clienteIdx] : null,
        vehicleId: veiculos[rng.int(0, veiculos.length - 1)].id,
        assignedTo: status === 'new' ? null : vendedor(i),
        contactName: comConta ? CLIENTES[clienteIdx].nome : rng.pick(['Marcos Vinícius', 'Renata Souza', 'Paulo César', 'Luana Duarte']),
        contactEmail: comConta ? emailDoCliente(clienteIdx) : null,
        contactPhone: comConta ? null : `(62) 9${rng.int(8000, 9999)}-${rng.int(1000, 9999)}`,
        source: rng.pick(['website', 'website', 'whatsapp', 'app', 'phone', 'social', 'ad', 'walk_in'] as const),
        status,
        wonAt: status === 'won' ? diasAtras(Math.max(0, dias - 5), 17) : null,
        lostReason: status === 'lost' ? rng.pick(['Comprou em outra loja', 'Achou o preço alto', 'Desistiu da compra']) : null,
        message: rng.pick(['Qual o menor valor à vista?', 'Ainda está disponível?', 'Faz financiamento sem entrada?', 'Posso agendar um test drive?']),
        createdAt: criado, lastActivityAt: criado,
        metadata: { seed: 'demo' },
      },
    });
    if (comConta) leadsSoltos.push({ id: l.id, cliente: clienteIdx, dias });
  }

  // ── Agendamentos: passados (concluído / não compareceu / cancelado) e ──────
  //    futuros, com um hoje, para o painel e o funil terem o que mostrar.
  const agenda: { dias: number; status: 'completed' | 'no_show' | 'canceled' | 'scheduled' | 'confirmed'; hora: number }[] = [
    { dias: -25, status: 'no_show', hora: 10 },
    { dias: -18, status: 'completed', hora: 14 },
    { dias: -12, status: 'canceled', hora: 11 },
    { dias: -6, status: 'no_show', hora: 16 },
    { dias: -3, status: 'completed', hora: 10 },
    { dias: 0, status: 'confirmed', hora: 18 },
    { dias: 1, status: 'scheduled', hora: 10 },
    { dias: 2, status: 'confirmed', hora: 15 },
    { dias: 4, status: 'scheduled', hora: 11 },
    { dias: 9, status: 'scheduled', hora: 14 },
  ];
  for (const [i, a] of agenda.entries()) {
    const l = leadsSoltos[i % Math.max(1, leadsSoltos.length)];
    const inicio = a.dias <= 0 ? diasAtras(-a.dias, a.hora) : diasAFrente(a.dias, a.hora);
    // Hoje às 18h pode já ter passado: joga para daqui a uma hora.
    const start = a.dias === 0 && inicio <= AGORA ? new Date(AGORA.getTime() + 60 * 60_000) : inicio;
    await tx.appointment.create({
      data: {
        tenantId, branchId,
        customerUserId: clientes[l?.cliente ?? i % clientes.length],
        leadId: l?.id ?? null,
        salespersonId: vendedor(i),
        vehicleId: veiculos[(i * 3) % veiculos.length].id,
        type: i % 3 === 2 ? 'evaluation' : 'test_drive',
        status: a.status,
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + 45 * 60_000),
        cancellationReason: a.status === 'canceled' ? 'Cliente pediu para remarcar' : null,
        createdAt: diasAtras(Math.max(0, -a.dias) + rng.int(1, 4), 9),
      },
    });
  }

  // ── Visualizações (top veículos do relatório) ─────────────────────────────
  const views: Prisma.VehicleViewCreateManyInput[] = [];
  for (const [i, v] of veiculos.entries()) {
    const n = rng.int(3, 18) + (i % 4 === 0 ? 10 : 0);
    for (let j = 0; j < n; j++) {
      const dias = rng.int(0, Math.min(89, Math.floor((AGORA.getTime() - v.entrada.getTime()) / 86_400_000)));
      views.push({
        tenantId, vehicleId: v.id, source: rng.pick(['catalogo', 'mapa', 'pagina_loja']),
        sessionId: `demo-${i}-${j}`, viewedAt: diasAtras(dias, rng.int(8, 22), rng.int(0, 59)),
      });
    }
    await tx.vehicle.update({ where: { id: v.id }, data: { viewsCount: n } });
  }
  await tx.vehicleView.createMany({ data: views });

  return { veiculos: veiculos.length, negocios: negociosCriados, faturados, views: views.length };
}

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

  // ── Operação demo (datas relativas a hoje) ────────────────────────────────
  console.log('\n📊  Operação demo (estoque, leads, agendamentos, negócios)…\n');
  const reset = process.env.SEED_DEMO_RESET === '1';
  const modelos = await garantirCatalogo();
  const clientes = await garantirClientes(passwordHash);

  for (const d of dealerships) {
    const t = await prisma.tenant.findUnique({
      where: { slug: d.slug }, select: { id: true, slug: true, tradeName: true },
    });
    if (!t) continue;

    const jaTem = await prisma.vehicle.count({
      where: { tenantId: t.id, metadata: { path: ['seed'], equals: 'demo' } },
    });
    if (jaTem > 0 && !reset) {
      console.log(`  ⏭  ${t.tradeName}: operação demo já existe (SEED_DEMO_RESET=1 refaz com datas de hoje)`);
      continue;
    }

    // Uma transação por loja: a marca `metadata.seed` só existe se a operação
    // inteira entrou, e é ela que decide o pulo na próxima execução.
    const r = await prisma.$transaction(
      async (tx) => {
        if (jaTem > 0) await apagarDemo(tx, t.id, clientes);
        return semearOperacao(tx, t, modelos, clientes, passwordHash);
      },
      { maxWait: 15_000, timeout: 180_000 },
    );
    console.log(
      `  ✅  ${t.tradeName}: ${r.veiculos} veículos, ${r.negocios} negócios ` +
        `(${r.faturados} faturados), ${r.views} visualizações`,
    );
  }

  console.log('\n✨  Seed concluído!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
