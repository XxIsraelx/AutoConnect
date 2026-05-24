-- =====================================================================
-- AutoConnect - Plataforma SaaS para Concessionárias
-- Schema PostgreSQL (multi-tenant: shared schema + tenant_id + RLS)
-- Versão: 1.0
-- =====================================================================

-- ---------------------------------------------------------------------
-- EXTENSÕES
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";         -- emails case-insensitive
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- busca textual em catálogo
CREATE EXTENSION IF NOT EXISTS "postgis";        -- geolocalização (mapa em tempo real)

-- ---------------------------------------------------------------------
-- FUNÇÕES AUXILIARES
-- ---------------------------------------------------------------------

-- Retorna o tenant_id do contexto atual da sessão (setado pela app via SET app.tenant_id = '...')
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- Atualiza coluna updated_at automaticamente
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
CREATE TYPE user_role        AS ENUM ('super_admin', 'tenant_admin', 'manager', 'salesperson', 'customer');
CREATE TYPE user_status      AS ENUM ('active', 'invited', 'suspended', 'deleted');
CREATE TYPE presence_status  AS ENUM ('online', 'busy', 'away', 'offline');

CREATE TYPE vehicle_condition AS ENUM ('new', 'used', 'semi_new', 'demo');
CREATE TYPE vehicle_status    AS ENUM ('available', 'reserved', 'sold', 'in_maintenance', 'archived');
CREATE TYPE fuel_type         AS ENUM ('gasoline', 'ethanol', 'flex', 'diesel', 'hybrid', 'electric', 'gnv');
CREATE TYPE transmission_type AS ENUM ('manual', 'automatic', 'cvt', 'automated_manual');

CREATE TYPE lead_status      AS ENUM ('new', 'contacted', 'qualified', 'negotiating', 'won', 'lost', 'archived');
CREATE TYPE lead_source      AS ENUM ('website', 'app', 'whatsapp', 'phone', 'walk_in', 'referral', 'social', 'ad', 'other');

CREATE TYPE appointment_type   AS ENUM ('test_drive', 'evaluation', 'in_person', 'online', 'delivery', 'service');
CREATE TYPE appointment_status AS ENUM ('scheduled', 'confirmed', 'in_progress', 'completed', 'canceled', 'no_show');

CREATE TYPE message_kind      AS ENUM ('text', 'image', 'file', 'vehicle_card', 'system');
CREATE TYPE conversation_status AS ENUM ('open', 'pending', 'closed');

CREATE TYPE notification_channel AS ENUM ('in_app', 'email', 'push', 'whatsapp', 'sms');
CREATE TYPE notification_status  AS ENUM ('pending', 'sent', 'failed', 'read');

CREATE TYPE subscription_plan   AS ENUM ('trial', 'starter', 'pro', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'paused');

-- =====================================================================
-- 1. TENANTS (Concessionárias - raiz multi-tenant)
-- =====================================================================

CREATE TABLE tenants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                CITEXT NOT NULL UNIQUE,            -- subdomínio: acme.autoconnect.com
  legal_name          TEXT NOT NULL,                     -- razão social
  trade_name          TEXT NOT NULL,                     -- nome fantasia
  tax_id              TEXT UNIQUE,                       -- CNPJ
  primary_email       CITEXT NOT NULL,
  primary_phone       TEXT,
  logo_url            TEXT,
  brand_color         TEXT,                              -- identidade visual (#RRGGBB)
  website_url         TEXT,
  timezone            TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  settings            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_tenants_updated BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Assinatura SaaS por tenant
CREATE TABLE tenant_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  plan              subscription_plan NOT NULL DEFAULT 'trial',
  status            subscription_status NOT NULL DEFAULT 'active',
  trial_ends_at     TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  external_provider TEXT,                             -- 'stripe' | 'iugu' | ...
  external_id       TEXT,
  seats_limit       INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_tenant_subscriptions_updated BEFORE UPDATE ON tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Filiais / unidades físicas da concessionária
CREATE TABLE dealership_branches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  is_headquarters BOOLEAN NOT NULL DEFAULT FALSE,
  phone           TEXT,
  email           CITEXT,
  address_line    TEXT,
  address_number  TEXT,
  complement      TEXT,
  neighborhood    TEXT,
  city            TEXT,
  state           TEXT,
  postal_code     TEXT,
  country         TEXT NOT NULL DEFAULT 'BR',
  location        GEOGRAPHY(Point, 4326),               -- lat/lng pro mapa
  business_hours  JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_branches_tenant ON dealership_branches(tenant_id);
CREATE INDEX idx_branches_location ON dealership_branches USING GIST(location);
CREATE TRIGGER trg_branches_updated BEFORE UPDATE ON dealership_branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 2. USERS & AUTH
-- =====================================================================

-- Tabela única de identidade. Funcionário OU cliente.
-- Clientes não têm tenant_id fixo (podem interagir com várias concessionárias).
-- Funcionários têm tenant_id obrigatório.
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = cliente final
  email             CITEXT NOT NULL UNIQUE,
  password_hash     TEXT,                                -- NULL se usar SSO/OAuth
  full_name         TEXT NOT NULL,
  phone             TEXT,
  avatar_url        TEXT,
  role              user_role NOT NULL,
  status            user_status NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_employee_has_tenant
    CHECK (role = 'customer' OR role = 'super_admin' OR tenant_id IS NOT NULL)
);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_role ON users(role);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sessões / refresh tokens
CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  user_agent      TEXT,
  ip_address      INET,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(refresh_token_hash);

-- Convites para funcionários
CREATE TABLE user_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       CITEXT NOT NULL,
  role        user_role NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  invited_by  UUID REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_invitations_tenant ON user_invitations(tenant_id);

-- =====================================================================
-- 3. PERFIS ESPECÍFICOS
-- =====================================================================

-- Perfil de vendedor (atributos extras do funcionário com role=salesperson)
CREATE TABLE salesperson_profiles (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id       UUID REFERENCES dealership_branches(id) ON DELETE SET NULL,
  bio             TEXT,
  hire_date       DATE,
  commission_pct  NUMERIC(5,2),
  presence        presence_status NOT NULL DEFAULT 'offline',
  last_seen_at    TIMESTAMPTZ,
  current_location GEOGRAPHY(Point, 4326),              -- pro mapa em tempo real
  is_accepting_leads BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_salesperson_tenant ON salesperson_profiles(tenant_id);
CREATE INDEX idx_salesperson_presence ON salesperson_profiles(presence);
CREATE INDEX idx_salesperson_location ON salesperson_profiles USING GIST(current_location);
CREATE TRIGGER trg_salesperson_updated BEFORE UPDATE ON salesperson_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Perfil do cliente final
CREATE TABLE customer_profiles (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  document_number TEXT,                              -- CPF
  birth_date      DATE,
  city            TEXT,
  state           TEXT,
  postal_code     TEXT,
  preferred_contact notification_channel NOT NULL DEFAULT 'whatsapp',
  share_location  BOOLEAN NOT NULL DEFAULT FALSE,
  last_location   GEOGRAPHY(Point, 4326),
  last_location_at TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_customer_location ON customer_profiles USING GIST(last_location);
CREATE TRIGGER trg_customer_updated BEFORE UPDATE ON customer_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 4. CATÁLOGO DE VEÍCULOS
-- =====================================================================

-- Catálogo global (compartilhado entre tenants) - marcas e modelos
CREATE TABLE vehicle_brands (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  logo_url   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE vehicle_models (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id   UUID NOT NULL REFERENCES vehicle_brands(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  category   TEXT,                                  -- SUV, sedan, hatch, picape...
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand_id, name)
);
CREATE INDEX idx_models_brand ON vehicle_models(brand_id);

-- Estoque por tenant
CREATE TABLE vehicles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id       UUID REFERENCES dealership_branches(id) ON DELETE SET NULL,
  brand_id        UUID NOT NULL REFERENCES vehicle_brands(id),
  model_id        UUID NOT NULL REFERENCES vehicle_models(id),
  version_name    TEXT,                              -- "1.0 Turbo Flex AT"
  year_model      INTEGER NOT NULL,
  year_make       INTEGER NOT NULL,
  color           TEXT,
  mileage_km      INTEGER NOT NULL DEFAULT 0,
  fuel            fuel_type,
  transmission    transmission_type,
  engine          TEXT,                              -- "1.0 Turbo"
  doors           SMALLINT,
  vin             TEXT UNIQUE,                       -- chassi
  license_plate   TEXT,
  condition       vehicle_condition NOT NULL DEFAULT 'used',
  status          vehicle_status NOT NULL DEFAULT 'available',
  price           NUMERIC(12,2) NOT NULL,
  promo_price     NUMERIC(12,2),
  description     TEXT,
  views_count     INTEGER NOT NULL DEFAULT 0,
  favorites_count INTEGER NOT NULL DEFAULT 0,
  published_at    TIMESTAMPTZ,
  sold_at         TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_vector   TSVECTOR,                          -- busca textual
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_vehicles_tenant ON vehicles(tenant_id);
CREATE INDEX idx_vehicles_branch ON vehicles(branch_id);
CREATE INDEX idx_vehicles_status ON vehicles(status);
CREATE INDEX idx_vehicles_model ON vehicles(model_id);
CREATE INDEX idx_vehicles_price ON vehicles(price);
CREATE INDEX idx_vehicles_search ON vehicles USING GIN(search_vector);
CREATE TRIGGER trg_vehicles_updated BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Imagens do veículo (ordem importa)
CREATE TABLE vehicle_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  alt_text    TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  is_cover    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_vehicle_images_vehicle ON vehicle_images(vehicle_id);

-- Opcionais (features) - catálogo + ligação N:N
CREATE TABLE vehicle_features (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL UNIQUE,
  icon  TEXT
);

CREATE TABLE vehicle_feature_links (
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES vehicle_features(id) ON DELETE CASCADE,
  PRIMARY KEY (vehicle_id, feature_id)
);

-- Histórico do veículo (eventos / mudanças de status / revisões)
CREATE TABLE vehicle_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,                         -- 'status_change' | 'price_change' | 'service' | ...
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_vehicle_history_vehicle ON vehicle_history(vehicle_id);

-- Favoritos do cliente
CREATE TABLE customer_favorites (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, vehicle_id)
);

-- Visualizações (analytics - veículos mais vistos)
CREATE TABLE vehicle_views (
  id          BIGSERIAL PRIMARY KEY,
  vehicle_id  UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id  TEXT,                                  -- pra usuários anônimos
  source      TEXT,                                  -- 'web' | 'app' | 'embed'
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_vehicle_views_vehicle ON vehicle_views(vehicle_id);
CREATE INDEX idx_vehicle_views_tenant_time ON vehicle_views(tenant_id, viewed_at DESC);

-- =====================================================================
-- 5. LEADS & NEGOCIAÇÕES
-- =====================================================================

CREATE TABLE leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,   -- NULL = lead anônimo
  branch_id         UUID REFERENCES dealership_branches(id) ON DELETE SET NULL,
  assigned_to       UUID REFERENCES users(id) ON DELETE SET NULL,   -- vendedor
  vehicle_id        UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  contact_name      TEXT,                              -- se lead anônimo
  contact_email     CITEXT,
  contact_phone     TEXT,
  source            lead_source NOT NULL DEFAULT 'website',
  status            lead_status NOT NULL DEFAULT 'new',
  message           TEXT,
  score             SMALLINT,                          -- 0-100 lead scoring
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  won_at            TIMESTAMPTZ,
  lost_reason       TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_leads_tenant ON leads(tenant_id);
CREATE INDEX idx_leads_status ON leads(tenant_id, status);
CREATE INDEX idx_leads_assigned ON leads(assigned_to);
CREATE INDEX idx_leads_vehicle ON leads(vehicle_id);
CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Interações no lead (timeline)
CREATE TABLE lead_interactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL,                          -- 'note' | 'call' | 'message' | 'status_change' | 'visit'
  content      TEXT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lead_interactions_lead ON lead_interactions(lead_id, occurred_at DESC);

-- =====================================================================
-- 6. AGENDAMENTOS
-- =====================================================================

CREATE TABLE appointments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id        UUID REFERENCES dealership_branches(id) ON DELETE SET NULL,
  customer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  salesperson_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id       UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  lead_id          UUID REFERENCES leads(id) ON DELETE SET NULL,
  type             appointment_type NOT NULL,
  status           appointment_status NOT NULL DEFAULT 'scheduled',
  scheduled_start  TIMESTAMPTZ NOT NULL,
  scheduled_end    TIMESTAMPTZ NOT NULL,
  meeting_url      TEXT,                              -- se for online
  location         GEOGRAPHY(Point, 4326),            -- se for atendimento externo
  address          TEXT,
  notes            TEXT,
  cancellation_reason TEXT,
  reminder_sent_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_appointment_time CHECK (scheduled_end > scheduled_start)
);
CREATE INDEX idx_appointments_tenant_start ON appointments(tenant_id, scheduled_start);
CREATE INDEX idx_appointments_salesperson_start ON appointments(salesperson_id, scheduled_start);
CREATE INDEX idx_appointments_customer ON appointments(customer_user_id);
CREATE INDEX idx_appointments_status ON appointments(tenant_id, status);
CREATE TRIGGER trg_appointments_updated BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Disponibilidade do vendedor (slots semanais recorrentes)
CREATE TABLE salesperson_availability (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  weekday       SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0=domingo
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  CONSTRAINT chk_avail_time CHECK (end_time > start_time)
);
CREATE INDEX idx_avail_salesperson ON salesperson_availability(salesperson_id);

-- =====================================================================
-- 7. CHAT EM TEMPO REAL
-- =====================================================================

CREATE TABLE conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  salesperson_id   UUID REFERENCES users(id) ON DELETE SET NULL,    -- pode estar não atribuído
  vehicle_id       UUID REFERENCES vehicles(id) ON DELETE SET NULL, -- contexto: conversa sobre um veículo
  lead_id          UUID REFERENCES leads(id) ON DELETE SET NULL,
  status           conversation_status NOT NULL DEFAULT 'open',
  last_message_at  TIMESTAMPTZ,
  unread_count_customer    INTEGER NOT NULL DEFAULT 0,
  unread_count_salesperson INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX idx_conversations_customer ON conversations(customer_user_id);
CREATE INDEX idx_conversations_salesperson ON conversations(salesperson_id);
CREATE INDEX idx_conversations_last_message ON conversations(tenant_id, last_message_at DESC);
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sender_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,    -- NULL = mensagem do sistema
  kind             message_kind NOT NULL DEFAULT 'text',
  body             TEXT,
  attachment_url   TEXT,
  vehicle_ref_id   UUID REFERENCES vehicles(id) ON DELETE SET NULL, -- pra cards de veículo
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at          TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_tenant ON messages(tenant_id);

-- =====================================================================
-- 8. NOTIFICAÇÕES
-- =====================================================================

CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,        -- NULL = notif global do cliente
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel      notification_channel NOT NULL,
  status       notification_status NOT NULL DEFAULT 'pending',
  title        TEXT NOT NULL,
  body         TEXT,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,                   -- deep link / contexto
  sent_at      TIMESTAMPTZ,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

-- =====================================================================
-- 9. ANALYTICS / EVENTOS GENÉRICOS
-- =====================================================================

CREATE TABLE analytics_events (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT,
  event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_analytics_tenant_time ON analytics_events(tenant_id, occurred_at DESC);
CREATE INDEX idx_analytics_event ON analytics_events(event_name);

-- =====================================================================
-- 10. AUDIT LOG (rastreabilidade)
-- =====================================================================

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,                          -- 'vehicle.created' | 'lead.assigned' | ...
  entity_type TEXT NOT NULL,
  entity_id   UUID,
  diff        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_tenant_time ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

-- =====================================================================
-- ROW LEVEL SECURITY (multi-tenant isolation)
-- =====================================================================
-- Premissa: a aplicação sempre executa
--   SET LOCAL app.tenant_id = '<uuid do tenant>'
-- antes de qualquer query. Para operações cross-tenant (super_admin),
-- usa-se um role do Postgres com BYPASSRLS.

ALTER TABLE tenants                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealership_branches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invitations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE salesperson_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_images           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_history          ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_views            ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_interactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE salesperson_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                ENABLE ROW LEVEL SECURITY;

-- Política genérica: linha só é visível se tenant_id == current_tenant_id()
-- (ou se tenant_id IS NULL, caso de dados globais como customer com role=customer)
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'tenants','tenant_subscriptions','dealership_branches','users',
    'user_invitations','salesperson_profiles','vehicles','vehicle_images','vehicle_history',
    'vehicle_views','leads','lead_interactions','appointments',
    'salesperson_availability','conversations','messages','notifications',
    'analytics_events','audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF t = 'tenants' THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());',
        t
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id() OR tenant_id IS NULL) WITH CHECK (tenant_id = current_tenant_id() OR tenant_id IS NULL);',
        t
      );
    END IF;
  END LOOP;
END $$;

-- =====================================================================
-- TRIGGER: atualizar search_vector dos veículos
-- =====================================================================
CREATE OR REPLACE FUNCTION vehicles_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('portuguese', coalesce(NEW.version_name,'')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(NEW.description,'')), 'C') ||
    setweight(to_tsvector('portuguese', coalesce(NEW.color,'')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vehicles_search_vector
  BEFORE INSERT OR UPDATE OF version_name, description, color
  ON vehicles
  FOR EACH ROW EXECUTE FUNCTION vehicles_search_vector_update();

-- =====================================================================
-- FIM
-- =====================================================================
