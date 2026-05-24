# AutoConnect — MVP, Arquitetura e Roadmap

**Versão:** 1.0
**Premissa:** produto SaaS real, multi-tenant, com objetivo de fechar o primeiro cliente pagante em ~12 semanas.

---

## 1. Escopo do MVP (v1)

### 1.1 Princípio de corte
Tudo que **não impede** uma concessionária de vender mais com a plataforma fica pra v2. O MVP precisa fazer um ciclo completo: **cliente vê veículo → fala com vendedor → agenda test drive → fecha negócio rastreado**.

### 1.2 Dentro do MVP

| Módulo | Por que entra |
|---|---|
| **Auth + multi-tenant** | Fundação. Sem isso não tem produto. |
| **Cadastro de concessionária e filiais** | Onboarding mínimo. |
| **Gestão de vendedores** (convite, role, perfil) | Operação interna do tenant. |
| **Catálogo de veículos** (CRUD + fotos + busca + filtros) | Coração da experiência do cliente. |
| **Página pública do veículo** (URL compartilhável) | Vetor de aquisição. |
| **Captura de lead** (formulário no anúncio + atribuição a vendedor) | Sem isso a concessionária não enxerga retorno. |
| **Chat cliente ↔ vendedor** (tempo real, texto + imagem + card de veículo) | Diferencial central da proposta. |
| **Agendamento de test drive** (cliente escolhe slot, vendedor confirma) | Fecha o ciclo de conversão. |
| **Painel operacional básico** (leads do dia, agendamentos, conversas abertas) | Razão de o vendedor abrir o sistema todo dia. |
| **Mapa básico** (filiais no mapa público, vendedores online no painel interno) | Diferencial visível e simples de entregar. |
| **Notificações in-app + email** | Mínimo pra não perder lead. |

### 1.3 Fora do MVP (entra na v2+)

- Notificações WhatsApp/SMS/Push (depende de fornecedor pago — Twilio/Z-API).
- Analytics avançado e relatórios estratégicos (basta painel operacional na v1).
- Mapa em tempo real de localização dos clientes (sensível, complexo, polêmico).
- Comparação de veículos e recomendações automáticas (IA).
- Simulação de financiamento e assinatura digital.
- Avaliação automática de usados.
- App mobile nativo (web responsivo basta na v1).
- Marketplace cross-tenant.
- Integração com ERPs.

### 1.4 Métricas de sucesso da v1

- 3 concessionárias usando em produção até o fim do trimestre.
- Tempo médio de resposta a um lead < 5 min (medido na plataforma).
- Pelo menos 1 venda atribuída ao sistema por cliente/mês.

---

## 2. Arquitetura técnica

### 2.1 Stack final recomendada

| Camada | Escolha | Por quê |
|---|---|---|
| **Backend** | Node.js 20 + TypeScript + **NestJS** | Estrutura modular casa com os domínios do schema; ecossistema maduro; mesma linguagem do frontend. |
| **ORM** | **Prisma** | Tipagem ponta-a-ponta, migrations limpas, suporta o schema atual. |
| **Banco** | **PostgreSQL 15** (Supabase ou Neon no início) | Já decidido. Supabase entrega Auth + Realtime + Storage de bônus e acelera a v1. |
| **Tempo real** | **Socket.IO** (no próprio backend NestJS) | Chat, presença de vendedor, atualização de painel. Simples de operar. |
| **Filas/jobs** | **BullMQ** + Redis | Envio de email, webhooks, processamento de imagem, notificações. |
| **Frontend web** | **Next.js 14** (App Router) + Tailwind + shadcn/ui | SSR pras páginas públicas de veículo (SEO) + DX bom no painel. |
| **State/data** | **TanStack Query** + Zustand | Cache de queries, sincronização com sockets. |
| **Mapa** | **Mapbox GL JS** | Custo previsível, melhor DX que Google Maps. |
| **Storage de imagens** | Supabase Storage ou S3 + CloudFront | Imagens de veículos. |
| **Auth** | Supabase Auth (na v1) ou Clerk; manter `password_hash` no schema como fallback | Acelera muito; troca por solução própria se precisar. |
| **Email transacional** | Resend ou Postmark | Confirmações, convites, agendamentos. |
| **Infra** | Vercel (front) + Fly.io (API + websocket) + Upstash (Redis) | Setup que sai do zero em 1 dia. Migrar pra AWS quando faturar. |
| **CI/CD** | GitHub Actions | Lint, test, build, deploy. |
| **Observabilidade** | Sentry (erros) + Axiom/Better Stack (logs) + Plausible (analytics web) | Mínimo viável. |

### 2.2 Organização do código (monorepo)

```
autoconnect/
├── apps/
│   ├── web/                # Next.js (painel + páginas públicas)
│   └── api/                # NestJS (REST + WebSocket)
├── packages/
│   ├── db/                 # Prisma schema + client compartilhado
│   ├── shared/             # tipos, validações zod, constantes
│   └── ui/                 # componentes shadcn customizados
├── infra/
│   └── (Dockerfiles, fly.toml, scripts)
├── turbo.json              # Turborepo orquestrando build/dev
└── pnpm-workspace.yaml
```

### 2.3 Módulos do backend (NestJS)

Espelhando os domínios do schema:

```
src/modules/
├── auth/              # login, refresh, convites, RLS context middleware
├── tenants/           # CRUD tenant + branches + subscription
├── users/             # users + perfis (salesperson, customer)
├── vehicles/          # estoque, imagens, busca, features, history
├── catalog/           # brands + models (admin global)
├── leads/             # captura, atribuição, timeline
├── appointments/      # disponibilidade + agendamento
├── chat/              # conversations + messages + gateway WebSocket
├── notifications/     # in-app, email (jobs BullMQ)
├── analytics/         # eventos + queries de painel
└── audit/             # interceptor que escreve em audit_log
```

### 2.4 Fluxo de uma requisição (com RLS)

1. Cliente faz request com JWT.
2. `AuthGuard` valida e injeta `{ userId, tenantId, role }` no contexto.
3. `TenantMiddleware` abre transação Prisma e executa `SET LOCAL app.tenant_id = '<uuid>'`.
4. Controller chama service → Prisma → Postgres.
5. RLS no Postgres filtra automaticamente. Vazamento entre tenants é impossível mesmo com bug no código.
6. Resposta volta. Audit log é gravado via interceptor.

### 2.5 Fluxo tempo real (chat)

1. Cliente abre conversa → conecta no namespace Socket.IO `/chat` com JWT.
2. Backend faz `join` na sala `conversation:<id>` se o user é participante.
3. Mensagem é enviada via socket → salva no Postgres → `emit` pra sala.
4. `unread_count_*` é incrementado pra quem não está na sala.
5. Se o destinatário está offline, dispara job de notificação (email).

Presença do vendedor (`salesperson_profiles.presence`): atualizada via heartbeat do socket; ao desconectar, vai pra `offline`.

### 2.6 Tempo real do painel

Mesmo Socket.IO, namespace `/dashboard`. Eventos publicados quando:
- Novo lead → `lead.created`
- Status de lead muda → `lead.updated`
- Agendamento criado → `appointment.created`
- Vendedor muda presença → `salesperson.presence`

Cliente assina os eventos do tenant e atualiza o painel sem refresh.

### 2.7 Infra inicial (custo previsto)

| Serviço | Plano inicial | Custo/mês |
|---|---|---|
| Vercel (Next) | Hobby/Pro | $0–20 |
| Fly.io (API + Redis) | shared-cpu-1x | ~$15 |
| Supabase (Postgres + Auth + Storage) | Free → Pro | $0–25 |
| Mapbox | até 50k loads grátis | $0 |
| Resend | até 3k emails grátis | $0 |
| Sentry | Developer | $0 |
| **Total estimado** | | **~$40/mês** até os primeiros clientes |

---

## 3. Roadmap por sprints (semanais)

Cada sprint = 1 semana. Premissa: 1 dev fullstack focado, ou 2 devs em paralelo (cortam pela metade).

### Sprint 0 — Fundação (semana 1)
- Setup monorepo (Turborepo + pnpm).
- Prisma + migrations a partir do `schema.sql` atual.
- NestJS bootstrap + middleware de tenant + Socket.IO.
- Next.js bootstrap + Tailwind + shadcn + layout base.
- CI básico (lint + typecheck + build).
- Deploy "hello world" em Vercel + Fly.

**Entregável:** ambientes dev/staging no ar, schema migrado.

### Sprint 1 — Auth e onboarding
- Cadastro de concessionária (signup tenant + tenant_admin).
- Login + refresh + middleware RLS.
- Convite de vendedor por email.
- Tela de configurações do tenant (logo, branding, dados).

**Entregável:** uma concessionária consegue se cadastrar e convidar um vendedor.

### Sprint 2 — Catálogo de veículos
- CRUD de veículos (painel interno).
- Upload de imagens (Supabase Storage).
- Lista filtrável + busca textual.
- Página pública do veículo (`/v/[slug]`).
- SEO básico (Open Graph, sitemap).

**Entregável:** vendedor cadastra carro e gera link compartilhável.

### Sprint 3 — Leads e atribuição
- Formulário de interesse na página pública (gera lead).
- Round-robin de atribuição entre vendedores online.
- Inbox de leads no painel.
- Timeline de interações.

**Entregável:** cliente envia interesse → vendedor recebe notificação in-app.

### Sprint 4 — Chat em tempo real
- Modelo de conversa + mensagens (já no schema).
- Socket.IO gateway.
- UI de chat (lista de conversas + thread).
- Compartilhamento de card de veículo na conversa.
- Notificação por email se vendedor offline.

**Entregável:** cliente e vendedor conversam dentro da plataforma.

### Sprint 5 — Agendamento
- Disponibilidade do vendedor (slots semanais).
- Cliente escolhe horário pra test drive na página do veículo.
- Vendedor confirma/recusa no painel.
- Email de confirmação + ICS.

**Entregável:** ciclo completo cliente → lead → chat → test drive agendado.

### Sprint 6 — Painel operacional + mapa básico
- Dashboard com: leads do dia, conversas abertas, agendamentos, vendedores online.
- Mapa público com filiais.
- Mapa interno com vendedores online (presença).

**Entregável:** v1 navegável de ponta a ponta. Pronto pro primeiro cliente real.

### Sprint 7 — Polimento + beta com cliente piloto
- Onboarding guiado.
- Correções do feedback do piloto.
- Documentação básica pro cliente.
- Métricas instrumentadas (eventos analytics).

**Entregável:** cliente piloto em produção pagando (ou em trial).

### Sprints 8+ — Pós-MVP
Em ordem de impacto esperado:
1. WhatsApp via Z-API (lead nunca espera resposta).
2. Relatórios de desempenho (conversão, tempo de resposta).
3. App mobile (React Native, reusando 70% do código).
4. Comparação e recomendação de veículos.
5. Simulação de financiamento (parceria com banco/fintech).

---

## 4. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Socket.IO no Fly não escalar | Média | Sticky sessions + Redis adapter; migrar pra Soketi/Pusher se passar de 1k conexões. |
| Custo de Mapbox explodir | Baixa | Tiles cached + limites diários; fallback pra OpenStreetMap. |
| Storage de imagens caro | Média | Resize obrigatório no upload (3 tamanhos); CDN agressivo. |
| Cliente piloto não engajar | Alta | Onboarding presencial nas duas primeiras semanas; SLA de resposta de bug em <24h. |
| Schema mudar muito no início | Alta | Prisma migrations + ambiente de staging idêntico ao prod desde o dia 1. |

---

## 5. O que cada decisão deste doc destrava

- **MVP cortado:** dá pra começar a codar amanhã sem ficar refinando escopo.
- **Stack fechada:** sem mais paralisia por análise. Tudo Node/TS, um monorepo, infra em 1 dia.
- **Roadmap em sprints:** dá pra mostrar pra investidor/sócio/cliente piloto uma linha do tempo crível.

Quando você quiser, eu já começo o Sprint 0: gero o monorepo, o `prisma/schema.prisma` a partir do `schema.sql`, e subo o esqueleto do NestJS e do Next.js.
