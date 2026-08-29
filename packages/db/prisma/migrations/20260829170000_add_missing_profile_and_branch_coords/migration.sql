-- Campos que já existiam no schema.prisma e eram usados pelo código, mas que
-- nunca tinham migration: chegaram no banco local via `prisma db push`.
-- Sem isto, um banco criado do zero (produção) quebraria no cadastro de
-- concessionária (auth.service.ts) e no mapa (latitude/longitude das filiais).

-- AlterTable: coordenadas das filiais, usadas pelos pins do mapa em /buscar
ALTER TABLE "dealership_branches" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;

-- AlterTable: Inscrição Estadual da concessionária
ALTER TABLE "tenants" ADD COLUMN "state_registration" TEXT;

-- AlterTable: dados do administrador preenchidos no onboarding
ALTER TABLE "users" ADD COLUMN "cpf" TEXT,
ADD COLUMN "job_title" TEXT;
