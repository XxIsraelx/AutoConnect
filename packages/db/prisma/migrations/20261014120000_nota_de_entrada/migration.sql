-- Nota de entrada — fase N2b do plano fiscal (trilha NF-e, sessão 1).
--
-- Plano: docs/planos/plano-fiscal-renave-nfe.md
--
--  * `acquisition_suppliers`: quem entregou o veículo, qualificado para
--    documento (remetente da nota de entrada; vendedor no RENAVE). RLS.
--  * a nota passa a ter **exatamente uma origem**: o negócio (saída) ou a
--    aquisição (entrada) — `num_nonnulls` = 1.
--  * uma nota de entrada viva por aquisição, pelo mesmo índice parcial da saída.
--  * o trigger de imutabilidade passa a travar também a aquisição de origem.

-- AlterTable
ALTER TABLE "fiscal_documents" ADD COLUMN     "vehicle_acquisition_id" UUID;

-- CreateTable
CREATE TABLE "acquisition_suppliers" (
    "acquisition_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "documento" TEXT NOT NULL,
    "rg" TEXT,
    "address_line" TEXT,
    "address_number" TEXT,
    "complement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" CHAR(2),
    "postal_code" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "acquisition_suppliers_pkey" PRIMARY KEY ("acquisition_id")
);

-- CreateIndex
CREATE INDEX "acquisition_suppliers_tenant_id_idx" ON "acquisition_suppliers"("tenant_id");

-- CreateIndex
CREATE INDEX "fiscal_documents_vehicle_acquisition_id_idx" ON "fiscal_documents"("vehicle_acquisition_id");

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_vehicle_acquisition_id_fkey" FOREIGN KEY ("vehicle_acquisition_id") REFERENCES "vehicle_acquisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquisition_suppliers" ADD CONSTRAINT "acquisition_suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquisition_suppliers" ADD CONSTRAINT "acquisition_suppliers_acquisition_id_fkey" FOREIGN KEY ("acquisition_id") REFERENCES "vehicle_acquisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────
-- Uma origem, uma nota viva por origem
-- ─────────────────────────────────────────────────────────
ALTER TABLE "fiscal_documents"
  ADD CONSTRAINT "fiscal_documents_uma_origem"
    CHECK (num_nonnulls("deal_id", "vehicle_acquisition_id") = 1);

CREATE UNIQUE INDEX "fiscal_documents_entrada_viva_idx"
  ON "fiscal_documents" ("vehicle_acquisition_id")
  WHERE "vehicle_acquisition_id" IS NOT NULL AND "status" IN ('processando', 'autorizada');

ALTER TABLE "acquisition_suppliers"
  ADD CONSTRAINT "acquisition_suppliers_documento"
    CHECK ("documento" ~ '^(\d{11}|[0-9A-Z]{12}\d{2})$'),
  ADD CONSTRAINT "acquisition_suppliers_cep"
    CHECK ("postal_code" IS NULL OR "postal_code" ~ '^\d{8}$');

-- ─────────────────────────────────────────────────────────
-- A aquisição de origem também não muda depois de emitida
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION nota_autorizada_e_imutavel() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'processando' AND (
       NEW.snapshot::text          IS DISTINCT FROM OLD.snapshot::text
    OR NEW.chave                   IS DISTINCT FROM OLD.chave
    OR NEW.numero                  IS DISTINCT FROM OLD.numero
    OR NEW.serie                   IS DISTINCT FROM OLD.serie
    OR NEW.protocolo               IS DISTINCT FROM OLD.protocolo
    OR NEW.deal_id                 IS DISTINCT FROM OLD.deal_id
    OR NEW.vehicle_acquisition_id  IS DISTINCT FROM OLD.vehicle_acquisition_id
    OR NEW.operation               IS DISTINCT FROM OLD.operation
    OR NEW.ambiente                IS DISTINCT FROM OLD.ambiente
    OR NEW.autorizada_em           IS DISTINCT FROM OLD.autorizada_em
  ) THEN
    RAISE EXCEPTION 'Nota % já saiu de processamento: o que foi emitido não muda.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       OLD.status = 'processando'
    OR (OLD.status = 'autorizada' AND NEW.status = 'cancelada')
  ) THEN
    RAISE EXCEPTION 'Nota %: transição % → % não existe.', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF (OLD.xml_key IS NOT NULL AND NEW.xml_key IS DISTINCT FROM OLD.xml_key)
  OR (OLD.xml_sha256 IS NOT NULL AND NEW.xml_sha256 IS DISTINCT FROM OLD.xml_sha256)
  OR (OLD.danfe_key IS NOT NULL AND NEW.danfe_key IS DISTINCT FROM OLD.danfe_key) THEN
    RAISE EXCEPTION 'Nota %: o XML e o DANFE arquivados não são substituídos.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────
ALTER TABLE "acquisition_suppliers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "acquisition_suppliers"
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
