-- CreateEnum
CREATE TYPE "VehicleQueryKind" AS ENUM ('ownership', 'debts', 'auction', 'theft', 'fines', 'history');

-- CreateEnum
CREATE TYPE "VehicleQueryStatus" AS ENUM ('pending', 'success', 'failed');

-- CreateTable
CREATE TABLE "vehicle_queries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "plate" TEXT,
    "vin" TEXT,
    "kind" "VehicleQueryKind" NOT NULL,
    "status" "VehicleQueryStatus" NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL,
    "raw_response" JSONB,
    "result" JSONB,
    "cost_cents" INTEGER,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "error_message" TEXT,
    "queried_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vehicle_queries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_queries_idempotency_key_key" ON "vehicle_queries"("idempotency_key");

-- CreateIndex
CREATE INDEX "vehicle_queries_tenant_id_queried_at_idx" ON "vehicle_queries"("tenant_id", "queried_at" DESC);

-- CreateIndex
CREATE INDEX "vehicle_queries_vehicle_id_kind_idx" ON "vehicle_queries"("vehicle_id", "kind");

-- AddForeignKey
ALTER TABLE "vehicle_queries" ADD CONSTRAINT "vehicle_queries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_queries" ADD CONSTRAINT "vehicle_queries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS. Consulta veicular carrega placa, chassi e situação do veículo de
-- terceiro, além do quanto a loja gasta com fornecedor — dado que a
-- concorrente não deve ver.
ALTER TABLE vehicle_queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehicle_queries
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
