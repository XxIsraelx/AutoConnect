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
| Geração de PDF | **pdfmake** (JS puro, sem Chromium — ver *Contrato*) |
| Documentos privados | **Supabase Storage**, bucket `documentos` (URL assinada) |
| Agendamento de jobs | `@nestjs/schedule` (cron in-process; cada execução passa por `executarEmUmaReplica`, advisory lock no Postgres) |
| Auth | JWT (próprio) + Google OAuth |
| Email | Resend ou Gmail SMTP (configurável por env) |
| Monorepo | Turborepo + pnpm workspaces |
| Hospedagem | Railway (API + web) — região `us-east4` |

> **Não usamos:** BullMQ/Redis (a variável `REDIS_URL` existe no `.env` mas nenhum
> código a lê — os jobs agendados rodam via `@nestjs/schedule`) e Mapbox
> (`NEXT_PUBLIC_MAPBOX_TOKEN` está vazio e sem uso).
>
> **Dois destinos de arquivo, de propósito:** foto de veículo vai para a
> Cloudinary com preset *unsigned* (pública por natureza); contrato e documento
> de identidade vão para o Supabase Storage num bucket **privado**, com upload
> pelo backend e URL assinada de 10 minutos. Misturar os dois é como uma
> política de bucket afrouxada expõe documento com CPF.
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
│   │       │   ├── prisma/     # PrismaService + PrivilegedPrismaService
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
│           │   │   ├── negocios/     # lista, funil de valor, contrato
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
│   │       ├── migrations/     # 7 migrations (ver abaixo)
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

### Documentos privados — usadas pelo `DocumentosStorage`

```env
SUPABASE_URL="https://<ref>.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="..."      # ignora RLS: nunca vai para o front
SUPABASE_DOCUMENTS_BUCKET="documentos"
```

Sem as duas primeiras, o contrato continua sendo **emitido e regerado sob
demanda** — apenas não fica arquivado. Um documento não arquivado é melhor que
um contrato não emitido, e o aviso na inicialização torna a ausência visível.

O bucket é privado, sem policy nenhuma em `storage.objects`: só a *service
role* alcança os arquivos. A rota `/object/public/` responde **404 "Bucket not
found"** para ele — negação mais forte que 403, porque não confirma nem que o
bucket existe.

### Órfãs — presentes no `.env` mas sem nenhum código que as leia

`REDIS_URL`, `SUPABASE_STORAGE_BUCKET` (aponta para `vehicle-images`; as fotos
vão para a Cloudinary) e `NEXT_PUBLIC_MAPBOX_TOKEN`.

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

## Isolamento por tenant

Detalhes e o porquê de cada caso: `docs/arquitetura/isolamento-por-tenant.md`.

**Todo acesso a tabela com `tenant_id` passa por `withTenant`.** Tabela do
consumidor final (`customer_favorites`, `customer_profiles`, `price_alerts`,
`saved_searches`, `user_sessions`) passa por `withUser`.

```ts
// certo
return this.prisma.withTenant(tenantId, (tx) => tx.lead.findMany());

// errado — roda sem contexto; sob autoconnect_app não enxerga linha nenhuma
return this.prisma.lead.findMany({ where: { tenantId } });
```

| Método | Quando | Define |
|---|---|---|
| `withTenant(tenantId, fn)` | dado da concessionária | `app.tenant_id` |
| `withUser(userId, fn)` | dado do consumidor final | `app.user_id` |
| `withTenantAndUser(t, u, fn)` | cliente agindo dentro de uma loja (lead, visita) | ambos |
| `withPublic(fn)` | catálogo, mapa, `/c/[slug]` | **nada**, de propósito |

- **O RLS já fiscaliza em produção** (a app conecta como `autoconnect_app` desde
  10/09/2026). Esquecer o contexto **fecha tudo** — a consulta volta vazia ou
  quebra, sem erro claro.
- Controllers passam um `Escopo` (`escopoDa(req.user)`, em `common/escopo.ts`),
  não `tenantId`. Super admin sem loja = `{ tipo: 'global' }`; qualquer outro
  papel sem loja = `ForbiddenException`. `null` nunca significa "vê tudo".
- `PrivilegedPrismaService` (ignora RLS) só para super admin, login e convite
  por token. Não é `@Global`: quem usa declara `PrivilegedPrismaModule`.
- `common/prisma/isolamento.spec.ts` falha se código novo acessar tabela de
  tenant fora de `withTenant`, usar `this.prisma.$transaction` ou SQL cru pelo
  cliente comum. A lista de pendências dele só pode encolher.
- Tabela nova com `tenant_id` precisa de policy na migration —
  `rls-policies.e2e-spec.ts` quebra sem ela.
- Nunca `FORCE ROW LEVEL SECURITY`: o dono passaria a ser filtrado.

---

## Testes e CI

O portão do projeto é um comando só. **Nenhum PR fecha sem ele verde** — hoje
são 283 testes:

```bash
pnpm exec turbo run typecheck lint test
```

### Rodar os testes localmente

Os testes de integração sobem o Nest inteiro contra um Postgres real — sem
SQLite e sem mock do Prisma, porque RLS, constraints e `Decimal` só existem no
Postgres de verdade.

```bash
# 1. Postgres de teste (porta 55432, dados em tmpfs — morre com o contêiner)
docker compose --env-file /dev/null -f docker-compose.test.yml up -d

# 2. Migrations no banco limpo
export DATABASE_URL="postgresql://postgres:postgres@localhost:55432/autoconnect_test"
export DIRECT_URL="$DATABASE_URL"
pnpm --filter @autoconnect/db exec prisma migrate deploy

# 3. Portão completo
pnpm exec turbo run typecheck lint test
```

O `--env-file /dev/null` é obrigatório: o Compose lê o `.env` da raiz sozinho e
é mais estrito que o dotenv do Node — uma linha sem `=` aborta o comando.

Detalhes (o que cada e2e fixa, CI e drift): `docs/arquitetura/testes-e-ci.md`.

- **Unitário** em `apps/api/src/**/*.spec.ts`, **integração** (Postgres real) em
  `apps/api/test/*.e2e-spec.ts`, **domínio** em `packages/shared/src/**/*.spec.ts`.
  Um `test` roda tudo.
- Teste de isolamento usa `test/helpers/tenant-fixture.ts` e `comoApp()`
  (`SET LOCAL ROLE autoconnect_app`) — a conexão dona ignora RLS e passaria
  verde sem provar nada.
- **Enums:** os schemas Zod do shared repetem os enums do Prisma, de propósito
  (importar o Prisma arrastaria binários para o navegador). Ao mudar enum no
  `schema.prisma`, atualize a constante no shared — `paridade-enums.spec.ts`
  quebra se divergir. `INVITABLE_ROLES` é subconjunto deliberado.
- **`apps/api/test/setup-e2e.ts` recusa rodar fora de banco local `_test` e
  zera as credenciais de e-mail e do Supabase.** Não remova. Serviço externo
  novo com credencial no `.env` precisa ser desligado ali também.
- O CI checa **drift** entre o banco migrado e o `schema.prisma`.

---

## Três armadilhas que já morderam aqui

### 1. Endpoint pronto não é funcionalidade

Seis vezes nesta base a API foi construída e testada, e **nenhuma tela chamava
o endpoint**: abrir negócio, vincular cliente, lead → negócio, atribuir
vendedor, gasto com consultas, encerrar conversa. Teste e2e batendo direto na
rota passa verde sem provar que alguém chega lá.

O que pega: cruzar as rotas dos controllers com as chamadas do `apps/web`.
Rota sem chamada é funcionalidade inalcançável ou código morto — as duas coisas
merecem decisão.

### 2. `noUnusedLocals` no web existe por um motivo

Um refatorador apagou `<Contrato />` do JSX e deixou o `import`. Typecheck
verde, lint verde, emissão de contrato impossível. O ESLint da API pega isso; o
do web (`next/core-web-vitals`) não pegava. A trava está ligada — **não a
desligue** para "resolver" um aviso.

### 3. Tipo de TypeScript não valida nada em tempo de execução

`PATCH /tenant/me` tinha o corpo só *anotado* e ia inteiro para
`tenant.update({ data })`. Um `tenant_admin` mandando `{"isActive": false}`
desativava a própria loja; `slug` trocava a URL pública. **Todo corpo passa
por Zod**, que descarta o que não está no schema — `mass-assignment.e2e-spec.ts`
fixa isso.

---

## Vendas e contrato

O porquê de cada regra: `docs/decisoes/vendas-e-contrato.md`.

- **Dinheiro nunca é `number`.** `Decimal(14,2)` no banco, `Prisma.Decimal` no
  cálculo, string no JSON, `formatarBRL` no front, `domain/dinheiro.ts`
  (centavos em `bigint`) para somar no navegador.
- **Um veículo, um negócio vivo:** índice único parcial
  `deals_veiculo_negocio_vivo_idx`. Se `DEAL_TERMINAL_STATUSES` mudar, o índice
  muda junto.
- **Máquina de estados em `DEAL_TRANSITIONS` (shared)**, usada pelo front e
  pelo back. Transição inválida é **409**. Antes de `signed` se **cancela**,
  depois se **distrata**.
- **Contrato:** template versionado por tenant, snapshot (não join), hash na
  emissão e conferido no download. `ContractPdfService.gerar()` recebe
  `emitidoEm` — o pdfmake não é determinístico sem isso. Fora de `draft`, é
  imutável por trigger (`contrato_emitido_e_imutavel`).
- **Garantia:** `validarGarantia` recusa prazo menor que 90 dias **combinado**
  com escopo restrito. `textoDaGarantia` sempre declara a legal.
- **Partes identificadas:** sem `DealBuyer` completo (CPF validado) e sem
  representante legal da loja, o contrato não é emitido.
- **Consulta veicular:** cobrada por chamada — cache antes de idempotência,
  idempotência antes da chamada; cache por concessionária; chamada ao
  fornecedor **fora** do `withTenant`. Sem `CONSULTA_FORNECEDOR`, recusa alto.
- ⚠ **O template de contrato não foi revisado por advogado.**

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
- Falha de carga se mostra com `ErroAoCarregar` (`components/ErroAoCarregar.tsx`,
  com "Tentar novamente"); falha de ação, inline com `textoDoErro`. Relatórios,
  agendamentos, equipe e leads já seguem isso — nunca `catch {}` em tela nova.
- ⚠ **Dívida conhecida:** restam 7 blocos `catch {}` sem aviso (5 deliberados:
  script de tema, `buscar/visited.ts` ×2, CEP do cadastro ×2) e ~18
  `.catch(() => {})`. Os que ainda enganam o usuário: `configuracoes` (carga
  falha e o formulário abre com o padrão), mensagens do `chat`/`ChatDrawer`,
  imagens em `veiculos/[id]`, salvar busca em `buscar/Sidebar.tsx`.

### Banco
- Schema único (shared schema), isolamento por `tenant_id`
- Campos geográficos (PostGIS) e `tsvector` gerenciados via SQL puro, marcados como `Unsupported` no Prisma
- Enums principais: `UserRole`, `VehicleStatus`, `LeadStatus`, `AppointmentStatus`, `ConversationStatus`
- **RLS com policies, criado por migration** (`20260902120000_rls_tenant_isolation`).
  Ver *Isolamento por tenant* abaixo.
- ⚠ **Nunca use `prisma db push`.** Foi assim que 5 colunas e 5 tabelas inteiras
  ficaram sem migration e só existiam na máquina de quem rodou — um banco novo
  não as teria. Sempre `prisma migrate dev`. Os scripts que expunham o comando
  foram removidos, e o CI agora falha sozinho se o `schema.prisma` divergir das
  migrations (ver *Testes e CI*).
- Migrations atuais (13): `init`, `trade_in_and_dealer_setting`,
  `add_missing_profile_and_branch_coords`,
  `add_announcements_invites_alerts_searches_goals`,
  `rls_tenant_isolation`, `rls_customer_access`, `rls_customer_users`,
  `deals_vendas_e_custos`, `sales_goal_meta_em_reais`,
  `contrato_garantia_assinatura`, `consultas_veiculares`,
  `comprador_do_contrato`, `representante_legal`.

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

## Documentação — cofre Obsidian em `docs/`

`docs/` é um cofre do Obsidian, versionado. Índice em `docs/Início.md`.

| Pasta | Uso |
|---|---|
| `docs/inbox/` | Ideias e bugs que o usuário anota. **"Veja o inbox"** = ler, resumir, propor destino de cada nota |
| `docs/decisoes/` | Uma nota por decisão nova (`AAAA-MM-DD titulo.md`, modelo em `docs/modelos/Decisão.md`). Registrar ao fechar uma decisão de arquitetura ou produto com o usuário |
| `docs/planos/` | Plano de vendas e levantamento |
| `docs/produto/`, `docs/arquitetura/` | Funcionalidades, MVP, banco, ERD |

- Links entre notas em **markdown relativo**, não `[[wikilink]]` — funcionam no
  Obsidian, no GitHub e no terminal.
- Nada de segredo no cofre: `ACESSOS.md` fica na raiz, fora dele.
- `docs/.obsidian/workspace*.json` é gitignored; o resto da config é versionado.


---

## Estado do projeto

Tabela de módulos, pendências auditadas, fases do plano e próximos passos:
`docs/planos/estado-e-pendencias.md`. O plano que governa o trabalho é
`docs/planos/plano-implementacao-vendas.md` (Fases 0 e 1 fechadas, Fase 2 com
4 de 5; faltam 3, 4 e 5).

**Bloqueiam uso real:** template de contrato sem revisão jurídica e ausência de
fornecedor de consulta veicular.

**Dívidas que afetam código novo:** API e banco em regiões diferentes (~0,6s por consulta); nenhuma
infraestrutura de feature flag.
