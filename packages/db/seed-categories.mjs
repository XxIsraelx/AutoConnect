import { PrismaClient } from './node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();

/* Carroceria por nome de modelo (case-insensitive, match parcial) */
const CATEGORY_MAP = {
  SUV: [
    'Tracker', 'T-Cross', 'Nivus', 'Tiguan', 'Taos', 'Pulse', 'Fastback', 'EcoSport',
    'Territory', 'Bronco', 'Corolla Cross', 'SW4', 'RAV4', 'HR-V', 'WR-V', 'CR-V',
    'Creta', 'Tucson', 'ix35', 'Santa Fe', 'Duster', 'Captur', 'Kardian', 'Renegade',
    'Compass', 'Commander', 'Cherokee', 'Kicks', 'ASX', 'Eclipse Cross', 'Outlander',
    'Pajero', 'Sportage', 'Sorento', 'Stonic', 'Soul', 'X1', 'X3', 'X5', 'X6',
    'GLA', 'GLC', 'GLE', 'Q3', 'Q5', 'Q7', 'XC40', 'XC60', 'XC90', 'C40',
    'Range Rover Evoque', 'Discovery Sport', 'Defender', 'Range Rover Velar',
    'Tiggo 2', 'Tiggo 3x', 'Tiggo 5x', 'Tiggo 7', 'Tiggo 8', 'Yuan Plus', 'Song Plus',
    'Jimny', 'Vitara', 'S-Cross', '2008', '3008', '5008', 'C4 Cactus', 'Aircross',
    'Trailblazer', 'Edge', 'Equinox',
  ],
  Picape: [
    'S10', 'Montana', 'Saveiro', 'Amarok', 'Strada', 'Toro', 'Hilux', 'Ranger',
    'Maverick', 'Gladiator', 'Frontier', 'L200 Triton', 'Oroch',
  ],
  Sedã: [
    'Onix Plus', 'Virtus', 'Voyage', 'Jetta', 'Cruze', 'Cronos', 'Siena', 'Ka Sedan',
    'Fiesta Sedan', 'Focus Sedan', 'Fusion', 'Corolla', 'Yaris Sedan', 'Etios Sedan',
    'Camry', 'Civic', 'City', 'HB20S', 'Azera', 'Elantra', 'Logan', 'Fluence',
    'Versa', 'Sentra', 'Cerato', '408', 'C4 Lounge', 'Arrizo 6', 'Han', 'Seal',
    '320i', '530i', 'Série 3', 'Classe C', 'Classe E', 'A3', 'A4', 'A5', 'S60',
    'Prisma', 'Classic', 'Accord',
  ],
  Hatch: [
    'Onix', 'Gol', 'Polo', 'Fox', 'Up', 'Mobi', 'Argo', 'Uno', 'Palio', 'Punto',
    'Ka', 'Fiesta', 'Focus', 'Yaris', 'Etios', 'Fit', 'City Hatch', 'HB20',
    'i30', 'Kwid', 'Sandero', 'Stepway', 'March', 'Picanto', '208', '308', 'C3',
    '118i', 'Classe A', 'A1', 'Celta', 'Cobalt', 'Dolphin', 'King', 'Leaf',
  ],
  Minivan: ['Spin', 'Doblo', 'Partner', 'Jumpy'],
  Furgão: ['Fiorino', 'Master', 'Kangoo'],
};

async function main() {
  // monta lookup nome → categoria (prioriza match mais específico/maior)
  const entries = [];
  for (const [cat, names] of Object.entries(CATEGORY_MAP)) {
    for (const n of names) entries.push({ name: n.toLowerCase(), cat });
  }
  // ordena por tamanho do nome desc para casar "Onix Plus" antes de "Onix"
  entries.sort((a, b) => b.name.length - a.name.length);

  const models = await prisma.vehicleModel.findMany({ select: { id: true, name: true } });
  let updated = 0;
  const counts = {};

  for (const m of models) {
    const lower = m.name.toLowerCase();
    const hit = entries.find((e) => lower === e.name) ?? entries.find((e) => lower.includes(e.name));
    if (hit) {
      await prisma.vehicleModel.update({ where: { id: m.id }, data: { category: hit.cat } });
      counts[hit.cat] = (counts[hit.cat] ?? 0) + 1;
      updated++;
    }
  }

  console.log(`Modelos atualizados: ${updated}/${models.length}`);
  console.log('Por carroceria:', JSON.stringify(counts));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
