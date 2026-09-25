-- ─────────────────────────────────────────────────────────
-- Os planos passam a ter os nomes da tabela de preços
-- ─────────────────────────────────────────────────────────
-- Eram `starter`/`pro`/`enterprise`, herdados de um desenho de cobrança que
-- nunca existiu. A partir da Onda 3 o que está no banco é o que está na
-- tabela de preços (`CATALOGO_DE_PLANOS`, no @autoconnect/shared) — um
-- `plan = 'enterprise'` que na tela se chama "Pro" seria mais uma tradução
-- para alguém errar.
--
-- O `USING` que o Prisma gera é `plan::text::novo_tipo`, que **estoura** em
-- qualquer linha com o valor antigo. Trocado por um CASE explícito: as faixas
-- mapeiam uma a uma pelo lugar que ocupavam (menor → maior), e o que não for
-- reconhecido cai em `trial`, que é o estado que não cobra ninguém por
-- engano.
BEGIN;
CREATE TYPE "SubscriptionPlan_new" AS ENUM ('trial', 'essencial', 'crescimento', 'profissional');
ALTER TABLE "tenant_subscriptions" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "tenant_subscriptions" ALTER COLUMN "plan" TYPE "SubscriptionPlan_new" USING (
  CASE "plan"::text
    WHEN 'starter'    THEN 'essencial'
    WHEN 'pro'        THEN 'crescimento'
    WHEN 'enterprise' THEN 'profissional'
    WHEN 'trial'      THEN 'trial'
    ELSE 'trial'
  END
)::"SubscriptionPlan_new";
ALTER TYPE "SubscriptionPlan" RENAME TO "SubscriptionPlan_old";
ALTER TYPE "SubscriptionPlan_new" RENAME TO "SubscriptionPlan";
DROP TYPE "SubscriptionPlan_old";
ALTER TABLE "tenant_subscriptions" ALTER COLUMN "plan" SET DEFAULT 'trial';
COMMIT;

-- AlterTable
ALTER TABLE "tenant_subscriptions" ADD COLUMN     "canceled_at" TIMESTAMPTZ,
ADD COLUMN     "external_customer_id" TEXT,
ADD COLUMN     "grace_until" TIMESTAMPTZ,
ADD COLUMN     "last_notice_at" TIMESTAMPTZ,
ADD COLUMN     "payment_method" TEXT;

-- CreateTable
CREATE TABLE "tenant_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_method" TEXT,
    "due_date" TIMESTAMPTZ NOT NULL,
    "paid_at" TIMESTAMPTZ,
    "payment_url" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "normalized" JSONB NOT NULL,
    "raw_body" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_invoices_tenant_id_due_date_idx" ON "tenant_invoices"("tenant_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_invoices_provider_external_id_key" ON "tenant_invoices"("provider", "external_id");

-- CreateIndex
CREATE INDEX "billing_webhook_events_tenant_id_received_at_idx" ON "billing_webhook_events"("tenant_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_webhook_events_provider_event_key_key" ON "billing_webhook_events"("provider", "event_key");

-- AddForeignKey
ALTER TABLE "tenant_invoices" ADD CONSTRAINT "tenant_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invoices" ADD CONSTRAINT "tenant_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "tenant_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_webhook_events" ADD CONSTRAINT "billing_webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────
-- Mesmo padrão das demais tabelas com `tenant_id`. O que estas duas guardam:
-- quanto cada loja paga, se está inadimplente e os webhooks crus do gateway.
-- Uma loja lendo a fatura da outra é preço e inadimplência de concorrente à
-- mostra — e o corpo cru do webhook carrega ids e valores do gateway.
--
-- Sem isto, `rls-policies.e2e-spec.ts` quebra: toda tabela com `tenant_id`
-- precisa de policy criada na própria migration.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY['tenant_invoices', 'billing_webhook_events'];
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
