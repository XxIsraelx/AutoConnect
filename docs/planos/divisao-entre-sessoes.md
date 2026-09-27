---
tipo: plano
---

# Divisão do plano entre duas sessões

Combinado em 27/09/2026: o [plano de resolução das pendências](plano-resolucao-de-pendencias.md)
é executado por **duas sessões do Claude em paralelo**. A Onda B fica fora — depende
de advogado e de contas de terceiros.

**O que esta divisão está evitando:** em 27/09/2026 duas sessões mexeram na mesma
regra de cobrança no mesmo dia. O git juntou o texto sem juntar o sentido, três
testes caíram e dois e-mails passaram a nomear o plano errado. Conflito de linha
é barato; conflito de sentido não aparece no `git status`. Por isso a divisão é
por **dono de módulo**, não por onda: cada arquivo tem uma sessão só que escreve
nele.

---

## Quem faz o quê

### Sessão 1 — dinheiro, dados e a casa

| Item | Onde escreve |
|---|---|
| **A2** — sandbox da cobrança visível (aviso no boot + selo na tela) | `modules/cobranca/`, `configuracoes/plano/`, `app/admin/` |
| **A3** — rota morta da FIPE, 4 frases do CLAUDE.md, `suppressHydrationWarning` | `modules/fipe/`, `CLAUDE.md`, `app/layout.tsx` |
| **A1** — cadastrar a variável do Raio-X no Railway e redeployar | Railway (depois dos passos do Israel) |
| **D1** — exportação completa (agendamentos, conversas, clientes) | `modules/relatorios/`, `modules/appointments/`, `configuracoes/` |
| **D3** — motivo de perda consolidado no negócio | `modules/deals/`, `modules/relatorios/`, `negocios/` |
| **D4** — aviso quando o CSV bate as 5.000 linhas | `modules/relatorios/`, telas que baixam CSV |
| **Decisão** — financeiro da loja não vira ERP | `docs/decisoes/` |

### Sessão 2 — os canais (a parte longa)

| Item | Onde escreve |
|---|---|
| **C1** — WhatsApp oficial (API da Meta) | módulo novo `modules/whatsapp/`, `modules/conversations/`, `gateway/chat.gateway.ts`, telas de `/chat` |
| **C2** — ingestão de leads dos portais (OLX primeiro) | módulo novo `modules/portais/`, leitura (só leitura) de `AtribuicaoDeLead` |
| **C3** — push do vendedor (service worker + web-push) | `modules/users/`, `public/sw.js`, `components/` de notificação |

**Comece pela camada neutra, não pela conta.** É como a cobrança e a assinatura
foram feitas: `ProvedorDeWhatsApp` / `FornecedorDePortal` com **simulado**,
webhook autenticado, corpo cru preservado, idempotência por id de evento, e só
depois o adaptador real. Assim a onda inteira é testável antes de existir conta
na Meta ou no portal — e o dia em que a conta chegar, só o adaptador é novidade.

### Depende do Israel (nenhuma das duas sessões faz sozinha)

1. Criar a loja "AutoConnect" em produção pelo cadastro normal (`/signup`).
2. Dar **cortesia** a ela em `/admin › Concessionárias` — senão o trial vence em
   14 dias e o Raio-X para de gravar lead.
3. Passar o `tenant_id` dela para a sessão 1, que cadastra a variável e
   redeploya.
4. Conta de WhatsApp Business (Meta) e uma conta de portal — ou um e-mail de lead
   de verdade para usar de amostra. A sessão 2 avisa quando o adaptador for a
   única coisa que falta.

---

## Regras que valem para as duas

1. **Branch e PR, nunca push direto na `main`.** `claude/sessao-1-<assunto>` e
   `claude/sessao-2-<assunto>`. Antes de abrir o PR: `git fetch` + merge da
   `main`. Foi o push direto que criou a corrida de 27/09.
2. **Não escreva no módulo da outra sessão.** Precisa de algo de lá? Peça no PR
   ou deixe registrado em [estado-e-pendencias](estado-e-pendencias.md); não
   conserte de passagem.
3. **Migrations em faixas separadas de carimbo**, porque duas migrations com o
   mesmo nome de pasta e ordens diferentes em cada máquina é o pior tipo de
   surpresa: **sessão 1 usa `AAAAMMDD10….`**, **sessão 2 usa `AAAAMMDD20….`**.
   Nunca renomeie migration já aplicada em produção.
4. **`schema.prisma`: modelo novo vai no fim do arquivo**, no seu próprio bloco,
   sem reformatar o resto.
5. **`packages/shared`**: sessão 1 mexe em `domain/cobranca.ts` e `domain/deal.ts`;
   sessão 2 cria os arquivos dos canais. Nenhuma edita o do outro — foi
   exatamente aí que o merge de 27/09 doeu.
6. **O portão verde antes de cada push:** `pnpm exec turbo run typecheck lint test`,
   e os e2e sob `autoconnect_app`. Exporte **as duas** variáveis (`DATABASE_URL`
   **e** `DIRECT_URL`) para o banco de teste: a `DIRECT_URL` do
   `packages/db/.env` é **produção**.
7. **A contagem de testes do CLAUDE.md muda no último commit da sua onda**, e vai
   conflitar com a da outra sessão. É o conflito mais bobo do mundo: rode o
   portão de novo depois do merge e escreva o número novo.
8. **Risque só o seu item** em `estado-e-pendencias` e marque o seu na tabela do
   plano de resolução. Achado novo que você não corrigiu vira registro lá, no
   formato da seção — a regra do CLAUDE.md vale para as duas sessões.
9. **Nada de produção sem pedir:** sem `prisma db push`, sem migration rodada à
   mão no Supabase, sem tocar em Railway, Asaas ou Clicksign fora do que está
   escrito aqui.

---

## Prompt para abrir a sessão 2

> Você é a **sessão 2** da divisão descrita em
> `docs/planos/divisao-entre-sessoes.md`. Leia esse arquivo e o
> `docs/planos/plano-resolucao-de-pendencias.md` antes de qualquer coisa.
>
> Sua parte é a **Onda C**: C1 (WhatsApp oficial), C2 (ingestão de leads dos
> portais, OLX primeiro) e C3 (push do vendedor). Comece pela camada neutra com
> provedor simulado, como a cobrança e a assinatura externa foram feitas, para a
> onda ficar testável antes de existir conta na Meta ou no portal.
>
> Respeite as regras da seção "Regras que valem para as duas" — em especial: não
> escreva nos módulos da sessão 1 (`cobranca`, `deals`, `relatorios`, `fipe`,
> `app/admin`, `configuracoes/plano`, `app/layout.tsx`), migrations com carimbo
> `AAAAMMDD20….`, branch própria com PR, e o portão verde antes de push.
