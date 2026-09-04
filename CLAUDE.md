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
| Agendamento de jobs | `@nestjs/schedule` (cron in-process) |
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

### A regra

As tabelas de venda e contrato (`deals`, `deal_payments`, `deal_status_events`,
`trade_ins`, `vehicle_acquisitions`, `vehicle_costs`, `contract_templates`,
`deal_contracts`, `contract_signatures`, `deal_warranties`, `deal_buyers`,
`vehicle_queries`) seguem a mesma
regra, e carregam o dado mais sensível do sistema: preço de compra, margem,
contrato assinado e CPF de signatário.

**Todo acesso a tabela com `tenant_id` passa por `withTenant`.** Todo acesso a
tabela do consumidor final (`customer_favorites`, `customer_profiles`,
`price_alerts`, `saved_searches`, `user_sessions`) passa por `withUser`.

```ts
// certo
return this.prisma.withTenant(tenantId, (tx) => tx.lead.findMany());

// errado — roda sem contexto; quando a aplicação conectar como
// autoconnect_app, não enxerga linha nenhuma
return this.prisma.lead.findMany({ where: { tenantId } });
```

Os dois métodos abrem transação e definem `app.tenant_id` / `app.user_id` via
`set_config(..., true)`, que é a forma **parametrizável** — a versão anterior
interpolava o id na string SQL.

### Como as policies funcionam

Cada tabela com `tenant_id` tem `tenant_isolation`, comparando a coluna com
`current_setting('app.tenant_id', true)`. Quando a variável não foi definida, a
função devolve `NULL`, a comparação vira `NULL` e a policy trata como falso:
**esquecer de setar o tenant fecha tudo, não abre tudo.**

Três casos têm tratamento explícito:

| Caso | Solução |
|---|---|
| Rotas públicas (catálogo, `/c/[slug]`, mapa) | Policy `leitura_publica` em `vehicles`, `vehicle_images`, `dealership_branches` e `tenants`, liberando só o que já está na vitrine — o filtro é `status = 'available'`, o mesmo que o `catalog.service` usa |
| Super admin | `PrivilegedPrismaService` — conexão pela `DIRECT_URL`, dona das tabelas, que ignora RLS. Também é o caminho de `tenant_invites` e do login, que buscam antes de existir tenant |
| Tabelas sem `tenant_id` | Catálogo global (`vehicle_brands`, `vehicle_models`, …) é leitura para todos e escrita só pelo dono; as do cliente isolam por `user_id` |
| **Cliente atravessa concessionárias** | Ele agenda na loja A e conversa com a B. Policy `acesso_cliente` em `appointments`, `conversations` e `messages`, por `app.user_id` |
| **Cliente não pertence a loja nenhuma** | `users.tenant_id` é NULL para clientes, então a policy de tenant os tornaria invisíveis. `acesso_proprio` (ele mesmo) + `cliente_relacionado` (a loja vê quem tem lead, agendamento ou conversa com ela — **não** a base inteira) |

### Escopo da requisição

Controllers não passam `tenantId` para os services: passam um `Escopo`, criado
por `escopoDa(req.user)` em `common/escopo.ts`.

| Situação | Escopo | Consulta |
|---|---|---|
| Usuário com concessionária | `{ tipo: 'tenant' }` | `withTenant` |
| **Super admin sem loja selecionada** | `{ tipo: 'global' }` | conexão privilegiada, sem filtro |
| Qualquer outro papel sem loja | — | `ForbiddenException` |

O tipo existe para que `null` **não** possa significar "vê tudo". Um `tenantId`
perdido no meio do caminho vira erro alto, e não uma consulta sem filtro — que
é como um bug comum viraria vazamento entre concessionárias.

Super admin **impersonando** tem `tenantId` no token e portanto escopo de
tenant: o consolidado não vaza para dentro da tela de uma loja só.

### A conexão privilegiada

`PrivilegedPrismaService` existe para as operações que não têm tenant a que se
restringir: super admin, login (busca por e-mail antes de saber a loja) e
convite por token. Ele **não** é `@Global`, ao contrário do `PrismaModule` —
quem precisa atravessar concessionárias declara `PrivilegedPrismaModule` nos
imports, e isso aparece no diff do PR.

Não use para acesso comum a dado de concessionária.

### O que garante que a regra continue valendo

`common/prisma/isolamento.spec.ts` varre o código e falha se um arquivo novo
acessar tabela de tenant fora de `withTenant`. Os módulos ainda não migrados
estão numa lista de pendências explícita, com o motivo de cada um — a lista só
pode encolher, e o teste também falha se alguém deixar nela um módulo já
migrado.

### Os quatro acessos

| Método | Quando | Define |
|---|---|---|
| `withTenant(tenantId, fn)` | dado da concessionária | `app.tenant_id` |
| `withUser(userId, fn)` | dado do consumidor final | `app.user_id` |
| `withTenantAndUser(t, u, fn)` | cliente agindo dentro de uma loja (captura de lead, registro de visita) | ambos |
| `withPublic(fn)` | catálogo, mapa, `/c/[slug]` | **nada**, de propósito |

`withPublic` roda sem contexto: sobra apenas a policy `leitura_publica`. Existe
para que "esta consulta é pública" seja uma decisão escrita, não a ausência de
uma decisão.

### Ligar a fiscalização em produção

Todo o código já opera sob RLS — o CI prova isso rodando a suíte de integração
conectada como `autoconnect_app`. Falta só a troca de configuração:

1. `ALTER ROLE autoconnect_app PASSWORD '<senha>'` (a senha **não** está na
   migration: segredo não entra em arquivo versionado). Evite os caracteres
   `@ # / : ? & %`, que quebram a URL.
2. No Railway, apontar **`DATABASE_URL`** para `autoconnect_app` e manter
   **`DIRECT_URL`** como o dono (`postgres`), que é a conexão privilegiada.

Reverter é trocar a `DATABASE_URL` de volta.

Enquanto isso não acontece, a aplicação conecta como dona das tabelas e o RLS
fica inerte — nada quebra, e o isolamento continua sendo o `where: { tenantId }`
de sempre, mantido de propósito como primeira linha de defesa.

Também **não** usamos `FORCE ROW LEVEL SECURITY` — com ele o próprio dono
passaria a ser filtrado, e migrations, seed e a conexão privilegiada parariam
de enxergar dados.

---

## Testes e CI

O portão do projeto é um comando só. **Nenhum PR fecha sem ele verde** — hoje
são 266 testes:

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

### Enums: Prisma e Zod

Os schemas Zod do `@autoconnect/shared` **repetem** as listas dos enums do
Prisma, em constantes exportadas (`LEAD_SOURCES`, `VEHICLE_CONDITIONS`, …).

A repetição é deliberada: `@autoconnect/db` é `export * from '@prisma/client'` e
o `@autoconnect/shared` é dependência do `apps/web` — importar um do outro
arrastaria o Prisma e seus binários nativos para o bundle do navegador.

O preço é a chance de divergirem, e `paridade-enums.spec.ts` é o que a elimina:
compara cada lista com o enum real e quebra o CI. Ao adicionar valor a um enum
no `schema.prisma`, atualize a constante correspondente no shared.

> `INVITABLE_ROLES` é a exceção: um **subconjunto** deliberado de `UserRole`,
> porque convidar `super_admin` ou `customer` pela tela da equipe seria
> escalada de privilégio. O teste dele afirma subconjunto, não igualdade.

### Onde cada teste mora

| Caminho | Tipo | Roda com |
|---|---|---|
| `apps/api/src/**/*.spec.ts` | unitário, sem banco | `jest.config.js` (project `api:unit`) |
| `apps/api/test/*.e2e-spec.ts` | integração, Postgres real | `test/jest-e2e.config.js` |
| `packages/shared/src/**/*.spec.ts` | domínio puro | `packages/shared/jest.config.js` |

Os testes de isolamento usam `test/helpers/tenant-fixture.ts`, que cria duas
concessionárias completas. O helper `comoApp()` roda a consulta com
`SET LOCAL ROLE autoconnect_app` — a conexão dona ignora RLS e passaria verde
sem provar nada.

| Arquivo | O que fixa |
|---|---|
| `rls-policies.e2e-spec.ts` | Cobertura: toda tabela com `tenant_id` tem policy. **Tabela nova sem policy quebra o CI sozinha** |
| `rls-isolation.e2e-spec.ts` | O isolamento no banco, incluindo falhar fechado sem contexto |
| `tenant-leak.e2e-spec.ts` | O contrato HTTP: **404, não 403** — 403 confirmaria que o recurso existe |
| `deals-invariantes.e2e-spec.ts` | Um veículo, um negócio vivo — índice único parcial exercido no banco |
| `deals.e2e-spec.ts` | O fluxo do negócio por HTTP, papéis e vazamento |
| `proposta-chat.e2e-spec.ts` | A proposta do chat virando negócio (falha em silêncio por desenho) |
| `chat-gateway.e2e-spec.ts` | O gateway pelo WebSocket — o evento é `conversation:send`, não `message:send` |
| `contrato-imutavel.e2e-spec.ts` | Contrato emitido não muda: trigger no banco |
| `contrato.e2e-spec.ts` | Emissão, hash, assinatura e anulação por HTTP |

O `jest.config.js` da API roda os dois *projects*, para que um único `test`
cubra unitário e integração — teste fora do comando do portão não é rodado por
ninguém.

### Trava contra rodar em produção

`apps/api/test/setup-e2e.ts` **recusa** iniciar se a `DATABASE_URL` não for um
host local com banco terminado em `_test`. Sem isso, um teste que escreve
rodaria contra o Supabase de produção, que é justamente o que o `.env` da raiz
aponta. A trava não é opcional — não a remova para "testar contra dados reais".

### CI

`.github/workflows/ci.yml` roda em todo push na `main` e em todo PR: instala,
gera o client do Prisma, aplica as migrations em banco limpo, **checa drift** e
roda o portão.

O passo de drift compara o banco recém-migrado com o `schema.prisma` e falha se
divergirem — é a rede contra o acidente do `prisma db push`, que já custou 5
colunas e 5 tabelas aqui. Usa `--from-url` e não `--from-migrations`: a segunda
forma acusa falsamente as quatro extensões (`citext`, `pg_trgm`, `pgcrypto`,
`postgis`) como ausentes.

> Os scripts `db:push` (raiz) e `push` (`packages/db`) **foram removidos**. Para
> alterar o schema, sempre `prisma migrate dev`.

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

### Dinheiro nunca é `number`

`Decimal(14,2)` no banco, `Prisma.Decimal` no cálculo, **string** no JSON. No
front, `formatarBRL` do `@autoconnect/shared` formata a partir da string, sem
passar por ponto flutuante. `0.1 + 0.2` não é `0.3`, e um centavo numa comissão
vira ligação do vendedor.

`packages/shared/src/domain/dinheiro.ts` faz aritmética em centavos inteiros
(`bigint`) para quem precisa somar no navegador.

### Um veículo, um negócio vivo

Índice único parcial `deals_veiculo_negocio_vivo_idx`, com
`WHERE status NOT IN ('canceled','rescinded')`. A checagem no service não
resolveria: entre o `SELECT` que confere e o `INSERT` que grava cabe outra
transação, e o resultado é o mesmo carro vendido duas vezes, descoberto na
entrega.

Se `DEAL_TERMINAL_STATUSES` mudar, **este índice muda junto** — há teste que
liga as duas listas.

### A máquina de estados mora no `shared`

`DEAL_TRANSITIONS` é consultada pelo front (para decidir quais botões mostrar) e
pelo back (para recusar). Duas cópias da regra produz um botão que abre diálogo
e termina em 409. Transição inválida é **409, não 400**: o pedido é bem formado,
o estado é que conflita.

Assimetria deliberada: antes de `signed` o negócio é **cancelado**; depois dela,
**distratado**. São eventos jurídicos diferentes.

### Contrato

Três garantias, e uma armadilha medida:

1. **Template versionado por tenant.** Editar cria versão nova; o contrato
   aponta para a versão exata que usou.
2. **Snapshot, não join.** Se o preço do veículo mudar, o contrato assinado não
   muda junto.
3. **Hash na emissão**, e o download **regenera** o PDF do snapshot e confere o
   hash antes de entregar. Não bate, não sai.

⚠ **O pdfmake não é determinístico por padrão** — ele carimba o relógio na data
de criação, e o mesmo contrato gera bytes diferentes a cada execução. Medido,
não suposto. `ContractPdfService.gerar()` recebe `emitidoEm` e o usa como data
de criação; sem isso o hash não prova nada. Fontes Helvetica embutidas no
pdfkit: nenhum arquivo de fonte no deploy.

Contrato que saiu de `draft` é **imutável por trigger no banco**
(`contrato_emitido_e_imutavel`), não só por regra de service — ali é uma linha
que alguém remove sem perceber, e o efeito só aparece quando um cliente
contesta a assinatura.

### Garantia: a cláusula que não se deve conseguir escrever

`validarGarantia` recusa emitir contrato em que a garantia contratual apareça
como **redução** da legal de 90 dias, que cobre o veículo inteiro (CDC art. 26,
II + art. 51, I). A regra é específica: prazo curto **sem** restrição de escopo
passa — o que se recusa é prazo menor **combinado** com escopo restrito, que é
o disfarce clássico ("3 meses de motor e câmbio").

`textoDaGarantia` sempre declara a legal, mesmo havendo contratual: omiti-la é
o que torna a cláusula abusiva.

### As duas partes precisam estar identificadas

O contrato recusa emissão sem qualificação do **comprador** (`DealBuyer`:
nome, CPF validado por dígitos, RG, endereço) e sem **representante legal** da
loja (`Tenant.legalRepName/Cpf/Role`, configurado uma vez). Um documento que
diz "portador(a) do documento ____" parece contrato e não identifica quem se
obrigou.

O comprador fica no negócio, não no perfil do cliente: a loja não escreve em
`customer_profiles` (isolado por `app.user_id`), e o contrato precisa do dado
como estava na emissão.

### Consulta veicular

Cache antes de idempotência, idempotência antes da chamada — **cada consulta é
cobrada por chamada**. TTL por tipo (débito 24h, leilão 90 dias) e cache por
concessionária: compartilhar revelaria que a concorrente consultou aquela placa.

A chamada ao fornecedor fica **fora** do `withTenant`: relançar erro dentro da
transação desfazia por rollback o próprio registro da falha, e a loja veria
cobrança na fatura sem correspondente no sistema.

Sem `CONSULTA_FORNECEDOR`, a API recusa com mensagem clara em vez de devolver
"nada encontrado" — que viraria selo afirmando carro limpo com base em consulta
que nunca aconteceu. O valor `simulado` é ignorado em produção.

> ⚠ **O template padrão do código não foi revisado por advogado.** Está
> declarado como ponto de partida. O portão da Fase 2 exige essa revisão antes
> de qualquer cliente real emitir contrato.

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
| **Negócios (`Deal`)** | ✅ completo | ✅ completo | máquina de estados, pagamento composto, margem em `Decimal` |
| **Custo do veículo** | ✅ completo | ✅ completo | aquisição + preparação; base da margem |
| **Contrato** | ✅ completo | ✅ completo | PDF determinístico, hash, assinatura interna |
| **Consulta veicular** | ✅ estrutura | ✅ completo | cache, idempotência e custo; **falta fornecedor real** |

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

Auditadas em 04/09/2026, contra o repositório.

**Bloqueiam uso real**
- ⚠ **Template de contrato não revisado por advogado.** O sistema emite
  documento com efeito jurídico a partir de um template declarado no código
  como ponto de partida.
- ⚠ **Sem fornecedor de consulta veicular.** Depende de contrato comercial. A
  estrutura está pronta e a API recusa em voz alta enquanto não houver.

**Da definição de pronto do plano, um item nunca foi cumprido**
- **Feature flag.** O plano pede "feature nova atrás de flag até o piloto
  validar". Nada foi entregue atrás de flag — negócios, contrato e consulta
  entraram direto. Não há infraestrutura de flag no projeto.

**Dívidas de infraestrutura**
- **Crons in-process** (`@nestjs/schedule`): com duas réplicas no Railway, todo
  lembrete sai **duas vezes**. Passa hoje porque roda uma instância só.
- **API e banco em regiões diferentes** (`us-east4` ↔ `sa-east-1`), ~0,6s por
  consulta.
- **`SUPABASE_SERVICE_ROLE_KEY` no Railway**: definida, mas a validade da chave
  nunca foi verificada de forma independente — chave errada só falha no upload.

**Menores**
- **Google OAuth em produção**: falta registrar o redirect URI e publicar o app
  no Console.
- **Um `catch` silencioso deliberado** em `SeloProcedencia`: falha no selo não
  pode virar erro na tela de venda. Está comentado no código.
- **`/relatorios`, `/agendamentos` e `/equipe`** ainda não revisados para telas
  pequenas.
- **Relatórios vazios**: seed é de maio/junho, filtro padrão de 30 dias, e os
  gráficos de margem e giro dependem de negócio faturado que o seed não cria.
- **CVEs do Next** só têm correção na linha 15.x (breaking changes).

---

## Onde o plano de vendas está

`plano-implementacao-vendas.md` governa o trabalho. Estado em 03/09/2026:

| Fase | Estado |
|---|---|
| 0 — Fundação (RLS, testes, CI) | ✅ portão fechado |
| 1 — Negócio (`Deal`) | ✅ portão fechado |
| 2 — Contrato | ✅ 4 de 5 (falta a revisão por advogado) |
| 3 — Consultas veiculares e assinatura externa | ⬜ |
| 4 — Crédito e F&I | ⬜ |
| 5 — Obrigações fiscais | ⬜ |

Duas correções ao plano já registradas **dentro dele**:

- O achado nº 9 estava errado: `login`/`entrar` e `signup`/`cadastrar` não são
  duplicatas, são quatro fluxos para dois públicos. Só `settings` e `team` eram
  resíduo (diretórios vazios, removidos).
- O portão da Fase 2 pede que a URL crua devolva 403; ela devolve **404 "Bucket
  not found"**, que é negação mais forte.

---

## Próximos passos sugeridos

1. **Revisão jurídica do template de contrato** — bloqueia uso real
2. **Concluir o Google OAuth** no Console
3. **Fase 3** do plano: consultas veiculares (placa/chassi) com cache por
   custo de chamada, e assinatura externa atrás da interface que já existe
4. **Revisar responsividade** de `/relatorios`, `/agendamentos` e `/equipe`
5. **Seed com negócio faturado**, para os gráficos de margem e giro terem dado
