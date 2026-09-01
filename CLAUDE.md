# AutoConnect — Guia de Contexto para Claude Code

SaaS multi-tenant para concessionárias de veículos. Objetivo: fechar o primeiro cliente pagante em ~12 semanas. Ciclo central: **cliente vê veículo → fala com vendedor → agenda test drive → fecha negócio rastreado**.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | NestJS 10 + TypeScript |
| ORM | Prisma 5 |
| Banco | PostgreSQL 17 (Supabase, região `sa-east-1`) |
| Tempo real | Socket.IO (via NestJS Gateway) |
| Frontend | Next.js 14 (App Router) + Tailwind |
| State | Zustand (auth) + TanStack Query (só em `/dashboard`) |
| Mapa | **Leaflet** + tiles Esri Dark Gray |
| Upload de imagens | **Cloudinary** (direto do navegador) |
| Agendamento de jobs | `@nestjs/schedule` (cron in-process) |
| Auth | JWT (próprio) + Google OAuth |
| Email | Resend ou Gmail SMTP (configurável por env) |
| Monorepo | Turborepo + pnpm workspaces |
| Hospedagem | Railway (API + web) — região `us-east4` |

> **Não usamos:** BullMQ/Redis (a variável `REDIS_URL` existe no `.env` mas nenhum
> código a lê — os jobs agendados rodam via `@nestjs/schedule`), Mapbox
> (`NEXT_PUBLIC_MAPBOX_TOKEN` está vazio e sem uso) e Supabase Storage (as
> variáveis `SUPABASE_*` são órfãs — o upload é Cloudinary).
>
> O TanStack Query está configurado no `providers.tsx`, mas só `/dashboard` o
> usa; as demais telas buscam dados com `useEffect` + o helper `api()`.

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
│   │   ├── .env                # ← tem precedência sobre o .env da raiz
│   │   └── prisma/
│   │       ├── schema.prisma   # fonte de verdade do banco
│   │       ├── migrations/     # 4 migrations (ver abaixo)
│   │       └── seed.ts
│   └── shared/                 # tipos e validações Zod compartilhados
│                               # ⚠ compila para dist/ (gitignored) — precisa
│                               #   ser buildado ANTES da api
├── apps/web/.env               # ← o Next NÃO lê o .env da raiz
├── .env                        # variáveis reais (não comitar)
├── .env.example                # template das variáveis
└── turbo.json
```

### Armadilhas de configuração (todas já custaram tempo)

**Três arquivos `.env` diferentes, com precedências distintas:**

| Arquivo | Quem lê |
|---|---|
| `.env` (raiz) | Só a API (`envFilePath: ['.env', '../../.env']`) |
| `apps/web/.env` | **O Next** — ele não enxerga o da raiz |
| `packages/db/.env` | **O Prisma CLI**, com precedência sobre a raiz |

**`NEXT_PUBLIC_*` é embutida no bundle durante o `next build`**, não lida em
runtime. Alterar a variável na plataforma sem novo build não tem efeito: o app
segue com o valor antigo (ou o fallback `localhost`, que no navegador do
visitante aponta para a máquina dele).

**`NEXT_PUBLIC_API_URL` vai SEM o sufixo `/api/v1`** — o código acrescenta.

**Sempre buildar com `turbo run build --filter=...`**, nunca `pnpm --filter X build`.
O `@autoconnect/shared` compila para `dist/` (gitignored) e precisa vir antes da
API; o turbo respeita esse `dependsOn`, o pnpm sozinho não.

**`pnpm --filter <pkg> deploy` NÃO roda o script `deploy`** — `deploy` é comando
embutido do pnpm. Use `run deploy` ou o alias `migrate:deploy`.

---

## Variáveis de ambiente

### `.env` da raiz — usado pela API

```env
# Banco: Supabase via POOLER. Use a porta 5432 (modo sessão), não a 6543:
# o modo transação é ~5x mais lento por consulta (146ms vs 28ms medidos).
# O host direto db.<ref>.supabase.co é IPv6-only e o Railway não alcança.
DATABASE_URL="postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
DIRECT_URL="postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
# ⚠ Se a senha tiver @ # / : ? & %, precisa estar codificada (@ vira %40)

API_PORT=4000                  # em produção o Railway injeta PORT, que tem precedência
JWT_SECRET="..."
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="30d"
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GOOGLE_CALLBACK_URL="http://localhost:4000/api/v1/auth/google/callback"
WEB_URL="http://localhost:3000"   # também é a origem liberada no CORS
RESEND_API_KEY=""              # ou usar Gmail abaixo
GMAIL_USER=""
GMAIL_APP_PASSWORD=""
EMAIL_FROM="AutoConnect <onboarding@resend.dev>"
```

### `apps/web/.env` — usado pelo Next (a raiz NÃO serve)

```env
NEXT_PUBLIC_API_URL=http://localhost:4000      # sem /api/v1
NEXT_PUBLIC_WS_URL=ws://localhost:4000
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=...          # upload de fotos
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=...       # precisa ser "unsigned"
```

### Órfãs — presentes no `.env` mas sem nenhum código que as leia

`REDIS_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_STORAGE_BUCKET`, `NEXT_PUBLIC_MAPBOX_TOKEN`.

---

## Como rodar

Requer **Node 20** (`engines: >=20`). O Node 24+ não foi testado.

```bash
# 1. Dependências
pnpm install

# 2. Client do Prisma
pnpm --filter @autoconnect/db generate

# 3. Migrations (lê packages/db/.env, não o da raiz)
pnpm --filter @autoconnect/db run migrate:deploy

# 4. Seed (opcional)
pnpm --filter @autoconnect/db run db:seed

# 5. Dev
pnpm dev
# → API em http://localhost:4000/api/v1
# → Web em http://localhost:3000
```

Para buildar como em produção — **use o turbo**, senão o `@autoconnect/shared`
não é compilado antes e a API falha com `TS2307: Cannot find module`:

```bash
pnpm exec turbo run build --filter=@autoconnect/api
pnpm exec turbo run build --filter=@autoconnect/web
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
- `api()` helper em `src/lib/api.ts` — wraps fetch com token e trata erros.
  Em erro lança `ApiError` com `status` e `fieldErrors` (`[{ field, message }]`,
  vindos do `ZodFilter`). Use `fieldErrors` para marcar o campo errado em vez de
  exibir "Validation failed" solto — ver `signup/SignupContent.tsx` como modelo.
- Auth state em Zustand (persistido em localStorage como `autoconnect-auth`)
- `useAuthStore()` → `{ token, user, setSession, updateUser, clear }`
- Clientes (role `customer`) são redirecionados para `/perfil`, não acessam dashboard
- Sidebar no layout do dashboard: polling de leads novos a cada 30s via `/tenant/stats`.
  No mobile ela vira gaveta (`fixed` + `translate-x`); a partir de `md` é coluna fixa.
- ⚠ **Dívida conhecida:** 15 blocos `catch { /* ignora */ }` descartam o erro.
  Em 4 telas isso engole o carregamento inteiro (relatórios, agendamentos,
  equipe, leads) e a tela vazia fica indistinguível de "sem dados".

### Banco
- Schema único (shared schema), isolamento por `tenant_id`
- Campos geográficos (PostGIS) e `tsvector` gerenciados via SQL puro, marcados como `Unsupported` no Prisma
- Enums principais: `UserRole`, `VehicleStatus`, `LeadStatus`, `AppointmentStatus`, `ConversationStatus`
- **RLS ativado sem policies** em todas as tabelas da aplicação. Bloqueia a API
  REST pública do Supabase (papéis `anon`/`authenticated`); a aplicação não é
  afetada porque o Prisma conecta como dono das tabelas, que ignora RLS.
- ⚠ **Nunca use `prisma db push`.** Foi assim que 5 colunas e 5 tabelas inteiras
  ficaram sem migration e só existiam na máquina de quem rodou — um banco novo
  não as teria. Sempre `prisma migrate dev`.
- Migrations atuais: `init`, `trade_in_and_dealer_setting`,
  `add_missing_profile_and_branch_coords`,
  `add_announcements_invites_alerts_searches_goals`.

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

## Deploy (produção)

| | URL | Região |
|---|---|---|
| Web | https://autoconnectweb-production.up.railway.app | Railway `us-east4` |
| API | https://autoconnectapi-production.up.railway.app/api/v1 | Railway `us-east4` |
| Banco | Supabase `aamsnqmuvlprkavzkwnr` | `sa-east-1` (São Paulo) |

Deploy automático a cada push na `main`. Build e start ficam na configuração do
serviço no Railway (o `railway.json` foi descontinuado pela plataforma):

```
# API
build:  pnpm install --frozen-lockfile && pnpm --filter @autoconnect/db generate \
        && pnpm exec turbo run build --filter=@autoconnect/api
start:  node apps/api/dist/main.js
pre:    pnpm --filter @autoconnect/db exec prisma migrate deploy
health: /api/v1/health

# Web
build:  pnpm install --frozen-lockfile && pnpm exec turbo run build --filter=@autoconnect/web
start:  pnpm --filter @autoconnect/web start
```

**A API roda em região diferente do banco** (Virgínia ↔ São Paulo), então cada
consulta custa ~0,6s de ida e volta. Por isso a transação do cadastro usa
`maxWait: 15s, timeout: 30s` — com os 5s padrão do Prisma ela estourava.

---

## Pendências conhecidas

- **Login com Google não funciona em produção**: falta registrar no Google Cloud
  Console o redirect URI (`.../api/v1/auth/google/callback`) e publicar o app
  (`/auth/audience`), senão só contas de teste conseguem entrar.
- **Erros de API engolidos** — ver a dívida citada em *Padrões > Frontend*.
- **Relatórios aparecem vazios**: os dados de seed são de maio/junho e o filtro
  padrão é 30 dias.
- **CVEs restantes no Next** só têm correção na linha 15.x (breaking changes).
- **`/relatorios`, `/agendamentos` e `/equipe`** ainda não foram revisados para
  telas pequenas; só o layout do dashboard foi.

---

## Próximos passos sugeridos

1. **Distinguir falha de API de "sem dados"** nas 4 telas que engolem o carregamento
2. **Concluir o Google OAuth** no Console
3. **Revisar responsividade** das páginas internas do dashboard
4. **Testes e2e** — cobrir fluxo principal: lead → agendamento → chat
