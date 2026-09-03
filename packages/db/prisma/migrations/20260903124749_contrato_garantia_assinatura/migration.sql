-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('draft', 'issued', 'signed', 'voided');

-- CreateEnum
CREATE TYPE "SignerRole" AS ENUM ('customer', 'dealer');

-- CreateTable
CREATE TABLE "contract_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "blocks" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'draft',
    "snapshot" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "storage_key" TEXT,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signed_at" TIMESTAMPTZ,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "deal_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_signatures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "role" "SignerRole" NOT NULL,
    "signer_user_id" UUID,
    "signer_name" TEXT NOT NULL,
    "signer_document" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "accepted_hash" TEXT NOT NULL,
    "signed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_warranties" (
    "deal_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_days" INTEGER NOT NULL DEFAULT 90,
    "legal_starts_at" TIMESTAMPTZ,
    "contractual_months" INTEGER,
    "contractual_scope" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "deal_warranties_pkey" PRIMARY KEY ("deal_id")
);

-- CreateIndex
CREATE INDEX "contract_templates_tenant_id_idx" ON "contract_templates"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_templates_tenant_id_name_version_key" ON "contract_templates"("tenant_id", "name", "version");

-- CreateIndex
CREATE INDEX "deal_contracts_tenant_id_deal_id_idx" ON "deal_contracts"("tenant_id", "deal_id");

-- CreateIndex
CREATE INDEX "contract_signatures_tenant_id_idx" ON "contract_signatures"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_signatures_contract_id_role_key" ON "contract_signatures"("contract_id", "role");

-- CreateIndex
CREATE INDEX "deal_warranties_tenant_id_idx" ON "deal_warranties"("tenant_id");

-- AddForeignKey
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_contracts" ADD CONSTRAINT "deal_contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_contracts" ADD CONSTRAINT "deal_contracts_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_contracts" ADD CONSTRAINT "deal_contracts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "deal_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_signer_user_id_fkey" FOREIGN KEY ("signer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_warranties" ADD CONSTRAINT "deal_warranties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_warranties" ADD CONSTRAINT "deal_warranties_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────
-- RLS das tabelas de contrato
-- ─────────────────────────────────────────────────────────
-- Mesmo padrão da migration 20260902120000. Aqui o dado é contrato assinado,
-- CPF do signatário e trilha de evidências — o vazamento deixa de ser questão
-- de privacidade e vira prova jurídica na mão de terceiro.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'contract_templates', 'deal_contracts', 'contract_signatures', 'deal_warranties'
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

-- ─────────────────────────────────────────────────────────
-- Contrato emitido é imutável
-- ─────────────────────────────────────────────────────────
-- A regra também vive no service, mas ali é uma linha que alguém remove sem
-- perceber. Aqui é o banco recusando: depois de emitido, só `status`, as datas
-- e o motivo de anulação podem mudar. Conteúdo, snapshot e hash, nunca —
-- senão a assinatura passa a valer para um documento diferente do assinado.
CREATE OR REPLACE FUNCTION contrato_emitido_e_imutavel() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.snapshot::text  IS DISTINCT FROM OLD.snapshot::text
    OR NEW.content_hash    IS DISTINCT FROM OLD.content_hash
    OR NEW.template_id     IS DISTINCT FROM OLD.template_id
    OR NEW.deal_id         IS DISTINCT FROM OLD.deal_id
  ) THEN
    RAISE EXCEPTION 'Contrato % já foi emitido: conteúdo, hash e template não mudam mais.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER deal_contracts_imutavel
  BEFORE UPDATE ON deal_contracts
  FOR EACH ROW EXECUTE FUNCTION contrato_emitido_e_imutavel();
