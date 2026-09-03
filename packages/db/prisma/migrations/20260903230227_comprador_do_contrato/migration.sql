-- CreateTable
CREATE TABLE "deal_buyers" (
    "deal_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "rg" TEXT,
    "rg_issuer" TEXT,
    "nationality" TEXT DEFAULT 'brasileiro(a)',
    "marital_status" TEXT,
    "occupation" TEXT,
    "address_line" TEXT,
    "address_number" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" CHAR(2),
    "postal_code" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "deal_buyers_pkey" PRIMARY KEY ("deal_id")
);

-- CreateIndex
CREATE INDEX "deal_buyers_tenant_id_idx" ON "deal_buyers"("tenant_id");

-- AddForeignKey
ALTER TABLE "deal_buyers" ADD CONSTRAINT "deal_buyers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_buyers" ADD CONSTRAINT "deal_buyers_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: CPF, RG e endereço do comprador.
ALTER TABLE deal_buyers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deal_buyers
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
