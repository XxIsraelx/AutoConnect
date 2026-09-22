-- CreateEnum
CREATE TYPE "SignatureRequestStatus" AS ENUM ('pending', 'sent', 'completed', 'refused', 'expired', 'canceled', 'failed');

-- AlterTable
ALTER TABLE "contract_signatures" ADD COLUMN     "external_signer_id" TEXT,
ADD COLUMN     "request_id" UUID;

-- AlterTable
ALTER TABLE "deal_buyers" ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "legal_rep_email" TEXT;

-- CreateTable
CREATE TABLE "contract_signature_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT,
    "status" "SignatureRequestStatus" NOT NULL DEFAULT 'pending',
    "content_hash" TEXT NOT NULL,
    "signers" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "signed_storage_key" TEXT,
    "signed_hash" TEXT,
    "error_message" TEXT,
    "cancel_reason" TEXT,
    "sent_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "canceled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contract_signature_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_signature_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "normalized" JSONB NOT NULL,
    "raw_body" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_signature_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_signature_requests_tenant_id_contract_id_idx" ON "contract_signature_requests"("tenant_id", "contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_signature_requests_provider_external_id_key" ON "contract_signature_requests"("provider", "external_id");

-- CreateIndex
CREATE INDEX "contract_signature_events_tenant_id_idx" ON "contract_signature_events"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_signature_events_request_id_event_key_key" ON "contract_signature_events"("request_id", "event_key");

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "contract_signature_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signature_requests" ADD CONSTRAINT "contract_signature_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signature_requests" ADD CONSTRAINT "contract_signature_requests_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "deal_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signature_events" ADD CONSTRAINT "contract_signature_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signature_events" ADD CONSTRAINT "contract_signature_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "contract_signature_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────
-- Um envio vivo por contrato
-- ─────────────────────────────────────────────────────────
-- A checagem no service não basta: entre o SELECT que confere e o INSERT que
-- reserva cabe outro clique, e o resultado seriam dois envelopes no provedor e
-- dois e-mails para o cliente assinar o mesmo contrato. Os estados vivos são
-- os de `ASSINATURA_EXTERNA_VIVAS` no @autoconnect/shared — mudou lá, muda aqui.
CREATE UNIQUE INDEX "contract_signature_requests_viva_idx"
  ON "contract_signature_requests" ("contract_id")
  WHERE status IN ('pending', 'sent');

-- ─────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────
-- Mesmo padrão das demais tabelas de contrato: e-mail e CPF dos signatários,
-- ids do envelope no provedor e os webhooks crus.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY['contract_signature_requests', 'contract_signature_events'];
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
