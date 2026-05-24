# AutoConnect

Plataforma SaaS multi-tenant para concessionárias.

## Stack
- **Backend:** Node.js 20 + TypeScript + NestJS + Prisma + Socket.IO + BullMQ
- **Frontend:** Next.js 14 (App Router) + Tailwind + shadcn/ui + TanStack Query
- **Banco:** PostgreSQL 15 + PostGIS (Supabase recomendado)
- **Infra:** Vercel (web) + Fly.io (api) + Upstash (redis)

## Estrutura

```
autoconnect/
├── apps/
│   ├── api/        # NestJS (REST + WebSocket)
│   └── web/        # Next.js (painel + páginas públicas)
├── packages/
│   ├── db/         # Prisma schema + client compartilhado
│   └── shared/     # Tipos, zod schemas, constantes
├── infra/          # Dockerfiles, fly.toml
├── schema.sql      # DDL canônica (referência)
├── erd.mermaid     # Diagrama ER
└── database-design.md
```

## Pré-requisitos
- Node 20+
- pnpm 9+
- PostgreSQL 15+ com PostGIS (ou Supabase)
- Redis (ou Upstash)

## Setup local

```bash
# 1. Instalar deps
pnpm install

# 2. Configurar env
cp .env.example .env
# editar DATABASE_URL etc.

# 3. Aplicar schema (primeira vez)
psql $DATABASE_URL -f schema.sql
# OU usar Prisma:
pnpm db:push

# 4. Gerar cliente Prisma
pnpm db:generate

# 5. Subir tudo em dev
pnpm dev
```

API sobe em http://localhost:4000, Web em http://localhost:3000.

## Documentação
- `database-design.md` — decisões de schema e RLS
- `mvp-and-architecture.md` — MVP, arquitetura e roadmap por sprints

## Scripts úteis
- `pnpm dev` — roda api + web em paralelo
- `pnpm build` — build de tudo
- `pnpm db:studio` — abre Prisma Studio
- `pnpm db:migrate` — cria nova migration
- `pnpm typecheck` — checa tipos
- `pnpm lint` — lint geral
