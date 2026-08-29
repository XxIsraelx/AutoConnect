-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'trade_in';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "accepts_trade_in" BOOLEAN NOT NULL DEFAULT false;
