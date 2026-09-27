-- Plano contratado e ainda não pago.
--
-- `contratar` gravava o plano novo em `plan` **antes de qualquer pagamento**, e
-- `avaliarCobranca` lê "plano pago + status active" como loja em dia. Bastava
-- contratar e nunca pagar para ficar com o plano — e com o teto de estoque dele
-- — para sempre. Agora a contratação grava a intenção aqui, e só o
-- `pagamento_confirmado` do webhook a promove para `plan`.
--
-- Nenhuma policy nova: as colunas entram numa tabela que já tem
-- `tenant_isolation` e é alcançada só com `app.tenant_id` no contexto.

-- AlterTable
ALTER TABLE "tenant_subscriptions" ADD COLUMN     "pending_plan" "SubscriptionPlan",
ADD COLUMN     "pending_since" TIMESTAMPTZ;

-- `trial` não é algo que se contrate: ele é o estado de quem ainda não
-- escolheu. Deixar o enum inteiro aqui abriria a porta para um
-- `pending_plan = 'trial'` que o pagamento promoveria a plano efetivo `trial` —
-- uma loja pagante rebaixada por um valor que ninguém pretendeu gravar.
ALTER TABLE "tenant_subscriptions"
  ADD CONSTRAINT "tenant_subscriptions_pending_plan_pago"
  CHECK ("pending_plan" IS NULL OR "pending_plan" <> 'trial');

-- Nenhuma loja tinha plano pendente antes desta migration; o defeito gravava
-- direto em `plan`. Consertar as lojas que já contrataram sem pagar é ação de
-- super admin em `/admin › Concessionárias` (cancelar a assinatura e voltar ao
-- trial), e não um UPDATE cego aqui: não há como uma migration distinguir quem
-- contratou e nunca pagou de quem o super admin liberou à mão.
