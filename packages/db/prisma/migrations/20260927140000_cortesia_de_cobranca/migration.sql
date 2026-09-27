-- Cortesia de cobrança: loja isenta, concedida pelo super admin.
--
-- Decisão de 27/09/2026 (`docs/decisoes/2026-09-27 plano de precos.md`): as 5
-- lojas fundadoras não pagam nunca, e a loja interna da AutoConnect (a que
-- recebe os pedidos de Raio-X) também não. Até aqui a única saída era o super
-- admin estender o trial à mão, e a fundadora que ninguém lembrasse de
-- estender caía em somente leitura.
--
-- `avaliarCobranca` (shared) decide por `courtesy_since` antes de todo o
-- resto. `courtesy_granted_by` é o usuário que concedeu, sem FK: o log de
-- auditoria é o histórico, e apagar um super admin não pode apagar a cortesia.
--
-- Nenhuma tabela nova, nenhuma policy nova: as colunas entram em
-- `tenant_subscriptions`, que já tem `tenant_isolation`.

ALTER TABLE "tenant_subscriptions"
  ADD COLUMN "courtesy_since" TIMESTAMPTZ,
  ADD COLUMN "courtesy_reason" TEXT,
  ADD COLUMN "courtesy_granted_by" UUID;
