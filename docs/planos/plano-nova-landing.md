---
tipo: plano
data: 2026-09-27
---

# Plano — nova landing de captação

Base: o plano de growth orgânico (Raio-X do atendimento como ímã de leads, WhatsApp e visita
presencial como canais, programa de fundadores) e a pesquisa de landings de concorrentes
(Syonet, Autoconf, Gestor Revenda, DriveCentric, Podium, HubSpot Website Grader) — os dois no
projeto do Claude:
[plano growth](https://claude.ai/code/artifact/6400b7cf-62be-4614-855e-9267f51733f9) ·
[pesquisa e plano completo](https://claude.ai/code/artifact/436563db-f807-4445-b3ab-4d5d9180ce78).
Pendências ligadas a este plano: [estado e pendências](estado-e-pendencias.md), bloco
"Encontradas em 27/09/2026".

## Objetivo

A home deixa de ter uma porta só ("Criar conta grátis") e passa a captar também o dono de loja
que ainda não quer criar conta. Conversão nova: **pedir o Raio-X gratuito do atendimento** — o
Israel testa a loja como cliente oculto e devolve um laudo em 24 h. O cadastro em autosserviço
([decisão de 25/09/2026](../decisoes/2026-09-25%20cadastro%20em%20autosservico.md)) continua na
página: as duas portas convivem.

## Como a home está (27/09/2026)

| Fica | Muda |
|---|---|
| `LandingNav`, maquete do painel (`autoconnect.app/dashboard`), "Como funciona", rodapé com `/termos` e `/privacidade`, modo escuro, cuidado com 375px | Headline genérica ("do jeito certo"); "Buscar veículos" (comprador) no hero; nenhuma captura além do cadastro; nenhum WhatsApp; planos com valores digitados à mão que não batem com `CATALOGO_DE_PLANOS`; "Já tenho conta →" apontando para `/entrar` (login de cliente) |

## Decisões deste plano

- **O Raio-X vira lead dentro do próprio AutoConnect.** Uma loja "AutoConnect" em produção
  recebe os pedidos por `POST /leads/public` com `tenantId`, o mesmo caminho do
  `FormularioDeInteresse`. Ganha de graça o que já existe: consentimento LGPD por cópia,
  deduplicação de 30 dias, honeypot, teto de 5 envios por IP em 10 min, rodízio, prazo de
  primeiro contato e carteira. O Israel vende usando o produto. Não precisa de rota nova no
  Next nem de n8n para capturar (o n8n do plano growth fica opcional, só para planilha).
- **Loja, cargo e origem vão em `message` na primeira versão** (`Loja: … · Cargo: … · Origem:
  …`), sem mudar o schema. Se o volume justificar, viram campos depois.
- **Consentimento próprio do Raio-X.** O texto atual fala "desta concessionária … sobre este
  veículo". O Raio-X precisa de outra frase, que é uma versão nova de consentimento por
  definição (regra da captura de lead no CLAUDE.md).
- **Valores de plano só do shared.** A seção de planos lê `CATALOGO_DE_PLANOS` e
  `DURACAO_DO_TRIAL_DIAS`; nada de R$ digitado na página. O preço em si está pendente.
- **Só prometer o que existe.** Pode: lead sem conta, rodízio entre quem está de plantão,
  prazo de primeiro contato com alerta, carteira do vendedor, agendamento com e sem conta, chat
  (também com visitante anônimo), relatórios por vendedor, negócios com margem, contrato em
  PDF, exportação CSV de leads, estoque, negócios e desempenho. Não pode: integração com
  WhatsApp, consulta veicular (sem fornecedor) e assinatura eletrônica (em sandbox).

## Estrutura da página

| # | Seção | Conteúdo | CTA |
|---|---|---|---|
| 0 | Navbar (`LandingNav`) | Âncoras Como funciona · Planos (+ Fundadores quando existir) · "Entrar" → `/login` | "Criar conta grátis" → `/comecar` (como hoje) |
| 1 | Hero | Headline (testar): "Quanto tempo sua loja leva para responder um cliente no WhatsApp?" · alternativas: "Nenhum cliente sem resposta, do Instagram ao test drive." e "Sua loja perde venda na demora da resposta. O AutoConnect mostra onde — e resolve." Subtítulo: estoque, leads, chat e agendamento num painel só + "Peça o Raio-X gratuito: testamos o atendimento da sua loja como cliente oculto e mandamos o resultado em 24 h." | Formulário do Raio-X · link "ou crie sua conta e teste {DURACAO_DO_TRIAL_DIAS} dias" |
| 2 | Faixa do problema | "42 horas" + "Num estudo da Harvard Business Review com 2.241 empresas dos EUA (2011), a resposta a um lead online levou em média 42 horas. Quem respondeu em até 1 hora teve quase 7 vezes mais chance de qualificar o lead." — é *qualificar*, não *fechar*; não arredondar | — |
| 3 | O que muda na loja | Cards só com o que existe; destaque para prazo de primeiro contato com alerta e rodízio — é a resposta direta ao Raio-X | — |
| 4 | Como funciona | Dois caminhos: (a) Raio-X → laudo → conversa; (b) criar conta → importar estoque (CSV) → atender | — |
| 5 | Produto de verdade | Vitrine de uma loja de demonstração. **Depende** da pendência da loja "Aurora Seminovos" (manter como demo marcada, fora do `/buscar`, ou tirar) | "Abrir vitrine demo" · "Quero ver com o meu estoque" (WhatsApp) |
| 6 | Calculadora de lead perdido | 4 campos com exemplo marcado como exemplo (leads/mês, % respondidos depois de 1 h, taxa de fechamento, lucro por carro). Resultado "até R$ X por mês em risco", sem pedir e-mail | "Descobrir meu tempo real de resposta" → formulário |
| 7 | Fundadores | **Bloqueada** até a decisão do programa (pendência). Quando existir: 5 vagas, contador real, contrapartida | Formulário |
| 8 | Planos | Do `CATALOGO_DE_PLANOS`. **Valores bloqueados** até a decisão de preço | "Criar conta grátis" |
| 9 | Quem está por trás | "Feito em Valinhos, com as lojas da região" + foto + contato direto com o Israel | — |
| 10 | FAQ | Por que é de graça · já uso planilha/outro sistema · e se o AutoConnect acabar (exportação — depende da pendência de exportação completa) · quanto tempo para implantar · meu time vai saber usar · funciona com o WhatsApp da loja (resposta honesta: ainda não integra; o clique em WhatsApp vira registro no lead) | "Tenho outra dúvida" (WhatsApp) |
| 11 | CTA final | Formulário do Raio-X de novo + "Criar conta grátis" + "Já tenho conta →" **`/login`** | — |
| — | Botão flutuante | WhatsApp do Israel em toda a home, mensagem pronta dizendo a seção de origem | — |

## Fases

Cada fase é um commit, com `pnpm --filter web exec tsc --noEmit` (o web tem `noUnusedLocals`),
os testes da API e conferência em 375px.

| Fase | Entrega | Depende de | Como testar |
|---|---|---|---|
| 1. Correções e verdade | "Já tenho conta" → `/login`; "Buscar veículos" sai do hero (já está no rodapé); cards do que existe, com prazo de primeiro contato e rodízio; faixa do problema; `metadata` da home com título, descrição e imagem de prévia (o link vai circular no WhatsApp); botão flutuante de WhatsApp | nada | clicar "Já tenho conta" abre `/login`; mandar o link da home para si mesmo no WhatsApp e ver a prévia; nenhuma promessa da lista "não pode" na página |
| 2. Raio-X | Loja "AutoConnect" criada pelo cadastro normal; `FormularioDeInteresse` aceita texto de consentimento e campos extras por prop (ou um `FormularioRaioX` que o reutiliza); id da loja por variável do web; página `/raio-x?origem=` para o ManyChat e o link da bio | isenção de cobrança da loja AutoConnect (mesma pendência do programa de fundadores) — até lá, super admin estende o trial | `corpos-do-web.spec.ts` cobre o corpo novo; e2e: `POST /leads/public` com o `tenantId` da loja AutoConnect cria lead com o consentimento do Raio-X e `message` com loja/cargo/origem; honeypot preenchido responde sucesso e não grava; sexto envio em 10 min é recusado |
| 3. Produto e calculadora | Seção de vitrine demo; calculadora (componente client, fórmula pura com teste) | decisão sobre a "Aurora Seminovos" | 100 × 30% × 10% × R$ 3.000 = R$ 9.000; `/c/demo` com aviso de demonstração |
| 4. Preço e fundadores | Planos lidos do catálogo; seção de fundadores | decisão de preço e do programa | nenhum R$ digitado em `page.tsx`; teste que monta os planos a partir do catálogo |
| 5. Confiança e medição | Quem está por trás, FAQ, Microsoft Clarity (só com a variável preenchida) e eventos de conversão; `/privacidade` passa a citar o Clarity | foto do Israel | sessão aparece no Clarity; inputs mascarados na gravação |

## Métrica

5% das visitas pedindo Raio-X, criando conta ou clicando no WhatsApp. Mediana de página de
demonstração B2B: 3,1% (Unbounce). Com pouco tráfego, trocar a headline por semana não dá
diferença confiável — comparar só com ~100 visitas por versão.

## Decisões abertas

- Preço e programa de fundadores (pendências de 27/09/2026).
- Loja "Aurora Seminovos" em produção: vitrine demo marcada ou fora.
- Número de WhatsApp comercial (hoje o de `components/landing/config.ts`, com `TODO`).

Fechadas em 27/09/2026: o Raio-X é a porta principal do hero e o cadastro a secundária;
"Quem está por trás" fica fora da página (decisão do Israel).

## Estado (27/09/2026)

| Fase | Estado |
|---|---|
| 1. Correções e verdade | Feita. Planos mostram as faixas de `FAIXAS` **sem valor** até a decisão de preço |
| 2. Raio-X | Feita no código (`RaioXForm`, `mensagemDoRaioX`, `raio-x.e2e-spec.ts`). **Falta em produção:** criar a loja "AutoConnect" pelo cadastro, estender o trial dela e preencher `NEXT_PUBLIC_RAIO_X_TENANT_ID` no web — sem a variável, o formulário vira botão de WhatsApp |
| 3. Produto e calculadora | Feita. "Veja o sistema funcionando" troca a maquete por cinco telas reais do painel e linka a vitrine da Aurora, agora [loja de demonstração](../decisoes/2026-09-27%20loja%20de%20demonstracao.md). Calculadora com `valorEmRiscoEmCentavos` testada |
| 4. Preço e fundadores | Preço feito: a seção de planos mostra os valores do catálogo (tabela de lançamento, [decisão](../decisoes/2026-09-27%20plano%20de%20precos.md)). Falta a seção de fundadores |
| 5. Confiança e medição | FAQ, Clarity (só com `NEXT_PUBLIC_CLARITY_ID`), eventos e `/privacidade` feitos. "Quem está por trás" fora por decisão. ⚠ O Clarity grava cookies com base em legítimo interesse, sem banner de consentimento — confirmar na revisão jurídica |

## Telas do sistema na landing — como refazer

As seis imagens de `apps/web/public/landing/sistema/` (leads, chat, agenda, negócio,
financeiro, relatórios) são capturas do produto, não desenhos. Desde 28/09/2026 saem da
**loja de demonstração** (Aurora Seminovos, `packages/db/prisma/demo.ts`) — a mesma da
vitrine ao vivo que a landing linka —, e não mais do seed. Quando uma dessas telas mudar,
refaça:

1. Banco local **próprio** (nunca o `_test` das suítes, nunca produção), com as duas URLs
   exportadas para ele, e a demo gerada com um relógio de tarde:
   `DEMO_AGORA=2026-09-28T15:40:00-03:00 pnpm --filter @autoconnect/db run demo`. Gerada de
   madrugada, a demo tem "Boa tarde!" à 01:30 e test drive "hoje à 01:14". Use um instante
   **no futuro**: com um no passado, o cron de prazo da API local estoura os leads "no prazo".
2. API local contra esse banco (`node apps/api/dist/main.js` com `DATABASE_URL`, `PORT=4000`,
   `JWT_SECRET` de rascunho e `NODE_ENV=development`) e o web em dev.
3. Chrome headless (`--remote-debugging-port`), 1440×900 com `deviceScaleFactor: 2`, tema
   escuro e `autoconnect:notif-dismissed = 1`; o relógio da página adiantado para o mesmo
   `DEMO_AGORA` (`Page.addScriptToEvaluateOnNewDocument` trocando `Date` por um que soma o
   desvio) — senão "1min atrás" e "Hoje" saem pela hora real. `Page.captureScreenshot` em
   WebP 82. Quem entra em cada uma: leads e agenda como `demo.gerente`; negócio (o **Kicks**,
   com troca e financiamento), relatórios e financeiro como `demo.dono`; o chat como
   `demo.ana`, dona da conversa do Marcelo (logado como outro, as mensagens dela aparecem do
   lado do cliente). No financeiro: aba **Fluxo de caixa**, 30 dias.
4. As três de `apps/web/public/landing/mobile/` (leads, chat, agenda — seção "No celular")
   saem do mesmo roteiro em 390×844, `mobile: true`, `deviceScaleFactor: 2`. Leads como
   `demo.rogerio`, que tem o lead novo com a etiqueta do prazo (a carteira da Ana não tem),
   rolando até a busca — o primeiro cartão fica no alto; chat e agenda como `demo.ana`.
5. O arquivo novo **substitui** o antigo com o mesmo nome. Em produção cada deploy começa
   com o cache de imagem vazio; no `next dev` local, apague `apps/web/.next/cache/images`
   para ver a troca.

Nenhum dado real aparece: nomes, telefones e e-mails são os fictícios da demo
(`@example.com`, celulares `(16) 90000-00xx`).

**Canais fica fora da landing, de propósito**: numa API local o cartão dos portais mostra o
simulador e o aviso de "e-mail de entrada desligado", que não existem em produção, e o do
WhatsApp diz que ele ainda não está ligado — verdade hoje, mas não é o que a vitrine do
produto deve mostrar. Os portais aparecem na legenda de Leads; a notificação, na seção do
celular.
