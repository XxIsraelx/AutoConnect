-- RENAVE — registro manual e pendências (trilha R do plano fiscal, R1).
--
-- Plano:  docs/planos/plano-fiscal-renave-nfe.md
-- Manual: renave.estaleiro.serpro.gov.br/renave-ws/manual/ (lido em 14/10/2026)
--
-- O AutoConnect não fala com o RENAVE; a integradora da loja fala. Esta tabela
-- é o espelho do que ela registrou, e o que este arquivo garante além dela:
--
--  * coerência de estado: confirmado tem protocolo, recusado tem motivo,
--    cancelado tem data e motivo — e nada disso depende de o service lembrar;
--  * a saída por venda aponta para o negócio, e só ela aponta;
--  * um negócio, uma saída viva (índice único parcial);
--  * confirmado é imutável por trigger, menos a chave da NF-e, que o manual
--    deixa trocar depois de informada;
--  * RLS com `tenant_isolation`, como toda tabela da concessionária.

-- CreateEnum
CREATE TYPE "RenaveOperacao" AS ENUM ('entrada_compra', 'entrada_transferencia', 'entrada_consignacao', 'saida_venda', 'saida_transferencia', 'devolucao_consignado');

-- CreateEnum
CREATE TYPE "RenaveStatus" AS ENUM ('pendente', 'confirmado', 'recusado', 'cancelado');

-- CreateEnum
CREATE TYPE "RenaveOrigem" AS ENUM ('manual', 'integradora');

-- CreateTable
CREATE TABLE "renave_registros" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "deal_id" UUID,
    "tipo" "RenaveOperacao" NOT NULL,
    "status" "RenaveStatus" NOT NULL DEFAULT 'pendente',
    "origem" "RenaveOrigem" NOT NULL DEFAULT 'manual',
    "protocolo" TEXT,
    "registrado_em" TIMESTAMPTZ,
    "data_operacao" TIMESTAMPTZ NOT NULL,
    "chave_nfe" TEXT,
    "valor" DECIMAL(14,2),
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "payload" JSONB,
    "observacao" TEXT,
    "motivo_recusa" TEXT,
    "cancelado_em" TIMESTAMPTZ,
    "motivo_cancelamento" TEXT,
    "protocolo_cancelamento" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "renave_registros_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "renave_registros_tenant_id_status_idx" ON "renave_registros"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "renave_registros_vehicle_id_idx" ON "renave_registros"("vehicle_id");

-- CreateIndex
CREATE INDEX "renave_registros_deal_id_idx" ON "renave_registros"("deal_id");

-- AddForeignKey
ALTER TABLE "renave_registros" ADD CONSTRAINT "renave_registros_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renave_registros" ADD CONSTRAINT "renave_registros_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renave_registros" ADD CONSTRAINT "renave_registros_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────
-- Coerência do registro
-- ─────────────────────────────────────────────────────────

-- Confirmado sem protocolo é a loja dizendo "está registrado" sem a prova —
-- e a prova é a única coisa que este espelho existe para guardar.
ALTER TABLE "renave_registros"
  ADD CONSTRAINT renave_confirmado_tem_protocolo CHECK (
    status <> 'confirmado' OR (protocolo IS NOT NULL AND btrim(protocolo) <> '')
  );

ALTER TABLE "renave_registros"
  ADD CONSTRAINT renave_recusado_tem_motivo CHECK (
    status <> 'recusado' OR (motivo_recusa IS NOT NULL AND btrim(motivo_recusa) <> '')
  );

-- Mesma regra do cancelamento de negócio e de lançamento: sem motivo, a linha
-- só diz que alguém mexeu.
ALTER TABLE "renave_registros"
  ADD CONSTRAINT renave_cancelado_tem_data_e_motivo CHECK (
    status <> 'cancelado' OR (cancelado_em IS NOT NULL AND motivo_cancelamento IS NOT NULL
                              AND btrim(motivo_cancelamento) <> '')
  );

-- A saída por venda nasce de um negócio, e só ela: entrada e transferência
-- apontando para negócio seria um vínculo que ninguém sabe ler.
ALTER TABLE "renave_registros"
  ADD CONSTRAINT renave_saida_por_venda_tem_negocio CHECK (
    (tipo = 'saida_venda') = (deal_id IS NOT NULL)
  );

-- `valorCompra` e `valorVenda` são obrigatórios no manual; transferência e
-- devolução de consignado não têm valor.
ALTER TABLE "renave_registros"
  ADD CONSTRAINT renave_valor_quando_o_renave_pede CHECK (
    (tipo NOT IN ('entrada_compra', 'saida_venda') OR valor IS NOT NULL)
    AND (valor IS NULL OR valor > 0)
  );

-- Só o formato; o dígito verificador é conferido por `lerChaveNfe` (shared),
-- que também lê o CNPJ alfanumérico — uma regex numérica aqui o recusaria.
ALTER TABLE "renave_registros"
  ADD CONSTRAINT renave_chave_nfe_formato CHECK (
    chave_nfe IS NULL OR chave_nfe ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$'
  );

-- Um negócio, uma saída viva. Cancelada ou recusada libera: é assim que um
-- distrato seguido de nova venda volta a registrar.
CREATE UNIQUE INDEX "renave_registros_saida_viva_por_negocio"
  ON "renave_registros"("deal_id")
  WHERE tipo = 'saida_venda' AND status IN ('pendente', 'confirmado');

-- ─────────────────────────────────────────────────────────
-- Confirmado é imutável
-- ─────────────────────────────────────────────────────────
-- A regra também vive no service; aqui é a que não tem como escapar, como no
-- contrato emitido e no mês fechado.
--
--  * confirmado só sai para `cancelado` — o cancelamento de entrada ou de
--    saída que o manual do RENAVE prevê. A linha original fica.
--  * a chave da NF-e pode mudar: o manual permite trocar a chave informada, e
--    a NF-e é um passo posterior ao registro (entrada → NF de entrada; saída →
--    NF de saída).
--  * recusado e cancelado são finais.
CREATE OR REPLACE FUNCTION renave_confirmado_e_imutavel() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('recusado', 'cancelado') AND (
       NEW.status                 IS DISTINCT FROM OLD.status
    OR NEW.protocolo              IS DISTINCT FROM OLD.protocolo
    OR NEW.chave_nfe              IS DISTINCT FROM OLD.chave_nfe
    OR NEW.motivo_cancelamento    IS DISTINCT FROM OLD.motivo_cancelamento
    OR NEW.motivo_recusa          IS DISTINCT FROM OLD.motivo_recusa
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
  ) THEN
    RAISE EXCEPTION 'Registro RENAVE % já foi confirmado: corrige-se pelo cancelamento, não pela edição.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER renave_registros_imutavel
  BEFORE UPDATE ON "renave_registros"
  FOR EACH ROW EXECUTE FUNCTION renave_confirmado_e_imutavel();

-- ─────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────
-- Dado da concessionária, sem caminho público nem privilegiado: nem catálogo
-- nem webhook passam por aqui (o webhook da integradora é R2, e vai precisar
-- de decisão própria).
ALTER TABLE "renave_registros" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "renave_registros"
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
