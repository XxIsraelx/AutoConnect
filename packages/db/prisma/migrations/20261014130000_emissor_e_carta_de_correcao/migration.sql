-- Emissor real e carta de correção — fase N3 do plano fiscal (trilha NF-e).
--
-- Plano: docs/planos/plano-fiscal-renave-nfe.md
--
--  * CST de PIS/COFINS no perfil da operação — a nota real pede, por item.
--  * a empresa da loja no emissor: só o id (`emissor_conta`) e o que o emissor
--    devolve sobre o certificado A1. **Nenhum token, nenhum certificado**: o
--    token da empresa é buscado pela conta da plataforma quando precisa.
--  * `fiscal_correction_letters`: cada carta de correção, autorizada ou não. RLS.

-- AlterTable
ALTER TABLE "fiscal_operation_profiles" ADD COLUMN     "pis_cofins_situacao_tributaria" CHAR(2);

-- AlterTable
ALTER TABLE "fiscal_settings" ADD COLUMN     "certificado_cnpj" TEXT,
ADD COLUMN     "certificado_enviado_em" TIMESTAMPTZ,
ADD COLUMN     "certificado_enviado_por" UUID,
ADD COLUMN     "certificado_valido_ate" TIMESTAMPTZ,
ADD COLUMN     "emissor_conta" TEXT;

-- CreateTable
CREATE TABLE "fiscal_correction_letters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "sequencia" SMALLINT,
    "correcao" TEXT NOT NULL,
    "protocolo" TEXT,
    "motivo" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_correction_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fiscal_correction_letters_tenant_id_idx" ON "fiscal_correction_letters"("tenant_id");

-- CreateIndex
CREATE INDEX "fiscal_correction_letters_document_id_created_at_idx" ON "fiscal_correction_letters"("document_id", "created_at");

-- AddForeignKey
ALTER TABLE "fiscal_correction_letters" ADD CONSTRAINT "fiscal_correction_letters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_correction_letters" ADD CONSTRAINT "fiscal_correction_letters_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "fiscal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "fiscal_operation_profiles"
  ADD CONSTRAINT "fiscal_operation_profiles_pis_cofins"
    CHECK ("pis_cofins_situacao_tributaria" IS NULL OR "pis_cofins_situacao_tributaria" ~ '^\d{2}$');

ALTER TABLE "fiscal_correction_letters"
  ADD CONSTRAINT "fiscal_correction_letters_status"
    CHECK ("status" IN ('autorizada', 'rejeitada')),
  ADD CONSTRAINT "fiscal_correction_letters_texto"
    CHECK (char_length("correcao") BETWEEN 15 AND 1000),
  ADD CONSTRAINT "fiscal_correction_letters_recusa_tem_motivo"
    CHECK ("status" <> 'rejeitada' OR "motivo" IS NOT NULL);

ALTER TABLE "fiscal_correction_letters" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fiscal_correction_letters"
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
