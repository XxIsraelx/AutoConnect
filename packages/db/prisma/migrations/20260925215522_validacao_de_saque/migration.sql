-- CreateTable
CREATE TABLE "withdrawal_authorizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL DEFAULT 'asaas',
    "operation_type" TEXT NOT NULL,
    "amount_mode" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_by_email" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL DEFAULT 'asaas',
    "operation_type" TEXT NOT NULL,
    "operation_key" TEXT NOT NULL,
    "amount" DECIMAL(14,2),
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "authorization_id" UUID,
    "token_ok" BOOLEAN NOT NULL DEFAULT false,
    "raw_body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "withdrawal_authorizations_provider_operation_type_expires_a_idx" ON "withdrawal_authorizations"("provider", "operation_type", "expires_at");

-- CreateIndex
CREATE INDEX "withdrawal_decisions_created_at_idx" ON "withdrawal_decisions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_decisions_provider_operation_type_operation_key_key" ON "withdrawal_decisions"("provider", "operation_type", "operation_key");

-- AddForeignKey
ALTER TABLE "withdrawal_decisions" ADD CONSTRAINT "withdrawal_decisions_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "withdrawal_authorizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────
-- RLS: estas duas tabelas não são de loja nenhuma
-- ─────────────────────────────────────────────────────────
-- Todas as demais tabelas isolam por `tenant_id` (ou por `app.user_id`, no caso
-- do consumidor final). Estas não têm nem um nem outro **de propósito**: o que
-- elas guardam é o dinheiro da plataforma saindo da conta do gateway e quem
-- autorizou cada saída. Não existe concessionária a que restringir.
--
-- Então a policy é a negação explícita: o papel da aplicação
-- (`autoconnect_app`) não lê nem escreve nada aqui. Quem alcança é só a
-- conexão dona das tabelas — a `DIRECT_URL` do `PrivilegedPrismaService`, que
-- é por onde o webhook e o painel do super admin passam.
--
-- RLS ligado **e** com policy, e não RLS ligado sem nenhuma: as duas negam
-- igual no Postgres, mas `rls-policies.e2e-spec.ts` trata tabela com RLS e
-- zero policy como esquecimento — e está certo. A negação aqui é escolha, e
-- escolha tem nome.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY['withdrawal_authorizations', 'withdrawal_decisions'];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY apenas_a_plataforma ON %I
        USING      (false)
        WITH CHECK (false)
    $f$, t);
  END LOOP;
END $$;
