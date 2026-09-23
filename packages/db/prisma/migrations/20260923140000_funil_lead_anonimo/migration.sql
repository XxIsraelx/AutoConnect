-- Onda 0 — "o funil não pode vazar".
--
-- Três mudanças, todas aditivas:
--   1. consentimento LGPD no lead (o formulário público passa a existir);
--   2. telefone normalizado + índices, que é o que sustenta a deduplicação;
--   3. agendamento para cliente sem conta.
--
-- Nenhuma tabela nova: nenhuma policy nova é necessária. As colunas entram em
-- `leads` e `appointments`, que já têm `tenant_isolation`.

-- ─────────────────────────────────────────────────────────
-- 1. Consentimento LGPD
-- ─────────────────────────────────────────────────────────
-- `consent_text` guarda a CÓPIA do texto exibido no aceite, e não uma
-- referência a uma versão. O termo muda com o tempo; a prova tem que ser do
-- termo que a pessoa leu.
ALTER TABLE leads
  ADD COLUMN consented_at timestamptz,
  ADD COLUMN consent_text text;

-- ─────────────────────────────────────────────────────────
-- 2. Telefone normalizado — a chave da deduplicação
-- ─────────────────────────────────────────────────────────
-- Forma canônica: DDD + número, sem DDI e sem pontuação, com o nono dígito
-- sempre presente no celular. É `normalizarTelefoneBr` (packages/shared) quem
-- a produz para as linhas novas; o UPDATE abaixo repete as mesmas regras em
-- SQL, uma vez, para as linhas que já existem.
ALTER TABLE leads ADD COLUMN contact_phone_normalized text;

UPDATE leads
SET contact_phone_normalized = candidato.normalizado
FROM (
  SELECT id,
         CASE
           -- 11 dígitos: só é celular se o nono dígito for mesmo 9.
           WHEN length(base) = 11 AND substring(base from 3 for 1) = '9' THEN base
           -- 10 dígitos começando por 6..9: celular de antes do nono dígito.
           WHEN length(base) = 10 AND substring(base from 3 for 1) IN ('6','7','8','9')
             THEN substring(base from 1 for 2) || '9' || substring(base from 3)
           -- 10 dígitos começando por 2..5: telefone fixo.
           WHEN length(base) = 10 AND substring(base from 3 for 1) IN ('2','3','4','5') THEN base
           ELSE NULL
         END AS normalizado
  FROM (
    SELECT id,
           CASE
             -- DDI só sai quando sobra um número de tamanho plausível, senão
             -- `55` de DDD (Rio Grande do Sul) viraria DDI.
             WHEN digitos LIKE '55%' AND length(digitos) IN (12, 13) THEN substring(digitos from 3)
             ELSE digitos
           END AS base
    FROM (
      SELECT id, regexp_replace(coalesce(contact_phone, ''), '[^0-9]', '', 'g') AS digitos
      FROM leads
    ) t1
  ) t2
  WHERE substring(base from 1 for 2) BETWEEN '11' AND '99'
) candidato
WHERE leads.id = candidato.id AND candidato.normalizado IS NOT NULL;

-- A busca da deduplicação é sempre "dentro desta loja, com este contato".
-- Sem o `tenant_id` na frente, o índice não serve a uma consulta que o RLS já
-- restringe por tenant.
CREATE INDEX leads_tenant_telefone_idx ON leads (tenant_id, contact_phone_normalized);
CREATE INDEX leads_tenant_email_idx    ON leads (tenant_id, contact_email);

-- ─────────────────────────────────────────────────────────
-- 3. Agendamento para quem não tem conta
-- ─────────────────────────────────────────────────────────
-- Antes, `customer_user_id` era NOT NULL e a rota usava `req.user.id`: o
-- vendedor não conseguia marcar um test drive para quem ligou. Agora o
-- agendamento se identifica por um de três caminhos, e a constraint garante
-- que pelo menos um existe — um agendamento anônimo não diz nem quem esperar.
ALTER TABLE appointments
  ALTER COLUMN customer_user_id DROP NOT NULL,
  ADD COLUMN contact_name  text,
  ADD COLUMN contact_phone text,
  ADD COLUMN contact_email citext;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_tem_contato CHECK (
    customer_user_id IS NOT NULL
    OR lead_id IS NOT NULL
    OR (contact_name IS NOT NULL AND contact_phone IS NOT NULL)
  );
