-- Acesso do consumidor final a tabelas que pertencem a concessionárias.
--
-- LACUNA QUE ISTO FECHA
-- A migration anterior isolou `appointments`, `conversations` e `messages` por
-- tenant. Mas o cliente final atravessa concessionárias por natureza: ele
-- agenda test drive na loja A e conversa com a loja B, e a área /perfil lista
-- as duas coisas juntas. Com apenas a policy de tenant, essas telas ficariam
-- vazias no dia em que a aplicação passasse a conectar como `autoconnect_app`.
--
-- Policies permissivas somam (OR): estas convivem com `tenant_isolation` sem
-- afrouxá-la. A concessionária continua vendo o que é dela; o cliente passa a
-- ver o que é dele, e nada além.
--
-- O critério é sempre uma coluna de posse (`customer_user_id`), comparada com
-- `app.user_id` — a mesma variável que `PrismaService.withUser` define.

-- Agendamentos do próprio cliente: ele lista, solicita e cancela.
CREATE POLICY acesso_cliente ON appointments
  USING      (customer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (customer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- Conversas do próprio cliente: ele lista e inicia o contato.
CREATE POLICY acesso_cliente ON conversations
  USING      (customer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (customer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- Veículos que o cliente visitou: a lista "vistos recentemente" do /perfil
-- atravessa lojas, embora a linha pertença à concessionária do veículo.
CREATE POLICY acesso_cliente ON vehicle_views
  USING      (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- Mensagens: a posse não está na linha, está na conversa. O cliente precisa
-- ler as mensagens do vendedor também, então o critério não pode ser
-- `sender_user_id` — seria só o que ele mesmo escreveu.
CREATE POLICY acesso_cliente ON messages
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND c.customer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND c.customer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );
