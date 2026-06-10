# AutoConnect — Guia de Contexto para Claude Code

SaaS multi-tenant para concessionárias de veículos. Objetivo: fechar o primeiro cliente pagante em ~12 semanas. Ciclo central: **cliente vê veículo → fala com vendedor → agenda test drive → fecha negócio rastreado**.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | NestJS 10 + TypeScript |
| ORM | Prisma 5 |
| Banco | PostgreSQL 15 (Supabase) |
| Tempo real | Socket.IO (via NestJS Gateway) |
| Filas | BullMQ + Redis |
| Frontend | Next.js 14 (App Router) + Tailwind + shadcn/ui |
| State | Zustand (auth) + TanStack Query (server state) |
| Mapa | Mapbox GL JS |
| Auth | JWT (próprio) + Google OAuth |
| Email | Resend ou Gmail SMTP (configurável por env) |
| Monorepo | Turborepo + pnpm workspaces |

---

## Estrutura de pastas

```
autoconnect/
├── apps/
│   ├── api/                    # NestJS — porta 4000
│   │   └── src/
│   │       ├── main.ts         # bootstrap, CORS, prefix /api/v1
│   │       ├── app.module.ts
│   │       ├── common/
│   │       │   ├── decorators/ # @CurrentUser, @Public, @Roles
│   │       │   ├── email/      # EmailService (Resend + Gmail)
│   │       │   ├── filters/    # ZodFilter
│   │       │   ├── guards/     # JwtAuthGuard, RolesGuard
│   │       │   ├── middleware/ # TenantMiddleware
│   │       │   ├── prisma/     # PrismaService
│   │       │   └── strategies/ # jwt.strategy, google.strategy
│   │       ├── gateway/
│   │       │   └── chat.gateway.ts   # WebSocket Socket.IO
│   │       └── modules/
│   │           ├── admin/       # superadmin + impersonation + announcements
│   │           ├── appointments/# agendamentos (CRUD completo)
│   │           ├── auth/        # login, register, refresh, google, reset senha
│   │           ├── catalog/     # marcas e modelos (admin global)
│   │           ├── conversations/# chat histórico
│   │           ├── health/      # healthcheck
│   │           ├── invitations/ # convites por email com token
│   │           ├── leads/       # captura, atribuição, timeline, stats
│   │           ├── map/         # filiais + vendedores online
│   │           ├── team/        # gestão da equipe da concessionária
│   │           ├── tenants/     # CRUD tenant + filiais
│   │           ├── users/       # perfis, roles, presença
│   │           └── vehicles/    # estoque, imagens, busca, filtros
│   └── web/                    # Next.js — porta 3000
│       └── src/
│           ├── app/
│           │   ├── (auth)/     # entrar, cadastrar, google callback, reset senha
│           │   ├── (dashboard)/# área logada (sidebar + layout)
│           │   │   ├── agendamentos/  # ← ÚLTIMA PÁGINA TRABALHADA
│           │   │   ├── chat/
│           │   │   ├── configuracoes/
│           │   │   ├── dashboard/
│           │   │   ├── equipe/
│           │   │   ├── leads/
│           │   │   ├── relatorios/
│           │   │   └── veiculos/      # lista + /novo + /[id]
│           │   ├── admin/
│           │   ├── buscar/     # mapa dark interativo + sidebar + pins
│           │   ├── c/[slug]/   # página pública da concessionária
│           │   ├── catalogo/[id]/ # página pública do veículo
│           │   ├── comecar/    # onboarding
│           │   ├── impersonate/
│           │   ├── invite/[token]/
│           │   └── perfil/
│           ├── components/
│           │   ├── ChatDrawer.tsx
│           │   ├── ApiHealth.tsx
│           │   └── providers.tsx
│           ├── lib/
│           │   ├── api.ts      # fetch wrapper com Bearer token + ApiError
│           │   └── utils.ts    # cn()
│           └── store/
│               └── auth.ts     # Zustand persist (token + user)
├── packages/
│   ├── db/                     # Prisma schema + migrations + seeds
│   │   └── prisma/
│   │       ├── schema.prisma   # fonte de verdade do banco
│   │       ├── migrations/     # 20260524040409_init (única migration)
│   │       └── seed.ts
│   └── shared/                 # tipos e validações Zod compartilhados
├── .env                        # variáveis reais (não comitar)
├── .env.example                # template das variáveis
└── turbo.json
```

---

## Variáveis de ambiente (.env na raiz)

```env
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
API_PORT=4000
JWT_SECRET="..."
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="30d"
NEXT_PUBLIC_API_URL="http://localhost:4000"
NEXT_PUBLIC_WS_URL="ws://localhost:4000"
NEXT_PUBLIC_MAPBOX_TOKEN="..."
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GOOGLE_CALLBACK_URL="http://localhost:4000/api/v1/auth/google/callback"
WEB_URL="http://localhost:3000"
REDIS_URL="redis://localhost:6379"
SUPABASE_URL="..."
SUPABASE_SERVICE_ROLE_KEY="..."
SUPABASE_STORAGE_BUCKET="vehicle-images"
RESEND_API_KEY=""           # ou usar Gmail abaixo
GMAIL_USER=""
GMAIL_APP_PASSWORD=""
EMAIL_FROM="AutoConnect <onboarding@resend.dev>"
```

---

## Como rodar

```bash
# 1. Instalar dependências
pnpm install

# 2. Gerar client Prisma
cd packages/db && npx prisma generate

# 3. Rodar migrations
npx prisma migrate deploy

# 4. Seed (opcional)
npx prisma db seed

# 5. Rodar tudo em dev (na raiz)
pnpm dev
# → API em http://localhost:4000/api/v1
# → Web em http://localhost:3000
```

---

## Padrões do projeto

### API
- Prefix global: `/api/v1`
- Autenticação: JWT via header `Authorization: Bearer <token>`
- Multi-tenant: `tenantId` extraído do JWT via `TenantMiddleware`
- Roles: `super_admin | tenant_admin | manager | salesperson | customer`
- Guard padrão: `JwtAuthGuard` global; rotas públicas usam `@Public()`

### Frontend
- `api()` helper em `src/lib/api.ts` — wraps fetch com token e trata erros
- Auth state em Zustand (persistido em localStorage como `autoconnect-auth`)
- `useAuthStore()` → `{ token, user, setSession, updateUser, clear }`
- Clientes (role `customer`) são redirecionados para `/perfil`, não acessam dashboard
- Sidebar no layout do dashboard: polling de leads novos a cada 30s via `/tenant/stats`

### Banco
- Schema único (shared schema), isolamento por `tenant_id`
- Campos geográficos (PostGIS) e `tsvector` gerenciados via SQL puro, marcados como `Unsupported` no Prisma
- Enums principais: `UserRole`, `VehicleStatus`, `LeadStatus`, `AppointmentStatus`, `ConversationStatus`

---

## Estado atual de cada módulo

| Módulo | Backend | Frontend | Observações |
|---|---|---|---|
| Auth | ✅ completo | ✅ completo | JWT + Google OAuth + reset senha + verificação email |
| Tenants/Filiais | ✅ completo | ✅ configurações | CRUD completo |
| Usuários/Perfil | ✅ completo | ✅ completo | perfil completo implementado |
| Equipe | ✅ completo | ✅ completo | convites por email com token |
| Veículos | ✅ completo | ✅ completo | CRUD + upload imagens + busca |
| Catálogo (marcas/modelos) | ✅ completo | ✅ público | página pública do veículo |
| Leads | ✅ completo | ✅ completo | kanban, timeline, interações, stats |
| Agendamentos | ✅ completo | ✅ completo | **última página trabalhada** |
| Chat | ✅ completo | ✅ completo | Socket.IO tempo real |
| Mapa | ✅ completo | ✅ completo | dark theme, pins animados, sidebar |
| Dashboard | ✅ completo | ✅ completo | KPIs, GalaxyMap |
| Admin | ✅ completo | ✅ completo | impersonation, announcements |
| Página pública concessionária | ✅ | ✅ | `/c/[slug]` com chat iniciado pelo cliente |

---

## Última alteração (não commitada)

**Página `/agendamentos` (apps/web/src/app/(dashboard)/agendamentos/page.tsx)**

Implementado:
- KPIs: agendamentos de hoje, próximos 7 dias, a confirmar, taxa de comparecimento
- Filtros: busca por cliente, status, vendedor, tipo de agendamento
- View **lista** agrupada por dia (hoje/amanhã/data) com período (hoje/semana/mês/tudo)
- View **calendário semanal** com navegação por semana, destaque do dia atual
- **Drawer de detalhes** com:
  - Data/hora + botão reagendar (inline com datetime-local)
  - Card do veículo com imagem
  - Info do cliente (email/telefone clicáveis)
  - Select de atribuição de vendedor (PATCH imediato)
  - Notas do agendamento
  - Ações: Confirmar / Concluir / Não compareceu / Cancelar

Backend (`/appointments`):
- `GET /appointments` — dealer lista todos do tenant; cliente lista os seus
- `POST /appointments` — cliente solicita agendamento
- `PATCH /appointments/:id` — dealer confirma/reagenda/atribui vendedor
- `PATCH /appointments/:id/cancel` — cancela

---

## Próximos passos sugeridos

1. **Agendamento pelo cliente** — integrar botão "Agendar test drive" na página pública `/c/[slug]` ou no `/catalogo/[id]`, chamando `POST /appointments`
2. **Notificações** — email para cliente quando agendamento for confirmado/cancelado
3. **Dashboard KPIs reais** — conectar `/tenant/stats` com dados reais de leads/agendamentos/conversas
4. **Relatórios** — implementar gráficos na página `/relatorios`
5. **Testes e2e** — cobrir fluxo principal: lead → agendamento → chat

---

## Git log resumido

```
87fccb3 feat: chat iniciado pelo cliente, perfil completo e ações no header da busca
b7dc9a2 feat: implementa conjunto completo de funcionalidades para concessionárias e clientes
8eaf001 fix+feat(buscar): dark theme completo + correção do pin que deslizava no zoom
75dc6f0 feat(buscar): visual premium — dark map, balões SVG animados e sidebar refinada
c25144a feat(buscar): interface moderna com sidebar, busca e catálogo de veículos
e18bddc fix(cors): aceitar localhost e IP da rede local simultaneamente
c0647ac feat(map): mapa interativo de concessionárias em tempo real
3e60349 feat(email): suporte a Gmail SMTP como alternativa ao Resend
aadb796 feat: erros contextuais de auth e fluxo completo de reset de senha
2815ecb feat: cadastro completo de clientes com verificação de e-mail
778e5ce feat(web): landing page completa
2be9841 feat(sprint-2): customer auth, catalog API, vehicles CRUD, vehicle dashboard pages
a4060ca Sprint 1: Auth, multi-tenant, dashboard e Google OAuth
```
