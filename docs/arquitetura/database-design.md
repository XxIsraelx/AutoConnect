# AutoConnect — Modelo de Banco de Dados

**Versão:** 1.0
**SGBD:** PostgreSQL 15+
**Estratégia multi-tenant:** *shared schema* + coluna `tenant_id` + **Row Level Security (RLS)**

Arquivos relacionados:
- `schema.sql` — DDL completo pronto pra rodar.
- `erd.mermaid` — diagrama ER.

---

## 1. Decisões de design

### 1.1 Multi-tenancy
Todas as tabelas que armazenam dados de uma concessionária têm uma coluna `tenant_id UUID NOT NULL`. O isolamento é garantido pelo PostgreSQL via **Row Level Security**: a aplicação executa `SET LOCAL app.tenant_id = '<uuid>'` no início de cada transação, e a política `tenant_isolation` filtra automaticamente todas as queries.

Vantagens: barato, escalável, fácil de operar (1 banco, 1 schema), permite analytics cross-tenant pelo time interno (com role `BYPASSRLS`).

### 1.2 Identidade única (`users`)
Em vez de tabelas separadas para `salespeople` e `customers`, há uma única tabela `users` com a coluna `role` (enum). Atributos específicos vão para `salesperson_profiles` e `customer_profiles` (relação 1:1). Isso simplifica:
- Autenticação (um login só).
- Chat (sender é sempre `user_id`).
- Permissões (basta checar `role` + `tenant_id`).

Clientes finais podem ter `tenant_id = NULL` — eles existem globalmente e podem interagir com várias concessionárias. Funcionários sempre pertencem a um tenant.

### 1.3 Geolocalização
Coordenadas usam `GEOGRAPHY(Point, 4326)` (extensão **PostGIS**). Permite queries do tipo "vendedores online a até 5km do cliente" diretamente no banco, com índice GIST.

### 1.4 Busca textual
`vehicles.search_vector` é um `TSVECTOR` populado por trigger. Indexado com GIN. Suporta busca em português com ranking por peso (version_name > description > color).

### 1.5 Auditoria
`audit_log` é uma tabela append-only que registra criações, edições e mudanças de status críticas. Indexada por `(tenant_id, created_at)` e por `(entity_type, entity_id)`.

### 1.6 Soft delete vs hard delete
- Tabelas operacionais (vehicles, leads, appointments) usam **status enum** (`archived`, `lost`, `canceled`) em vez de deletar.
- Tabelas transacionais (sessions, views, events) usam hard delete com `ON DELETE CASCADE`.

---

## 2. Domínios e tabelas

### 2.1 SaaS / Tenant

| Tabela | Função |
|---|---|
| `tenants` | Concessionária (empresa). Slug pro subdomínio, branding, CNPJ, configurações. |
| `tenant_subscriptions` | Plano e status de assinatura (trial/starter/pro/enterprise). Integração com Stripe/Iugu. |
| `dealership_branches` | Filiais físicas do tenant. Cada filial tem endereço, geolocalização e horário comercial. |

### 2.2 Usuários e autenticação

| Tabela | Função |
|---|---|
| `users` | Identidade única para todos os papéis. `email` é UK global. |
| `user_sessions` | Refresh tokens. Hash do token (nunca o token em si). |
| `user_invitations` | Convites de funcionários (token + expires_at). |
| `salesperson_profiles` | Perfil 1:1 do vendedor: presença, localização atual, comissão. |
| `customer_profiles` | Perfil 1:1 do cliente: CPF, cidade, canal preferido, última localização. |

**Roles disponíveis:** `super_admin` (equipe AutoConnect), `tenant_admin`, `manager`, `salesperson`, `customer`.

### 2.3 Catálogo de veículos

| Tabela | Função |
|---|---|
| `vehicle_brands` | Catálogo global de marcas (Toyota, VW, Fiat...). |
| `vehicle_models` | Catálogo global de modelos por marca. |
| `vehicles` | Estoque por tenant. VIN único globalmente. |
| `vehicle_images` | Fotos do veículo, com ordem e flag `is_cover`. |
| `vehicle_features` + `vehicle_feature_links` | N:N entre veículos e opcionais (airbag, multimídia, etc.). |
| `vehicle_history` | Eventos: mudança de preço, status, revisões. Audit-trail por veículo. |
| `vehicle_views` | Cada visualização. Base do "mais vistos" e analytics. |
| `customer_favorites` | N:N entre clientes e veículos. |

### 2.4 Leads e negociações

| Tabela | Função |
|---|---|
| `leads` | Cada interesse é um lead. Status: `new → contacted → qualified → negotiating → won/lost`. |
| `lead_interactions` | Timeline do lead: ligações, notas, mudanças de status, visitas. |

Lead **anônimo** (sem cadastro do cliente) é suportado: `customer_user_id` é NULL e os contatos vão em `contact_name`/`contact_email`/`contact_phone`.

### 2.5 Agendamentos

| Tabela | Função |
|---|---|
| `appointments` | Test drive, avaliação, atendimento presencial/online, entrega, serviço. |
| `salesperson_availability` | Slots semanais recorrentes (weekday + start/end). |

Para checar disponibilidade real: cruzar `salesperson_availability` com `appointments` no intervalo desejado.

### 2.6 Chat

| Tabela | Função |
|---|---|
| `conversations` | Uma conversa por (cliente, vendedor [, veículo]). Contadores de não-lidas. |
| `messages` | Mensagens. Suporta texto, imagem, arquivo e **card de veículo** (`kind='vehicle_card'` + `vehicle_ref_id`). |

A camada de tempo real (WebSocket/Socket.IO) lê/escreve aqui e emite eventos para os assinantes.

### 2.7 Notificações

`notifications` suporta os canais `in_app`, `email`, `push`, `whatsapp`, `sms`. Status: `pending → sent → failed | read`. O worker de notificação consome registros com `status='pending'`.

### 2.8 Analytics e auditoria

| Tabela | Função |
|---|---|
| `analytics_events` | Eventos genéricos: `event_name` + `properties JSONB`. |
| `audit_log` | Rastreabilidade de ações administrativas. |

Para volumes altos, considerar particionamento por `occurred_at` ou export pra data warehouse (BigQuery/Snowflake).

---

## 3. Índices principais

Cada FK importante tem índice. Destaques:

- `vehicles(tenant_id, status)` — listagem do estoque.
- `vehicles USING GIN(search_vector)` — busca textual.
- `vehicles USING GIST(...)` via `dealership_branches.location` e `salesperson_profiles.current_location` — queries geográficas.
- `leads(tenant_id, status)` — funil de vendas.
- `appointments(salesperson_id, scheduled_start)` — agenda do vendedor.
- `conversations(tenant_id, last_message_at DESC)` — inbox do atendimento.
- `notifications(user_id) WHERE read_at IS NULL` — index parcial para badge de não-lidas.

---

## 4. Como a aplicação deve usar RLS

```sql
-- início da requisição (após autenticar usuário):
BEGIN;
SET LOCAL app.tenant_id = '<uuid-do-tenant-do-usuario-logado>';

-- queries normais — RLS filtra automaticamente
SELECT * FROM vehicles WHERE status = 'available';

COMMIT;
```

Operações da equipe interna AutoConnect (super_admin, analytics cross-tenant) devem usar um **role do Postgres com `BYPASSRLS`** ou desabilitar localmente: `SET LOCAL row_security = off;`.

---

## 5. Roadmap do schema (próximas iterações)

- **Financeiro:** simulações de financiamento, contratos, parcelas, assinaturas digitais.
- **Avaliação de usados:** tabela `vehicle_evaluations` com fotos, laudo e proposta.
- **CRM avançado:** segmentação, campanhas, automações de follow-up.
- **Pós-venda:** OS, agendamento de revisão, garantia.
- **Marketplace:** publicar veículos cross-tenant.
- **Integração ERP:** tabela `integrations` + `sync_jobs`.
- **Particionamento:** `analytics_events` e `vehicle_views` por mês quando passarem de 50M linhas.
- **Read replicas:** separar leitura (catálogo público) de escrita (operação interna).

---

## 6. Stack recomendada (alinhada ao schema)

Como você pediu sugestões e o produto é SaaS real:

- **Backend:** Node.js + TypeScript + **NestJS** (módulos casam bem com os domínios acima). Alternativa: FastAPI se preferir Python.
- **ORM:** Prisma ou Drizzle (ambos suportam o schema acima sem ginástica).
- **Banco:** PostgreSQL 15+ gerenciado (Supabase, Neon, RDS, Cloud SQL). Supabase já entrega Postgres + Auth + Realtime + Storage prontos e cabe bem aqui.
- **Tempo real:** Socket.IO no backend, ou Supabase Realtime / Pusher se quiser terceirizar.
- **Frontend web:** Next.js 14 (App Router) + TanStack Query + shadcn/ui.
- **Mobile:** React Native (Expo) reaproveita a maior parte da camada de dados.
- **Mapa:** Mapbox GL JS (melhor DX e custo previsível pra produto). Google Maps se precisar de Street View.
- **Infra:** Vercel (front) + Fly.io/Railway (API + websocket) no início; migrar pra AWS quando escalar.
- **Filas/jobs:** BullMQ (Redis) — útil pra notificações, integrações e sync.

Quando quiser eu detalho a arquitetura técnica (módulos, fronteiras, eventos) e/ou começo a implementar.
