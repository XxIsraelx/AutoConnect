-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('draft', 'proposal', 'negotiating', 'awaiting_credit', 'contract_issued', 'signed', 'invoiced', 'documentation', 'delivered', 'canceled', 'rescinded');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('cash', 'down_payment', 'trade_in', 'financing', 'consortium', 'other');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'confirmed', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "AcquisitionOrigin" AS ENUM ('direct_purchase', 'trade_in', 'consignment', 'dealer_transfer', 'auction', 'factory');

-- CreateEnum
CREATE TYPE "VehicleCostKind" AS ENUM ('preparation', 'mechanical', 'bodywork', 'documentation', 'transport', 'commission', 'other');

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "lead_id" UUID,
    "vehicle_id" UUID NOT NULL,
    "customer_user_id" UUID,
    "salesperson_id" UUID,
    "status" "DealStatus" NOT NULL DEFAULT 'draft',
    "list_price" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sale_value" DECIMAL(14,2) NOT NULL,
    "vehicle_cost_snapshot" DECIMAL(14,2),
    "gross_margin" DECIMAL(14,2),
    "closed_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "canceled_at" TIMESTAMPTZ,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "value" DECIMAL(14,2) NOT NULL,
    "institution" TEXT,
    "installments" SMALLINT,
    "installment_value" DECIMAL(14,2),
    "notes" TEXT,
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "deal_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_status_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "from_status" "DealStatus" NOT NULL,
    "to_status" "DealStatus" NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_ins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "brand_name" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "version_name" TEXT,
    "year_model" INTEGER NOT NULL,
    "year_make" INTEGER NOT NULL,
    "mileage_km" INTEGER NOT NULL,
    "license_plate" TEXT,
    "color" TEXT,
    "fipe_reference" TEXT,
    "fipe_value" DECIMAL(14,2),
    "appraised_value" DECIMAL(14,2) NOT NULL,
    "accepted_value" DECIMAL(14,2) NOT NULL,
    "vehicle_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "trade_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_acquisitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "origin" "AcquisitionOrigin" NOT NULL,
    "supplier_name" TEXT,
    "supplier_document" TEXT,
    "purchase_value" DECIMAL(14,2) NOT NULL,
    "entered_at" TIMESTAMPTZ NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vehicle_acquisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_costs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "kind" "VehicleCostKind" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "supplier_name" TEXT,
    "incurred_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vehicle_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deals_tenant_id_status_idx" ON "deals"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "deals_tenant_id_created_at_idx" ON "deals"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deals_vehicle_id_idx" ON "deals"("vehicle_id");

-- CreateIndex
CREATE INDEX "deal_payments_tenant_id_idx" ON "deal_payments"("tenant_id");

-- CreateIndex
CREATE INDEX "deal_payments_deal_id_idx" ON "deal_payments"("deal_id");

-- CreateIndex
CREATE INDEX "deal_status_events_tenant_id_idx" ON "deal_status_events"("tenant_id");

-- CreateIndex
CREATE INDEX "deal_status_events_deal_id_occurred_at_idx" ON "deal_status_events"("deal_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "trade_ins_deal_id_key" ON "trade_ins"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "trade_ins_vehicle_id_key" ON "trade_ins"("vehicle_id");

-- CreateIndex
CREATE INDEX "trade_ins_tenant_id_idx" ON "trade_ins"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_acquisitions_vehicle_id_key" ON "vehicle_acquisitions"("vehicle_id");

-- CreateIndex
CREATE INDEX "vehicle_acquisitions_tenant_id_idx" ON "vehicle_acquisitions"("tenant_id");

-- CreateIndex
CREATE INDEX "vehicle_costs_tenant_id_idx" ON "vehicle_costs"("tenant_id");

-- CreateIndex
CREATE INDEX "vehicle_costs_vehicle_id_idx" ON "vehicle_costs"("vehicle_id");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "dealership_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_payments" ADD CONSTRAINT "deal_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_payments" ADD CONSTRAINT "deal_payments_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_status_events" ADD CONSTRAINT "deal_status_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_status_events" ADD CONSTRAINT "deal_status_events_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_status_events" ADD CONSTRAINT "deal_status_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_acquisitions" ADD CONSTRAINT "vehicle_acquisitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_acquisitions" ADD CONSTRAINT "vehicle_acquisitions_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_costs" ADD CONSTRAINT "vehicle_costs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_costs" ADD CONSTRAINT "vehicle_costs_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────
-- Um veículo não pode ter dois negócios vivos ao mesmo tempo
-- ─────────────────────────────────────────────────────────
-- Sem isto, dois vendedores fecham o mesmo carro em paralelo e só se descobre
-- na entrega. A checagem no service não resolve: entre o SELECT e o INSERT
-- cabe outra transação. É índice único parcial porque a exclusividade só vale
-- enquanto o negócio está vivo — cancelado e distratado liberam o veículo.
--
-- `canceled` e `rescinded` são exatamente os dois estados sem transição de
-- saída na máquina de estados (packages/shared/src/domain/deal.ts).
CREATE UNIQUE INDEX "deals_veiculo_negocio_vivo_idx"
  ON "deals" ("vehicle_id")
  WHERE "status" NOT IN ('canceled', 'rescinded');

-- ─────────────────────────────────────────────────────────
-- RLS das tabelas novas
-- ─────────────────────────────────────────────────────────
-- Mesmo padrão da migration 20260902120000. Toda tabela nova com tenant_id
-- precisa disto: `rls-policies.e2e-spec.ts` compara a cobertura com o catálogo
-- do Postgres e quebra o CI se faltar.
--
-- Estas seis carregam preço de compra, margem e proposta bancária — o dado que
-- transforma um vazamento entre concessionárias em concorrente vendo a margem
-- do outro. Aqui o isolamento deixa de ser conforto e vira requisito.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'deals', 'deal_payments', 'deal_status_events', 'trade_ins',
    'vehicle_acquisitions', 'vehicle_costs'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;
