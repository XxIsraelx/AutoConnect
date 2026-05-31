import { PrismaClient } from './node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();

/* Marcas + modelos populares no Brasil */
const CATALOG = {
  Chevrolet: ['Onix', 'Onix Plus', 'Tracker', 'Spin', 'S10', 'Montana', 'Cruze', 'Equinox', 'Cobalt', 'Prisma', 'Celta', 'Classic', 'Trailblazer'],
  Volkswagen: ['Gol', 'Polo', 'Virtus', 'T-Cross', 'Nivus', 'Saveiro', 'Voyage', 'Jetta', 'Tiguan', 'Amarok', 'Fox', 'Up', 'Taos'],
  Fiat: ['Mobi', 'Argo', 'Cronos', 'Pulse', 'Fastback', 'Strada', 'Toro', 'Uno', 'Palio', 'Siena', 'Punto', 'Doblo', 'Fiorino'],
  Ford: ['Ka', 'Ka Sedan', 'EcoSport', 'Ranger', 'Territory', 'Fiesta', 'Focus', 'Fusion', 'Edge', 'Maverick', 'Bronco'],
  Toyota: ['Corolla', 'Corolla Cross', 'Hilux', 'Yaris', 'Yaris Sedan', 'SW4', 'RAV4', 'Etios', 'Camry', 'Prius'],
  Honda: ['Civic', 'City', 'City Hatch', 'Fit', 'HR-V', 'WR-V', 'CR-V', 'Accord'],
  Hyundai: ['HB20', 'HB20S', 'Creta', 'Tucson', 'ix35', 'Santa Fe', 'Azera', 'Elantra', 'i30'],
  Renault: ['Kwid', 'Sandero', 'Logan', 'Duster', 'Captur', 'Oroch', 'Stepway', 'Kardian', 'Fluence', 'Master'],
  Jeep: ['Renegade', 'Compass', 'Commander', 'Gladiator', 'Wrangler', 'Cherokee'],
  Nissan: ['Kicks', 'Versa', 'Sentra', 'Frontier', 'March', 'Leaf'],
  Peugeot: ['208', '2008', '3008', '5008', '308', '408', 'Partner'],
  Citroën: ['C3', 'C4 Cactus', 'C4 Lounge', 'Aircross', 'Jumpy'],
  Mitsubishi: ['L200 Triton', 'Pajero', 'Pajero Sport', 'ASX', 'Eclipse Cross', 'Outlander'],
  Kia: ['Sportage', 'Cerato', 'Picanto', 'Sorento', 'Soul', 'Stonic'],
  BMW: ['320i', '118i', 'X1', 'X3', 'X5', 'X6', '530i', 'Série 3'],
  'Mercedes-Benz': ['Classe A', 'Classe C', 'GLA', 'GLC', 'GLE', 'Classe E', 'CLA'],
  Audi: ['A3', 'A4', 'Q3', 'Q5', 'Q7', 'A5', 'A1'],
  Volvo: ['XC40', 'XC60', 'XC90', 'C40', 'S60'],
  'Land Rover': ['Range Rover Evoque', 'Discovery Sport', 'Defender', 'Range Rover Velar'],
  Chery: ['Tiggo 2', 'Tiggo 3x', 'Tiggo 5x', 'Tiggo 7', 'Tiggo 8', 'Arrizo 6'],
  BYD: ['Dolphin', 'Song Plus', 'Yuan Plus', 'Seal', 'Han', 'King'],
  Caoa: ['Tiggo 5x', 'Tiggo 7', 'Tiggo 8'],
  Suzuki: ['Jimny', 'Vitara', 'S-Cross'],
};

async function main() {
  let brandsCount = 0;
  let modelsCount = 0;

  for (const [brandName, models] of Object.entries(CATALOG)) {
    let brand = await prisma.vehicleBrand.findFirst({
      where: { name: { equals: brandName, mode: 'insensitive' } },
    });
    if (!brand) {
      brand = await prisma.vehicleBrand.create({ data: { name: brandName } });
      brandsCount++;
    }

    for (const modelName of models) {
      const exists = await prisma.vehicleModel.findFirst({
        where: { brandId: brand.id, name: { equals: modelName, mode: 'insensitive' } },
      });
      if (!exists) {
        await prisma.vehicleModel.create({
          data: { brandId: brand.id, name: modelName },
        });
        modelsCount++;
      }
    }
    console.log(`  ✓ ${brandName} (${models.length} modelos)`);
  }

  const totalBrands = await prisma.vehicleBrand.count();
  const totalModels = await prisma.vehicleModel.count();
  console.log(`\nNovas marcas: ${brandsCount} | Novos modelos: ${modelsCount}`);
  console.log(`Total no catálogo: ${totalBrands} marcas, ${totalModels} modelos`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
