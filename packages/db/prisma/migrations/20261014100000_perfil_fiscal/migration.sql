-- Perfil fiscal da loja — fase N1 do plano fiscal (trilha NF-e, sessão 1).
--
-- Plano:   docs/planos/plano-fiscal-renave-nfe.md
-- Decisão: docs/decisoes/2026-10-13 fiscal renave e nfe.md
--
-- O que este arquivo garante além das tabelas:
--
--  * formato no banco: CFOP de 4 dígitos, CST/CSOSN de 2 ou 3, NCM de 8,
--    RENAVAM de 11, série fora da faixa reservada (890–999). A coerência do
--    CFOP com a operação (entrada 1/2, saída 5/6) é do serviço, que sabe a
--    operação; o banco segura o que não depende de contexto.
--  * a confirmação do contador vem inteira ou não vem: data, quem registrou
--    e o nome do contador juntos — meia confirmação seria uma nota em produção
--    sem ninguém para responder por ela.
--  * RLS `tenant_isolation` nas três tabelas: é dado da loja, sem leitura
--    pública e sem caminho privilegiado.

-- CreateEnum
CREATE TYPE "RegimeTributario" AS ENUM ('mei', 'simples_nacional', 'simples_excesso_sublimite', 'lucro_presumido', 'lucro_real');

-- CreateEnum
CREATE TYPE "AmbienteFiscal" AS ENUM ('homologacao', 'producao');

-- CreateEnum
CREATE TYPE "OperacaoFiscal" AS ENUM ('venda', 'compra_de_particular', 'entrada_de_troca', 'entrada_em_consignacao', 'devolucao_de_consignacao', 'venda_de_consignado');

-- CreateTable
CREATE TABLE "fiscal_settings" (
    "tenant_id" UUID NOT NULL,
    "regime" "RegimeTributario" NOT NULL,
    "serie" SMALLINT NOT NULL DEFAULT 1,
    "ambiente" "AmbienteFiscal" NOT NULL DEFAULT 'homologacao',
    "contador_confirmou_em" TIMESTAMPTZ,
    "contador_confirmou_por" UUID,
    "contador_nome" TEXT,
    "contador_crc" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fiscal_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "fiscal_operation_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "operation" "OperacaoFiscal" NOT NULL,
    "natureza" TEXT NOT NULL,
    "cfop_interno" CHAR(4) NOT NULL,
    "cfop_interestadual" CHAR(4) NOT NULL,
    "situacao_tributaria" VARCHAR(3),
    "informacoes_complementares" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fiscal_operation_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_fiscal_details" (
    "vehicle_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ncm" CHAR(8),
    "renavam" CHAR(11),
    "origem" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vehicle_fiscal_details_pkey" PRIMARY KEY ("vehicle_id")
);

-- CreateIndex
CREATE INDEX "fiscal_operation_profiles_tenant_id_idx" ON "fiscal_operation_profiles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_operation_profiles_tenant_id_operation_key" ON "fiscal_operation_profiles"("tenant_id", "operation");

-- CreateIndex
CREATE INDEX "vehicle_fiscal_details_tenant_id_idx" ON "vehicle_fiscal_details"("tenant_id");

-- AddForeignKey
ALTER TABLE "fiscal_settings" ADD CONSTRAINT "fiscal_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_operation_profiles" ADD CONSTRAINT "fiscal_operation_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_fiscal_details" ADD CONSTRAINT "vehicle_fiscal_details_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_fiscal_details" ADD CONSTRAINT "vehicle_fiscal_details_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────
-- Formato
-- ─────────────────────────────────────────────────────────
ALTER TABLE "fiscal_settings"
  ADD CONSTRAINT "fiscal_settings_serie_valida"
    CHECK ("serie" BETWEEN 0 AND 889),
  ADD CONSTRAINT "fiscal_settings_confirmacao_inteira"
    CHECK (
      ("contador_confirmou_em" IS NULL AND "contador_confirmou_por" IS NULL AND "contador_nome" IS NULL)
      OR ("contador_confirmou_em" IS NOT NULL AND "contador_confirmou_por" IS NOT NULL AND "contador_nome" IS NOT NULL)
    );

ALTER TABLE "fiscal_operation_profiles"
  ADD CONSTRAINT "fiscal_operation_profiles_cfops"
    CHECK ("cfop_interno" ~ '^\d{4}$' AND "cfop_interestadual" ~ '^\d{4}$'),
  ADD CONSTRAINT "fiscal_operation_profiles_situacao_tributaria"
    CHECK ("situacao_tributaria" IS NULL OR "situacao_tributaria" ~ '^\d{2,3}$');

ALTER TABLE "vehicle_fiscal_details"
  ADD CONSTRAINT "vehicle_fiscal_details_formato"
    CHECK (
      ("ncm" IS NULL OR "ncm" ~ '^\d{8}$')
      AND ("renavam" IS NULL OR "renavam" ~ '^\d{11}$')
      AND "origem" BETWEEN 0 AND 8
    );

-- ─────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY['fiscal_settings', 'fiscal_operation_profiles', 'vehicle_fiscal_details'];
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
