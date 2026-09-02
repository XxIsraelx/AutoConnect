-- Isolamento real por tenant via Row Level Security.
--
-- CONTEXTO
-- Até aqui o RLS estava ligado à mão no painel do Supabase, sem nenhuma policy,
-- e nenhuma das migrations o criava: um banco novo (CI, staging, máquina nova)
-- nascia sem isolamento algum. Esta migration passa a criá-lo junto do schema.
--
-- POR QUE NÃO QUEBRA NADA HOJE
-- O dono das tabelas ignora RLS, e a aplicação conecta como dono. Habilitar RLS
-- e criar policies é, portanto, inerte para a aplicação atual — de propósito.
-- O RLS só passa a valer quando a DATABASE_URL apontar para `autoconnect_app`,
-- o que acontece depois que todos os services usarem `withTenant`.
--
-- NÃO usamos FORCE ROW LEVEL SECURITY: com ele o próprio dono passaria a ser
-- filtrado, e migrations, seed e a aplicação atual parariam de enxergar dados.
--
-- COMO É SEGURO POR PADRÃO
-- `current_setting('app.tenant_id', true)` devolve NULL quando a variável não
-- foi definida (em vez de lançar erro). `tenant_id = NULL` resulta em NULL, que
-- a policy trata como falso. Esquecer de setar o tenant não abre tudo: fecha
-- tudo. O NULLIF trata o caso em que a variável foi resetada para string vazia,
-- que sem ele estouraria no cast para uuid.

-- ─────────────────────────────────────────────────────────
-- 1. Papel da aplicação
-- ─────────────────────────────────────────────────────────
-- Sem BYPASSRLS e sem posse de tabela — é isso que faz o RLS valer.
-- A senha NÃO é definida aqui: segredo não entra em arquivo versionado.
-- Defina fora da migration, com  ALTER ROLE autoconnect_app PASSWORD '...'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autoconnect_app') THEN
    CREATE ROLE autoconnect_app LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO autoconnect_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO autoconnect_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO autoconnect_app;

-- Tabela criada por migration futura já nasce acessível ao papel. Isto vale
-- para objetos criados por este usuário — o mesmo que roda as migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO autoconnect_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO autoconnect_app;

-- ─────────────────────────────────────────────────────────
-- 2. Tabelas com tenant_id — isolamento por concessionária
-- ─────────────────────────────────────────────────────────
-- A lista é explícita para ser revisável no diff. O teste
-- `rls-policies.e2e-spec.ts` compara esta cobertura com o catálogo do Postgres,
-- então uma tabela nova com tenant_id e sem policy quebra o CI sozinha.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'analytics_events', 'appointments', 'audit_log', 'conversations',
    'dealership_branches', 'lead_interactions', 'leads', 'messages',
    'notifications', 'sales_goals', 'salesperson_availability',
    'salesperson_profiles', 'tenant_subscriptions', 'user_invitations',
    'users', 'vehicle_history', 'vehicle_images', 'vehicle_views', 'vehicles'
  ];
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

-- ─────────────────────────────────────────────────────────
-- 3. Tabelas do cliente — isolamento por usuário
-- ─────────────────────────────────────────────────────────
-- Não pertencem a uma concessionária: favoritos, alertas e buscas salvas são
-- do consumidor final e o atravessam. Isolam-se por app.user_id.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'customer_favorites', 'customer_profiles', 'price_alerts',
    'saved_searches', 'user_sessions'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY user_isolation ON %I
        USING      (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────
-- 4. Catálogo global — leitura para todos, escrita só pelo dono
-- ─────────────────────────────────────────────────────────
-- Marcas, modelos e opcionais são compartilhados entre as concessionárias.
-- Sem policy de escrita, o papel da aplicação só lê; quem administra o catálogo
-- é o super admin, por conexão privilegiada.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'vehicle_brands', 'vehicle_models', 'vehicle_features', 'vehicle_feature_links'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY catalogo_publico ON %I FOR SELECT USING (true)', t);
    -- A loja cadastra marca ou modelo que ainda não existe ao criar um veículo
    -- (POST /catalog/brands). Só INSERT, e só com concessionária autenticada:
    -- editar ou apagar o catálogo compartilhado continua sendo do dono.
    EXECUTE format($f$
      CREATE POLICY catalogo_insercao ON %I FOR INSERT
        WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL)
    $f$, t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────
-- 5. Rotas públicas — catálogo, /c/[slug] e o mapa da busca
-- ─────────────────────────────────────────────────────────
-- Policies permissivas somam (OR). Estas liberam exatamente o que já está
-- publicado na internet hoje, e nada além disso.
--
-- O filtro é `status = 'available'`, sem `published_at IS NOT NULL`: é assim
-- que o catálogo público consulta hoje (catalog.service.ts e map.service.ts).
-- Exigir published_at aqui tornaria a policy mais restritiva que a aplicação e
-- sumiria com veículos da vitrine.

-- Veículo anunciado
CREATE POLICY leitura_publica ON vehicles
  FOR SELECT USING (status = 'available');

-- Fotos de veículo anunciado
CREATE POLICY leitura_publica ON vehicle_images
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_images.vehicle_id AND v.status = 'available')
  );

-- Filiais ativas de concessionárias ativas — os pins do mapa
CREATE POLICY leitura_publica ON dealership_branches
  FOR SELECT USING (
    is_active
    AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = dealership_branches.tenant_id AND t.is_active)
  );

-- ─────────────────────────────────────────────────────────
-- 6. tenants — a linha É o tenant, então o isolamento é por id
-- ─────────────────────────────────────────────────────────
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenants
  USING      (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- A página pública da concessionária mostra as ativas
CREATE POLICY leitura_publica ON tenants
  FOR SELECT USING (is_active);

-- ─────────────────────────────────────────────────────────
-- 7. Avisos globais do super admin
-- ─────────────────────────────────────────────────────────
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY leitura_publica ON announcements
  FOR SELECT USING (is_active);

-- ─────────────────────────────────────────────────────────
-- 8. tenant_invites — sem policy, de propósito
-- ─────────────────────────────────────────────────────────
-- Convites para abrir uma concessionária nova são consultados por token, antes
-- de existir tenant. Não há critério de isolamento possível, e uma policy
-- permissiva exporia todos os convites. Fica sem policy: o papel da aplicação
-- não enxerga nada, e o acesso é feito pela conexão privilegiada (super admin
-- e o cadastro por convite).
ALTER TABLE tenant_invites ENABLE ROW LEVEL SECURITY;

-- spatial_ref_sys é da extensão PostGIS, não da aplicação, e fica de fora.
