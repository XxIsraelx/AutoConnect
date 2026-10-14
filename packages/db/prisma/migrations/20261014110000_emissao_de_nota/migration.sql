-- Emissão da NF-e — fase N2 do plano fiscal (trilha NF-e, sessão 1).
--
-- Plano: docs/planos/plano-fiscal-renave-nfe.md
--
-- O que este arquivo garante além das tabelas:
--
--  * **uma nota viva por negócio** (`fiscal_documents_nota_viva_idx`): o clique
--    duplo em "emitir" bate no índice, não num `if` que alguém pode errar.
--    Rejeitada, denegada e cancelada não contam — a loja emite de novo.
--  * coerência de estado: autorizada tem chave, protocolo e data; cancelada
--    também, mais a justificativa (15 a 255 caracteres, como a SEFAZ exige);
--    rejeitada e denegada têm motivo.
--  * **autorizada é imutável** (trigger): só o cancelamento e o arquivamento
--    do XML/DANFE mudam a linha; snapshot, chave, número e protocolo, nunca.
--  * negócio com nota não se apaga (`ON DELETE RESTRICT`).
--  * RLS `tenant_isolation` nas duas tabelas.

-- CreateEnum
CREATE TYPE "StatusDaNota" AS ENUM ('processando', 'autorizada', 'rejeitada', 'denegada', 'cancelada');

-- CreateTable
CREATE TABLE "fiscal_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "deal_id" UUID,
    "operation" "OperacaoFiscal" NOT NULL,
    "status" "StatusDaNota" NOT NULL DEFAULT 'processando',
    "provider" TEXT NOT NULL,
    "ambiente" "AmbienteFiscal" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "serie" SMALLINT,
    "numero" INTEGER,
    "chave" CHAR(44),
    "protocolo" TEXT,
    "motivo" TEXT,
    "xml_key" TEXT,
    "danfe_key" TEXT,
    "xml_sha256" CHAR(64),
    "emitted_by" UUID,
    "autorizada_em" TIMESTAMPTZ,
    "cancelada_em" TIMESTAMPTZ,
    "cancelada_por" UUID,
    "justificativa_do_cancelamento" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_document_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "corpo" TEXT,
    "aviso" TEXT,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_document_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fiscal_documents_tenant_id_created_at_idx" ON "fiscal_documents"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "fiscal_documents_deal_id_idx" ON "fiscal_documents"("deal_id");

-- CreateIndex
CREATE INDEX "fiscal_document_events_document_id_received_at_idx" ON "fiscal_document_events"("document_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_document_events_provider_event_key_key" ON "fiscal_document_events"("provider", "event_key");

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_document_events" ADD CONSTRAINT "fiscal_document_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_document_events" ADD CONSTRAINT "fiscal_document_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "fiscal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────
-- Uma nota viva por negócio
-- ─────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "fiscal_documents_nota_viva_idx"
  ON "fiscal_documents" ("deal_id")
  WHERE "deal_id" IS NOT NULL AND "status" IN ('processando', 'autorizada');

-- ─────────────────────────────────────────────────────────
-- Coerência de estado
-- ─────────────────────────────────────────────────────────
ALTER TABLE "fiscal_documents"
  ADD CONSTRAINT "fiscal_documents_chave_formato"
    CHECK ("chave" IS NULL OR "chave" ~ '^\d{6}[0-9A-Z]{12}\d{26}$'),
  ADD CONSTRAINT "fiscal_documents_autorizada_completa"
    CHECK ("status" NOT IN ('autorizada', 'cancelada')
           OR ("chave" IS NOT NULL AND "protocolo" IS NOT NULL AND "autorizada_em" IS NOT NULL)),
  ADD CONSTRAINT "fiscal_documents_cancelada_completa"
    CHECK ("status" <> 'cancelada'
           OR ("cancelada_em" IS NOT NULL
               AND "justificativa_do_cancelamento" IS NOT NULL
               AND char_length("justificativa_do_cancelamento") BETWEEN 15 AND 255)),
  ADD CONSTRAINT "fiscal_documents_recusa_tem_motivo"
    CHECK ("status" NOT IN ('rejeitada', 'denegada') OR "motivo" IS NOT NULL);

-- ─────────────────────────────────────────────────────────
-- Nota autorizada é imutável
-- ─────────────────────────────────────────────────────────
-- A regra também vive em `aplicarRetorno` (shared), mas ali é uma linha que
-- alguém remove sem perceber. Aqui é o banco recusando — como o contrato
-- emitido. Fora de `processando`, o que foi enviado e o que a SEFAZ devolveu
-- não mudam; estado terminal não muda nada além do arquivamento.
CREATE OR REPLACE FUNCTION nota_autorizada_e_imutavel() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'processando' AND (
       NEW.snapshot::text IS DISTINCT FROM OLD.snapshot::text
    OR NEW.chave          IS DISTINCT FROM OLD.chave
    OR NEW.numero         IS DISTINCT FROM OLD.numero
    OR NEW.serie          IS DISTINCT FROM OLD.serie
    OR NEW.protocolo      IS DISTINCT FROM OLD.protocolo
    OR NEW.deal_id        IS DISTINCT FROM OLD.deal_id
    OR NEW.operation      IS DISTINCT FROM OLD.operation
    OR NEW.ambiente       IS DISTINCT FROM OLD.ambiente
    OR NEW.autorizada_em  IS DISTINCT FROM OLD.autorizada_em
  ) THEN
    RAISE EXCEPTION 'Nota % já saiu de processamento: o que foi emitido não muda.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Autorizada só vai para cancelada; terminal não vai para lugar nenhum.
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       OLD.status = 'processando'
    OR (OLD.status = 'autorizada' AND NEW.status = 'cancelada')
  ) THEN
    RAISE EXCEPTION 'Nota %: transição % → % não existe.', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- O arquivo arquivado também não troca: o hash conferido no download é dele.
  IF (OLD.xml_key IS NOT NULL AND NEW.xml_key IS DISTINCT FROM OLD.xml_key)
  OR (OLD.xml_sha256 IS NOT NULL AND NEW.xml_sha256 IS DISTINCT FROM OLD.xml_sha256)
  OR (OLD.danfe_key IS NOT NULL AND NEW.danfe_key IS DISTINCT FROM OLD.danfe_key) THEN
    RAISE EXCEPTION 'Nota %: o XML e o DANFE arquivados não são substituídos.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fiscal_documents_imutavel
  BEFORE UPDATE ON "fiscal_documents"
  FOR EACH ROW EXECUTE FUNCTION nota_autorizada_e_imutavel();

-- ─────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY['fiscal_documents', 'fiscal_document_events'];
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
