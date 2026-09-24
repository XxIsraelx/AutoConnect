-- Onda 1, itens 6 a 9: rodízio de leads, prazo de primeiro contato (SLA),
-- carteira do vendedor e motivo de perda.
--
-- Tudo aditivo: nenhuma coluna existente muda de tipo ou de nulidade, e
-- nenhuma linha é reescrita. Uma base em produção continua funcionando com o
-- comportamento de hoje até que a loja mexa na tela de configuração —
-- `vendedor_ve_todos_os_leads` nasce `true` exatamente por isso.

-- ─────────────────────────────────────────────────────────
-- 1. Ajustes de CRM e estado do rodízio
-- ─────────────────────────────────────────────────────────
-- Tabela própria, e não `tenants.settings`, porque esta linha é travada com
-- `SELECT … FOR UPDATE` a cada lead que chega: é o que impede dois leads
-- simultâneos de caírem no mesmo vendedor. Travar a linha de `tenants` a cada
-- lead prenderia o cadastro inteiro da loja atrás da fila de leads.
CREATE TABLE tenant_crm_settings (
  tenant_id                    uuid PRIMARY KEY,
  rodizio_ativo                boolean NOT NULL DEFAULT true,
  rodizio_inclui_gerentes      boolean NOT NULL DEFAULT false,
  sla_primeiro_contato_minutos integer NOT NULL DEFAULT 15,
  sla_devolve_para_fila        boolean NOT NULL DEFAULT false,
  vendedor_ve_todos_os_leads   boolean NOT NULL DEFAULT true,
  rodizio_ultimo_usuario_id    uuid,
  rodizio_atualizado_em        timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  -- Sem DEFAULT: quem mantém esta coluna é o `@updatedAt` do Prisma, e um
  -- default aqui seria drift entre o banco e o `schema.prisma` — o passo de
  -- drift do CI recusa a divergência.
  updated_at                   timestamptz NOT NULL,

  -- O prazo vem do Zod validado na rota; o CHECK é a segunda linha, para que
  -- um UPDATE direto no banco não produza um prazo de zero minuto (todo lead
  -- nasceria estourado) nem de um ano.
  CONSTRAINT tenant_crm_settings_sla_plausivel
    CHECK (sla_primeiro_contato_minutos BETWEEN 1 AND 1440)
);

-- `ON UPDATE CASCADE` porque é o que o Prisma declara por padrão em toda
-- relação; omiti-lo deixaria a chave estrangeira diferente do `schema.prisma`.
ALTER TABLE tenant_crm_settings
  ADD CONSTRAINT tenant_crm_settings_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- O ponteiro do rodízio aponta para um usuário que pode ser desligado da loja:
-- `SET NULL` faz o rodízio recomeçar do início em vez de travar numa linha
-- órfã.
ALTER TABLE tenant_crm_settings
  ADD CONSTRAINT tenant_crm_settings_rodizio_ultimo_usuario_id_fkey
  FOREIGN KEY (rodizio_ultimo_usuario_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Tabela nova com tenant_id: precisa da policy, senão `rls-policies.e2e-spec.ts`
-- quebra — e, o que importa mais, uma loja leria a configuração da outra.
ALTER TABLE tenant_crm_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_crm_settings
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ─────────────────────────────────────────────────────────
-- 2. Plantão do vendedor
-- ─────────────────────────────────────────────────────────
-- `is_accepting_leads` já existia (default true) e nenhuma tela a lia: quem
-- entra no rodízio hoje é, portanto, a equipe inteira, que é o padrão certo.
-- Falta só a pausa temporária, para que férias não dependam de alguém lembrar
-- de religar o interruptor na volta.
ALTER TABLE salesperson_profiles
  ADD COLUMN on_duty_paused_until timestamptz;

-- ─────────────────────────────────────────────────────────
-- 3. Prazo de primeiro contato
-- ─────────────────────────────────────────────────────────
-- Os leads que já existem ficam com prazo nulo, de propósito: calcular um
-- prazo retroativo encheria a tela de estouros de meses atrás no primeiro
-- login depois do deploy, e nenhum deles é acionável.
ALTER TABLE leads
  ADD COLUMN first_response_due_at timestamptz,
  ADD COLUMN first_responded_at    timestamptz,
  ADD COLUMN sla_breached_at       timestamptz;

-- O cron varre "quem estourou e ainda não foi avisado", global às lojas (roda
-- pela conexão privilegiada). Índice parcial: só interessa o lead que tem
-- prazo e ainda não respondeu, que é uma fração pequena da tabela.
CREATE INDEX leads_prazo_primeiro_contato_idx
  ON leads (first_response_due_at)
  WHERE first_response_due_at IS NOT NULL AND first_responded_at IS NULL;

-- ─────────────────────────────────────────────────────────
-- 4. Motivo de perda
-- ─────────────────────────────────────────────────────────
-- `lost_reason` já existia como texto livre e sem tela que o preenchesse —
-- ou seja, sem dado a migrar. Passa a ser o COMPLEMENTO, e o código
-- estruturado entra ao lado. Não vira enum do Postgres de propósito: motivo de
-- perda é justamente o campo que a loja quer ajustar depois da primeira semana
-- de uso, e cada ajuste custaria uma migration. Quem recusa valor fora da
-- lista é o Zod da rota (`domain/motivo-perda.ts`); o CHECK abaixo só impede
-- que a coluna guarde string vazia, que agruparia no relatório como um motivo
-- sem nome.
ALTER TABLE leads
  ADD COLUMN lost_reason_code text,
  ADD CONSTRAINT leads_motivo_perda_nao_vazio
    CHECK (lost_reason_code IS NULL OR length(btrim(lost_reason_code)) > 0);

CREATE INDEX leads_tenant_motivo_perda_idx ON leads (tenant_id, lost_reason_code);

-- O mesmo para o negócio: `cancel_reason` era texto livre e opcional.
ALTER TABLE deals
  ADD COLUMN cancel_reason_code text,
  ADD CONSTRAINT deals_motivo_cancelamento_nao_vazio
    CHECK (cancel_reason_code IS NULL OR length(btrim(cancel_reason_code)) > 0);
