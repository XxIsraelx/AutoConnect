-- Acesso a usuários que não pertencem a nenhuma concessionária.
--
-- LACUNA QUE ISTO FECHA
-- O cadastro de cliente final grava `users.tenant_id = NULL` — o consumidor não
-- é de uma loja, ele circula por várias. Com apenas `tenant_isolation`, a
-- comparação `NULL = app.tenant_id` dá NULL, tratado como falso: **todo cliente
-- ficaria invisível para todo mundo**, inclusive para ele mesmo.
--
-- Isso quebraria o nome do cliente no lead, no agendamento e na conversa, e a
-- própria área /perfil.
--
-- POR QUE NÃO É UMA POLICY PERMISSIVA SIMPLES
-- Liberar `tenant_id IS NULL` resolveria em uma linha — e deixaria qualquer
-- concessionária enumerar a base de clientes inteira da plataforma, com e-mail
-- e telefone. É exatamente o vazamento que esta fase existe para impedir.
-- O critério aqui é relacionamento: a loja enxerga o cliente que tem lead,
-- agendamento ou conversa com ela. Nada além.

-- O usuário sempre enxerga a si mesmo — /perfil, troca de senha, avatar.
CREATE POLICY acesso_proprio ON users
  USING      (id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- A concessionária enxerga o cliente que se relacionou com ela.
-- Só leitura: quem edita o cadastro do cliente é o próprio cliente.
CREATE POLICY cliente_relacionado ON users
  FOR SELECT USING (
    users.tenant_id IS NULL
    AND NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM leads l
        WHERE l.customer_user_id = users.id
          AND l.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      )
      OR EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.customer_user_id = users.id
          AND a.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      )
      OR EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.customer_user_id = users.id
          AND c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      )
    )
  );

-- As três subconsultas filtram por (tenant_id, customer_user_id). Sem índice
-- nessa ordem, a policy vira varredura em cada leitura de usuário.
CREATE INDEX IF NOT EXISTS leads_tenant_customer_idx
  ON leads (tenant_id, customer_user_id);
CREATE INDEX IF NOT EXISTS appointments_tenant_customer_idx
  ON appointments (tenant_id, customer_user_id);
CREATE INDEX IF NOT EXISTS conversations_tenant_customer_idx
  ON conversations (tenant_id, customer_user_id);
