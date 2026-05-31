import { PrismaClient } from './node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();

const FUELS = ['flex', 'gasoline', 'diesel', 'hybrid', 'electric'];
const TRANS = ['manual', 'automatic', 'cvt'];
const CONDS = ['new', 'used', 'semi_new'];
const COLORS = ['Prata', 'Preto', 'Branco', 'Cinza', 'Vermelho', 'Azul'];

// imagens placeholder de carros (Unsplash)
const IMAGES = [
  'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800',
  'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800',
  'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800',
  'https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=800',
  'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=800',
  'https://images.unsplash.com/photo-1542362567-b07e54358753?w=800',
];

const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rndInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

async function main() {
  const branches = await prisma.dealershipBranch.findMany({
    select: { id: true, tenantId: true },
  });
  const brands = await prisma.vehicleBrand.findMany({
    select: { id: true, models: { select: { id: true } } },
  });
  const withModels = brands.filter((b) => b.models.length > 0);

  // limpa veículos antigos (idempotente)
  await prisma.vehicleImage.deleteMany({});
  await prisma.vehicle.deleteMany({});

  let created = 0;
  for (const branch of branches) {
    const n = rndInt(6, 10);
    for (let i = 0; i < n; i++) {
      const brand = rnd(withModels);
      const model = rnd(brand.models);
      const cond = rnd(CONDS);
      const yearMake = cond === 'new' ? 2025 : rndInt(2015, 2024);
      const km = cond === 'new' ? 0 : rndInt(8000, 120000);
      const price = rndInt(45, 320) * 1000 + 900;

      const v = await prisma.vehicle.create({
        data: {
          tenantId: branch.tenantId,
          branchId: branch.id,
          brandId: brand.id,
          modelId: model.id,
          versionName: rnd(['1.0 Turbo', '1.6 AT', '2.0 Flex', 'GLS', 'Comfortline', 'XEi', null]),
          yearMake,
          yearModel: yearMake + (Math.random() > 0.5 ? 1 : 0),
          mileageKm: km,
          color: rnd(COLORS),
          fuel: rnd(FUELS),
          transmission: rnd(TRANS),
          condition: cond,
          status: 'available',
          price,
          ...(Math.random() > 0.7 ? { promoPrice: price - rndInt(3, 15) * 1000 } : {}),
          publishedAt: new Date(),
        },
      });

      // 1-3 imagens, 1ª como capa
      const imgCount = rndInt(1, 3);
      for (let j = 0; j < imgCount; j++) {
        await prisma.vehicleImage.create({
          data: {
            tenantId: branch.tenantId,
            vehicleId: v.id,
            url: rnd(IMAGES),
            isCover: j === 0,
            position: j,
          },
        });
      }
      created++;
    }
  }

  console.log(`Veículos criados: ${created}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
