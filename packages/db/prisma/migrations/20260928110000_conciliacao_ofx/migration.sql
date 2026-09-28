-- Financeiro — Fase 5: conciliação bancária por OFX.
--
-- Plano: docs/planos/plano-financeiro.md
--
-- `(account_id, fitid)` único é o coração desta tabela: `fitid` é o id que o
-- banco dá à transação, e é ele que faz **reimportar o mesmo extrato não
-- duplicar nada** — o caso comum não é o arquivo repetido, é o arquivo seguinte
-- que se sobrepõe ao anterior em alguns dias. Mesmo desenho de idempotência dos
-- webhooks, pela mesma razão: o segundo arquivo sempre vem.
--
-- `entry_id` é único porque um lançamento se concilia com **uma** linha do
-- extrato: sem isso, o mesmo dinheiro poderia ser baixado duas vezes por duas
-- transações diferentes.

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "fitid" TEXT NOT NULL,
    "posted_at" TIMESTAMPTZ NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "direction" "FinancialDirection" NOT NULL,
    "memo" TEXT,
    "entry_id" UUID,
    "ignored_at" TIMESTAMPTZ,
    "imported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_entry_id_key" ON "bank_transactions"("entry_id");

-- CreateIndex
CREATE INDEX "bank_transactions_tenant_id_posted_at_idx" ON "bank_transactions"("tenant_id", "posted_at");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_account_id_fitid_key" ON "bank_transactions"("account_id", "fitid");

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "financial_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "bank_transactions"
  ADD CONSTRAINT bank_transactions_valor_positivo CHECK (amount > 0);

-- RLS: extrato bancário é o dado mais sensível que a loja guarda aqui.
ALTER TABLE "bank_transactions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_transactions"
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
