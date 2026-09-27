-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'portal';

-- CreateTable
CREATE TABLE "portal_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "portal" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "last_received_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "portal_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "portal" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "lead_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "raw_body" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "portal_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_connections_token_hash_key" ON "portal_connections"("token_hash");

-- CreateIndex
CREATE INDEX "portal_connections_tenant_id_idx" ON "portal_connections"("tenant_id");

-- CreateIndex
CREATE INDEX "portal_deliveries_tenant_id_received_at_idx" ON "portal_deliveries"("tenant_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "portal_deliveries_connection_id_event_key_key" ON "portal_deliveries"("connection_id", "event_key");

-- AddForeignKey
ALTER TABLE "portal_connections" ADD CONSTRAINT "portal_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_deliveries" ADD CONSTRAINT "portal_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_deliveries" ADD CONSTRAINT "portal_deliveries_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "portal_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────
-- Regras que o Prisma não sabe declarar
-- ─────────────────────────────────────────────────────────
-- Uma conexão ativa por loja e portal: dois endereços vivos para a mesma OLX
-- fariam o dono encaminhar para um e procurar no outro.
CREATE UNIQUE INDEX "portal_connections_uma_ativa_idx"
  ON "portal_connections" ("tenant_id", "portal")
  WHERE active;

-- As listas do @autoconnect/shared (`CHAVES_DE_PORTAL` e
-- `SITUACOES_DE_ENTREGA_DE_PORTAL`) — mudou lá, muda aqui.
ALTER TABLE "portal_connections" ADD CONSTRAINT "portal_connections_portal_valido" CHECK (
  portal IN ('olx', 'webmotors', 'icarros', 'mercadolivre', 'outro')
);
ALTER TABLE "portal_deliveries" ADD CONSTRAINT "portal_deliveries_status_valido" CHECK (
  status IN ('aplicado', 'duplicado', 'nao_entendido', 'ignorado')
);
ALTER TABLE "portal_deliveries" ADD CONSTRAINT "portal_deliveries_transporte_valido" CHECK (
  transport IN ('webhook', 'email')
);

-- ─────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────
-- O endereço de entrada e as entregas cruas (nome, telefone e mensagem de
-- quem se interessou) são da loja. O único acesso sem contexto é achar a
-- conexão pelo hash do token, na chegada — pela conexão privilegiada, como o
-- link do visitante.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY['portal_connections', 'portal_deliveries'];
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
