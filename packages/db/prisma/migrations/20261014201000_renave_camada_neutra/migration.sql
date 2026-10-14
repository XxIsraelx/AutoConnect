-- RENAVE — camada neutra e simulado (trilha R do plano fiscal, R2).
--
-- Plano:   docs/planos/plano-fiscal-renave-nfe.md
-- Decisão: docs/decisoes/2026-10-14 renave dados do crv e credencial.md
--
-- O que este arquivo acrescenta ao registro manual da R1:
--
--  * a identidade do registro na integradora (`provider` + `external_id`),
--    única — é por ela que o webhook acha a linha;
--  * `sequencia`: a n-ésima vez que o carro passa pela operação. Com veículo e
--    tipo, é única e é a chave de idempotência enviada à integradora;
--  * `renave_eventos`: cada entrega de webhook, crua, idempotente por
--    `(registro_id, event_key)`;
--  * o trigger da R1 passa a trancar também a identidade na integradora.
--
-- O código de segurança do CRV **não tem coluna**, de propósito.

-- AlterTable
ALTER TABLE "renave_registros" ADD COLUMN     "atpv_key" TEXT,
ADD COLUMN     "enviado_em" TIMESTAMPTZ,
ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "sequencia" INTEGER;

-- Registros manuais que já existam (R1 em produção antes desta migration)
-- ganham a sequência pela ordem de criação.
UPDATE "renave_registros" r SET "sequencia" = s.n
  FROM (
    SELECT id, row_number() OVER (PARTITION BY vehicle_id, tipo ORDER BY created_at, id) AS n
      FROM "renave_registros"
  ) s
 WHERE s.id = r.id;

ALTER TABLE "renave_registros" ALTER COLUMN "sequencia" SET NOT NULL;

ALTER TABLE "renave_registros"
  ADD CONSTRAINT renave_sequencia_positiva CHECK (sequencia > 0);

-- Os dois andam juntos: registro da integradora tem as duas coisas, manual não
-- tem nenhuma — `provider` sem `external_id` é envio que falhou antes de a
-- integradora responder, e esse é legítimo (o reenvio usa a mesma chave).
ALTER TABLE "renave_registros"
  ADD CONSTRAINT renave_id_externo_tem_provedor CHECK (
    external_id IS NULL OR provider IS NOT NULL
  );

-- CreateTable
CREATE TABLE "renave_eventos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registro_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "aplicado" BOOLEAN NOT NULL DEFAULT false,
    "normalizado" JSONB NOT NULL,
    "corpo_cru" TEXT NOT NULL,
    "recebido_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "renave_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "renave_eventos_tenant_id_idx" ON "renave_eventos"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "renave_eventos_registro_id_event_key_key" ON "renave_eventos"("registro_id", "event_key");

-- CreateIndex
CREATE UNIQUE INDEX "renave_registros_vehicle_id_tipo_sequencia_key" ON "renave_registros"("vehicle_id", "tipo", "sequencia");

-- CreateIndex
CREATE UNIQUE INDEX "renave_registros_provider_external_id_key" ON "renave_registros"("provider", "external_id");

-- AddForeignKey
ALTER TABLE "renave_eventos" ADD CONSTRAINT "renave_eventos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renave_eventos" ADD CONSTRAINT "renave_eventos_registro_id_fkey" FOREIGN KEY ("registro_id") REFERENCES "renave_registros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────
-- Confirmado é imutável — agora também na identidade da integradora
-- ─────────────────────────────────────────────────────────
-- Mesma regra da R1, com três colunas a mais: depois de confirmado, o
-- registro não troca de integradora, de id externo nem de sequência. O ATPV-e
-- (`atpv_key`) pode chegar depois, como a chave da NF-e.
CREATE OR REPLACE FUNCTION renave_confirmado_e_imutavel() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('recusado', 'cancelado') AND (
       NEW.status                 IS DISTINCT FROM OLD.status
    OR NEW.protocolo              IS DISTINCT FROM OLD.protocolo
    OR NEW.chave_nfe              IS DISTINCT FROM OLD.chave_nfe
    OR NEW.motivo_cancelamento    IS DISTINCT FROM OLD.motivo_cancelamento
    OR NEW.motivo_recusa          IS DISTINCT FROM OLD.motivo_recusa
    OR NEW.external_id            IS DISTINCT FROM OLD.external_id
  ) THEN
    RAISE EXCEPTION 'Registro RENAVE % está %: não muda mais.', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'confirmado' AND (
       NEW.status NOT IN ('confirmado', 'cancelado')
    OR NEW.tipo            IS DISTINCT FROM OLD.tipo
    OR NEW.vehicle_id      IS DISTINCT FROM OLD.vehicle_id
    OR NEW.deal_id         IS DISTINCT FROM OLD.deal_id
    OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
    OR NEW.origem          IS DISTINCT FROM OLD.origem
    OR NEW.protocolo       IS DISTINCT FROM OLD.protocolo
    OR NEW.registrado_em   IS DISTINCT FROM OLD.registrado_em
    OR NEW.data_operacao   IS DISTINCT FROM OLD.data_operacao
    OR NEW.valor           IS DISTINCT FROM OLD.valor
    OR NEW.snapshot::text  IS DISTINCT FROM OLD.snapshot::text
    OR NEW.payload::text   IS DISTINCT FROM OLD.payload::text
    OR NEW.provider        IS DISTINCT FROM OLD.provider
    OR NEW.external_id     IS DISTINCT FROM OLD.external_id
    OR NEW.sequencia       IS DISTINCT FROM OLD.sequencia
  ) THEN
    RAISE EXCEPTION 'Registro RENAVE % já foi confirmado: corrige-se pelo cancelamento, não pela edição.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────
-- Dado da concessionária. O webhook acha a loja pela conexão privilegiada (uma
-- leitura, por chave única) e grava aqui sob `withTenant` da loja dona.
ALTER TABLE "renave_eventos" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "renave_eventos"
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
