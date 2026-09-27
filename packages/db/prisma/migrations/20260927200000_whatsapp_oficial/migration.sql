-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('chat', 'whatsapp');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "channel" "ConversationChannel" NOT NULL DEFAULT 'chat',
ADD COLUMN     "contact_phone_normalized" TEXT,
ADD COLUMN     "customer_last_message_at" TIMESTAMPTZ,
ADD COLUMN     "external_contact_id" TEXT,
ADD COLUMN     "whatsapp_account_id" UUID;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "delivery_status" TEXT,
ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "failure_reason" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "display_phone" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "connected_by" UUID,
    "connected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "normalized" JSONB NOT NULL,
    "raw_sha256" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_accounts_tenant_id_idx" ON "whatsapp_accounts"("tenant_id");

-- CreateIndex
CREATE INDEX "whatsapp_accounts_provider_external_id_idx" ON "whatsapp_accounts"("provider", "external_id");

-- CreateIndex
CREATE INDEX "whatsapp_webhook_events_tenant_id_received_at_idx" ON "whatsapp_webhook_events"("tenant_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_webhook_events_provider_event_key_key" ON "whatsapp_webhook_events"("provider", "event_key");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_external_id_key" ON "messages"("tenant_id", "external_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_whatsapp_account_id_fkey" FOREIGN KEY ("whatsapp_account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_webhook_events" ADD CONSTRAINT "whatsapp_webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────
-- Quem responde a conversa
-- ─────────────────────────────────────────────────────────
-- A conversa de WhatsApp não tem conta nem link de visitante: quem responde é
-- o número do cliente, pelo número da loja. Sem esta terceira forma, a
-- constraint recusaria toda conversa aberta pelo webhook.
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_tem_quem_responde";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tem_quem_responde" CHECK (
  customer_user_id IS NOT NULL
  OR (contact_name IS NOT NULL AND guest_token_hash IS NOT NULL)
  OR (channel = 'whatsapp' AND whatsapp_account_id IS NOT NULL AND contact_phone_normalized IS NOT NULL)
);

-- Os estados de `STATUS_DE_ENTREGA` no @autoconnect/shared — mudou lá, muda aqui.
ALTER TABLE "messages" ADD CONSTRAINT "messages_delivery_status_valido" CHECK (
  delivery_status IS NULL
  OR delivery_status IN ('enviando', 'enviada', 'entregue', 'lida', 'falhou')
);

-- ─────────────────────────────────────────────────────────
-- Unicidades que o Prisma não sabe declarar (índices parciais)
-- ─────────────────────────────────────────────────────────
-- Um número ativo pertence a uma loja só: o webhook acha a loja pelo id do
-- número, e dois donos mandariam a conversa de uma loja para a outra.
CREATE UNIQUE INDEX "whatsapp_accounts_numero_ativo_idx"
  ON "whatsapp_accounts" ("provider", "external_id")
  WHERE active;

-- Uma conta ativa por loja. É a regra de hoje, não do WhatsApp: número por
-- filial é possível e fica para quando uma loja pedir.
CREATE UNIQUE INDEX "whatsapp_accounts_uma_ativa_por_loja_idx"
  ON "whatsapp_accounts" ("tenant_id")
  WHERE active;

-- Uma conversa viva por número da loja e cliente. A checagem no serviço não
-- basta: duas entregas do mesmo cliente processadas ao mesmo tempo passariam
-- as duas pelo SELECT e abririam duas conversas.
CREATE UNIQUE INDEX "conversations_whatsapp_viva_idx"
  ON "conversations" ("whatsapp_account_id", "contact_phone_normalized")
  WHERE channel = 'whatsapp' AND status <> 'closed';

-- ─────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────
-- O número da loja e os eventos do webhook (com o texto das mensagens) são
-- dados da concessionária. O único acesso sem contexto é o do webhook achando
-- a loja pelo id do número, pela conexão privilegiada — o mesmo desenho do
-- webhook de assinatura.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY['whatsapp_accounts', 'whatsapp_webhook_events'];
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
