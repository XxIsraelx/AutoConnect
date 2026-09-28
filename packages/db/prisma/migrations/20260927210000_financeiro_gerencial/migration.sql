-- Financeiro gerencial da loja — Fase 1 do plano.
--
-- Decisão: docs/decisoes/2026-09-27 modulo financeiro.md
-- Plano:   docs/planos/plano-financeiro.md
--
-- O que este arquivo garante além das tabelas:
--
--  * `value > 0` — o sinal do dinheiro está em `direction`, e valor negativo
--    para representar saída é uma soma que engana quem lê a lista.
--  * coerência de estado: `pago` exige data e conta; `previsto` não tem data de
--    pagamento; `cancelado` exige motivo. Sem isto, "pago sem conta" existiria e
--    o saldo por conta não fecharia com o total.
--  * mês fechado tranca o que vence dentro dele, por trigger — a regra também
--    está no shared (`podeAlterar`), e a do banco é a que não tem como escapar.
--  * RLS com `tenant_isolation` nas quatro tabelas: é dinheiro da loja, e o
--    vazamento aqui é o pior que este produto pode ter.

-- CreateEnum
CREATE TYPE "FinancialAccountKind" AS ENUM ('caixa', 'banco', 'adquirente', 'outro');

-- CreateEnum
CREATE TYPE "FinancialDirection" AS ENUM ('entrada', 'saida');

-- CreateEnum
CREATE TYPE "FinancialEntryStatus" AS ENUM ('previsto', 'pago', 'cancelado');

-- CreateEnum
CREATE TYPE "FinancialCategoryGroup" AS ENUM ('veiculos', 'operacao', 'pessoal', 'impostos', 'financeiro', 'outros');

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" "FinancialAccountKind" NOT NULL,
    "name" TEXT NOT NULL,
    "bank_name" TEXT,
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "direction" "FinancialDirection" NOT NULL,
    "group" "FinancialCategoryGroup" NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "financial_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "direction" "FinancialDirection" NOT NULL,
    "status" "FinancialEntryStatus" NOT NULL DEFAULT 'previsto',
    "value" DECIMAL(14,2) NOT NULL,
    "due_date" TIMESTAMPTZ NOT NULL,
    "paid_at" TIMESTAMPTZ,
    "description" TEXT NOT NULL,
    "supplier_name" TEXT,
    "document_number" TEXT,
    "notes" TEXT,
    "account_id" UUID,
    "category_id" UUID NOT NULL,
    "branch_id" UUID,
    "deal_id" UUID,
    "vehicle_id" UUID,
    "deal_payment_id" UUID,
    "recurrence_id" UUID,
    "canceled_at" TIMESTAMPTZ,
    "cancel_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "financial_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" SMALLINT NOT NULL,
    "closed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by" UUID,
    "reopened_at" TIMESTAMPTZ,
    "reopen_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_accounts_tenant_id_idx" ON "financial_accounts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_tenant_id_name_key" ON "financial_accounts"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "financial_categories_tenant_id_idx" ON "financial_categories"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_categories_tenant_id_direction_name_key" ON "financial_categories"("tenant_id", "direction", "name");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entries_deal_payment_id_key" ON "financial_entries"("deal_payment_id");

-- CreateIndex
CREATE INDEX "financial_entries_tenant_id_due_date_idx" ON "financial_entries"("tenant_id", "due_date");

-- CreateIndex
CREATE INDEX "financial_entries_tenant_id_status_due_date_idx" ON "financial_entries"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "financial_entries_tenant_id_account_id_status_idx" ON "financial_entries"("tenant_id", "account_id", "status");

-- CreateIndex
CREATE INDEX "financial_entries_tenant_id_category_id_idx" ON "financial_entries"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "financial_entries_recurrence_id_idx" ON "financial_entries"("recurrence_id");

-- CreateIndex
CREATE INDEX "financial_periods_tenant_id_idx" ON "financial_periods"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_periods_tenant_id_year_month_key" ON "financial_periods"("tenant_id", "year", "month");

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "financial_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "dealership_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_deal_payment_id_fkey" FOREIGN KEY ("deal_payment_id") REFERENCES "deal_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────
-- Coerência do lançamento
-- ─────────────────────────────────────────────────────────

ALTER TABLE "financial_entries"
  ADD CONSTRAINT financial_entries_valor_positivo CHECK ("value" > 0);

-- `pago` é fato consumado: tem data e tem de qual conta o dinheiro saiu ou
-- entrou. Sem a conta, o saldo por conta não fecharia com o total do caixa.
ALTER TABLE "financial_entries"
  ADD CONSTRAINT financial_entries_pago_tem_data_e_conta CHECK (
    status <> 'pago' OR (paid_at IS NOT NULL AND account_id IS NOT NULL)
  );

-- `previsto` é promessa: data de pagamento aqui seria contradição em coluna.
ALTER TABLE "financial_entries"
  ADD CONSTRAINT financial_entries_previsto_sem_pagamento CHECK (
    status <> 'previsto' OR paid_at IS NULL
  );

-- Cancelamento sem motivo só diz que alguém mexeu — a mesma regra do
-- cancelamento de negócio e do conserto de fatura no /admin.
ALTER TABLE "financial_entries"
  ADD CONSTRAINT financial_entries_cancelado_tem_motivo CHECK (
    status <> 'cancelado' OR (canceled_at IS NOT NULL AND cancel_reason IS NOT NULL)
  );

ALTER TABLE "financial_periods"
  ADD CONSTRAINT financial_periods_mes_valido CHECK (month BETWEEN 1 AND 12);

-- ─────────────────────────────────────────────────────────
-- Mês fechado é fechado
-- ─────────────────────────────────────────────────────────
--
-- A trava é pelo **vencimento**, não pela data de digitação: fechar março diz
-- "março está conferido", e um lançamento novo com vencimento em março mudaria
-- o resultado de um mês já dado como fechado. Reabrir é ação explícita do
-- gerente, com motivo, e some daqui ao limpar `financial_periods`.
CREATE OR REPLACE FUNCTION financeiro_mes_fechado() RETURNS TRIGGER AS $$
DECLARE
  alvo date := COALESCE(NEW.due_date, OLD.due_date);
  fechado boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM financial_periods p
     WHERE p.tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
       AND p.year  = EXTRACT(YEAR  FROM alvo)::int
       AND p.month = EXTRACT(MONTH FROM alvo)::int
       AND p.reopened_at IS NULL
  ) INTO fechado;

  IF fechado THEN
    RAISE EXCEPTION 'O mês %/% está fechado: reabra para mexer em lançamento com vencimento nele.',
      LPAD(EXTRACT(MONTH FROM alvo)::text, 2, '0'), EXTRACT(YEAR FROM alvo)::text
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- `DELETE` entra na trava junto com `INSERT` e `UPDATE`, de propósito: mês
-- conferido não muda, e apagar uma linha dele muda. Manutenção legítima passa
-- por reabrir o mês — que é ação explícita, com motivo e auditoria.
CREATE TRIGGER financial_entries_mes_fechado
  BEFORE INSERT OR UPDATE OR DELETE ON "financial_entries"
  FOR EACH ROW EXECUTE FUNCTION financeiro_mes_fechado();

-- ─────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────
-- Quatro tabelas, todas com `tenant_id`, todas da concessionária. Nenhuma tem
-- acesso público nem caminho privilegiado: nem o webhook nem o catálogo passam
-- por aqui.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'financial_accounts', 'financial_categories', 'financial_entries', 'financial_periods'
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
