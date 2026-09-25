# Estado, pendências e próximos passos

> Extraído do [CLAUDE.md](../../CLAUDE.md) em 22/09/2026. Lá fica a regra curta; aqui, o porquê.

## Estado atual de cada módulo

| Módulo | Backend | Frontend | Observações |
|---|---|---|---|
| Auth | ✅ completo | ✅ completo | JWT + Google OAuth + reset senha + verificação email |
| Tenants/Filiais | ✅ completo | ✅ configurações | CRUD completo; desde 23/09/2026 há a seção "Leads e atendimento" (`GET`/`PATCH /crm/settings`): rodízio, prazo de primeiro contato, devolução à fila e carteira do vendedor |
| Usuários/Perfil | ✅ completo | ✅ completo | perfil completo implementado |
| Equipe | ✅ completo | ✅ completo | convites por email com token; desde 23/09/2026 o **plantão** de cada membro (`PATCH /team/members/:id/plantao`, com "ausente até") decide quem o rodízio sorteia |
| Veículos | ✅ completo | ✅ completo | CRUD + upload imagens + busca; desde 23/09/2026 o **anúncio** é separado do estoque (`ListingStatus`: rascunho/publicado/despublicado). Veículo novo nasce em rascunho; publicar exige foto, preço e os campos essenciais (422 diz o que falta) por `POST /vehicles/:id/publish`. Etiqueta, filtro e botão em `/veiculos` e `/veiculos/[id]` |
| Catálogo (marcas/modelos) | ✅ completo | ✅ público | página pública do veículo |
| Leads | ✅ completo | ✅ completo | kanban, timeline, interações, stats; desde 23/09/2026 captura **sem conta** (`POST /leads/public` com consentimento LGPD), cadastro manual pelo vendedor, deduplicação de 30 dias por telefone/e-mail e registro do clique em WhatsApp/telefone. Ainda em 23/09/2026: **rodízio** entre quem está de plantão (anel por data de entrada, ponteiro por loja travado com `SELECT … FOR UPDATE` na mesma transação do lead), **prazo de primeiro contato** em minutos de expediente com etiqueta, filtro, cron de estouro a cada 5 min e `GET /leads/sla-stats`, **carteira do vendedor** (vale em lista, contadores, CSV e detalhe — 404 no lead do colega) e **motivo de perda obrigatório**, com contagem em `/leads/stats` |
| Agendamentos | ✅ completo | ✅ completo | desde 23/09/2026 a loja agenda para quem **não tem conta** (`POST /appointments/dealer`); `customer_user_id` é nulo e o contato fica no próprio agendamento, com a constraint `appointments_tem_contato` |
| Chat | ✅ completo | ✅ completo | Socket.IO tempo real |
| Mapa | ✅ completo | ✅ completo | dark theme, pins animados, sidebar |
| Dashboard | ✅ completo | ✅ completo | KPIs, GalaxyMap |
| Admin | ✅ completo | ✅ completo | impersonation, announcements; desde 22/09/2026 mostra vendas da plataforma (faturado 30 dias/mês em `Decimal`, margem, negócios por grupo, contratos interno × eletrônico, envios de assinatura), **gasto com consulta veicular do mês** (o que a plataforma paga), métricas por loja (faturado, gasto, representante legal, última atividade — em `groupBy`, sem N+1) e sistema com `up`/`down`/`off` (bucket privado, provedor de assinatura, consulta, e-mail, Google, crons da réplica). Corpos e queries em Zod; tela responsiva a 375px, uma aba por arquivo, erro de carga com `ErroAoCarregar` por aba |
| Página pública concessionária | ✅ | ✅ | `/c/[slug]` com chat iniciado pelo cliente; desde 23/09/2026 toda consulta pública (catálogo, detalhe, `/buscar`, `/c/[slug]`, contagem dos pins do mapa, selo) exige `listing_status = 'published'`, e a policy `leitura_publica` repete a regra no banco |
| Relatórios | ✅ completo | ✅ completo | desde 23/09/2026 tem **desempenho por vendedor** (`GET /tenant/reports/salespeople`): leads recebidos e atendidos, agendamentos, comparecimento, negócios ganhos, faturamento, margem e comissão estimada, em cinco consultas agrupadas (sem N+1). Dinheiro só de gerente para cima; o vendedor vê a própria linha, filtrada na consulta. Tempo médio de primeira resposta vem de `/leads/sla-stats` e degrada para "—" se a rota não responder. Exportação CSV de desempenho, negócios e estoque |
| **Negócios (`Deal`)** | ✅ completo | ✅ completo | máquina de estados, pagamento composto, margem em `Decimal`; cancelar e distratar exigem motivo estruturado (`cancel_reason_code`) desde 23/09/2026 |
| **Custo do veículo** | ✅ completo | ✅ completo | aquisição + preparação; base da margem |
| **Contrato** | ✅ completo | ✅ completo | PDF determinístico, hash, assinatura interna |
| **Consulta veicular** | ✅ estrutura | ✅ completo | cache, idempotência e custo; **falta fornecedor real** |
| **Cobrança e bloqueio** | ✅ completo | ✅ completo | camada neutra, faixas por estoque, somente leitura com carência, cron de avisos, painel do super admin; **adaptador Asaas escrito e NÃO exercitado — falta conta** ([decisão](../decisoes/2026-09-25%20cobranca%20e%20bloqueio%20por%20vencimento.md)) |
| **Assinatura externa** | ✅ estrutura | ✅ completo | camada neutra, webhook com HMAC, provedor simulado e adaptador Clicksign (API 3.0, testado no sandbox); **ligado em sandbox; falta assinatura de ponta a ponta e conta de produção** ([decisão](../decisoes/2026-09-22%20assinatura%20externa.md)) |

## Pendências conhecidas

Auditadas em 04/09/2026, contra o repositório.

**Bloqueiam uso real**
- ⚠ **Template de contrato não revisado por advogado.** O sistema emite
  documento com efeito jurídico a partir de um template declarado no código
  como ponto de partida.
- ⚠ **Sem fornecedor de consulta veicular.** Depende de contrato comercial. A
  estrutura está pronta e a API recusa em voz alta enquanto não houver.
- ⚠ **Sem conta na Asaas** (25/09/2026). A camada de cobrança inteira está de
  pé e exercitada com o provedor simulado, mas o adaptador real **nunca falou
  com a Asaas** — nem com o sandbox. Com `COBRANCA_FORNECEDOR` vazio a
  contratação some da tela e o bloqueio por vencimento segue valendo,
  desbloqueado à mão pelo super admin. A lista do que conferir com a conta em
  mãos está no fim da
  [decisão](../decisoes/2026-09-25%20cobranca%20e%20bloqueio%20por%20vencimento.md).
- **Assinatura eletrônica externa ligada em produção, em SANDBOX** (22/09/2026):
  webhook cadastrado com os 7 eventos, `ASSINATURA_FORNECEDOR=clicksign` no
  Railway, boot confirma o adaptador e o webhook recusa HMAC forjado (401).
  Falta: uma assinatura de ponta a ponta para confirmar o cabeçalho do HMAC, o
  link do PDF assinado e o `signer.key` do webhook. Para ter validade: conta de
  produção na Clicksign (URL, token e webhook novos) e revisão jurídica do contrato.

**Da definição de pronto do plano, um item nunca foi cumprido**
- **Feature flag.** O plano pede "feature nova atrás de flag até o piloto
  validar". Nada foi entregue atrás de flag — negócios, contrato e consulta
  entraram direto. Não há infraestrutura de flag no projeto. A assinatura
  externa e a cobrança usam a própria configuração como chave: sem
  `ASSINATURA_FORNECEDOR` nem `COBRANCA_FORNECEDOR`,
  a API responde 503 e a tela esconde a opção.

**Dívidas de infraestrutura**
- ~~**Crons in-process** duplicados com duas réplicas~~ — resolvido em
  22/09/2026: cada execução pega `pg_try_advisory_xact_lock` antes de rodar
  (`modules/tasks/execucao-unica.ts`); a outra réplica loga e pula. A réplica
  que dispara depois de a primeira terminar é coberta pela idempotência dos
  jobs (`reminderSentAt`, alerta de lead frio a cada 6 dias). Limite: a trava
  dura até 50 min — job que passar disso volta a poder se sobrepor (loga aviso).
  Fixado em `test/cron-uma-replica.e2e-spec.ts`.
- **API e banco em regiões diferentes** (`us-east4` ↔ `sa-east-1`), ~0,6s por
  consulta.
- ~~**`SUPABASE_SERVICE_ROLE_KEY` no Railway**~~ — verificada em 22/09/2026: o
  `DocumentosStorage` confere a chave na subida (`getBucket` no bucket privado)
  e o deploy de produção logou `Bucket privado "documentos" acessível.` Chave
  errada passa a aparecer como erro no log de boot.

**Menores**
- ~~**Google OAuth em produção**~~ — resolvido em 22/09/2026: redirect URI já
  registrado; páginas `/termos` e `/privacidade` publicadas e ligadas no
  Branding; app passou de "Testando" para **"Em produção"**. Escopos só
  `email profile`, sem verificação do Google. ⚠ Os dois textos ainda não
  passaram por advogado — entram na mesma revisão do template de contrato.
- **`catch` silenciosos deliberados** (~20): `SeloProcedencia`, autopreenchimento
  de CEP/CNPJ, `localStorage`, prévia do tooltip no mapa, polling dos badges da
  sidebar, "visto recentemente", corações de favorito. Nenhum esconde dado
  que o usuário esperaria ver; cada um tem o porquê comentado no código.
- ~~**Erro engolido no resto do app**~~ — resolvido em 22/09/2026:
  `configuracoes` não abre mais o formulário com valores padrão quando a carga
  falha (salvar sobrescreveria a configuração real); chat e `ChatDrawer`,
  `veiculos` (lista, edição, fotos, histórico de preço, marcas/modelos, FIPE
  no cadastro), `/buscar` (busca de veículos, estoque da loja, filtro de marca,
  buscas salvas, alerta de preço, favorito otimista, painéis do cabeçalho),
  catálogo público (veículo, loja, estoque), editar perfil e `/c/[slug]` (5xx
  deixou de virar 404) mostram a falha.
- ~~**`/relatorios`, `/agendamentos` e `/equipe` em telas pequenas**~~ —
  revisados em 22/09/2026 a 375px, sem rolagem horizontal da página: filtros
  quebram linha, o calendário semanal rola dentro do próprio contêiner, a
  legenda da pizza desce, e os números da equipe aparecem no cartão do membro.
  De quebra: os drawers de agendamento e de membro recebiam a margem do
  `space-y-*` da página e perdiam 20–24px do rodapé (os botões de ação ficavam
  cortados no celular). Verificado com dados simulados no navegador, não com
  a API real.
- ~~**Erro engolido nas 4 telas do painel**~~ — resolvido em 22/09/2026: além
  da carga principal (já com `ErroAoCarregar`), leads deixou de mandar a falha
  só ao console, o histórico do lead e a contagem avisam quando falham, o CSV
  não baixa mais o corpo de um erro como arquivo, e as ações de agendamento,
  membro, meta e convite mostram o erro na tela em vez de `alert` ou silêncio.
- ~~**Relatórios vazios**~~ — resolvido em 22/09/2026 no banco local: o
  `prisma/seed.ts` agora cria, por loja, estoque com aquisição e custos, leads,
  agendamentos, visualizações e 14 negócios em todos os status (7 faturados),
  com datas relativas a hoje (últimos ~90 dias, metade nos últimos 30).
  Reexecutar pula o que já existe; `SEED_DEMO_RESET=1` refaz a operação demo
  com datas novas — sem isso ela envelhece e o filtro de 30 dias volta a ficar
  vazio. O banco de produção **não** foi semeado.
- **CVEs do Next** só têm correção na linha 15.x (breaking changes).

## Onde o plano de paridade de CRM está

`docs/planos/plano-paridade-crm.md`. Estado em 25/09/2026:

| Onda | Estado |
|---|---|
| 0 — o funil não pode vazar | ✅ portão fechado em 23/09/2026 |
| 1 — o que a loja compara na primeira reunião | ✅ itens 6 a 11 fechados em 23/09/2026 |
| 2 — WhatsApp oficial e portais | ⬜ |
| 3 — cobrar | ✅ fechada em 25/09/2026 — **falta conta na Asaas** |
| 4 — o que ninguém tem | ⬜ |

Dívidas que a Onda 0 deixou declaradas:

- **Teto por IP em memória de processo.** Com mais de uma réplica da API, o
  limite efetivo vira `5 × réplicas`. Hoje a API roda em réplica única; se isso
  mudar, é a primeira coisa a revisar (mesma restrição dos crons, que já têm
  `execucao-unica.ts` para o caso deles).
- **Não há listagem de clientes da loja.** O modal de agendamento escolhe o
  cliente pelo lead — quando o lead tem conta, o `customerUserId` vai junto e o
  agendamento aparece no `/perfil` dele. Um cliente com conta e **sem** lead
  nenhum na loja não é alcançável pela tela. Resolver isso pede um endpoint
  novo, e ele tem que respeitar a policy `cliente_relacionado` (a loja vê quem
  tem lead, agendamento ou conversa com ela — não a base inteira).
- **Lead de troca fora da deduplicação**, pelo motivo registrado no plano.

Dívidas que os itens 6 a 9 da Onda 1 deixaram declaradas:

- **O cron do SLA processa 200 leads por rodada.** Uma loja que ligue o prazo
  com centenas de leads antigos vencendo ao mesmo tempo vê os alertas saírem em
  levas de 5 em 5 minutos. O teto existe para a rodada não atrasar a seguinte.
- **O rodízio não conhece férias por filial nem escala por turno.** O plantão é
  um interruptor por pessoa mais um "ausente até" — o suficiente para 2 a 8
  vendedores, que é o alvo. Escala por dia da semana entraria só com demanda.
- **O relógio do SLA usa o expediente de uma filial só** (a do lead, ou a
  primeira ativa). Loja com filiais em fusos diferentes e lead sem filial
  definida cai na primeira — correto para 1 a 3 lojas na mesma região, frágil
  fora disso.
- **A devolução à fila não reatribui.** O lead estourado volta a ficar sem
  responsável e espera alguém pegá-lo no filtro "Sem responsável"; ele não
  entra de novo no rodízio sozinho. Rodar o rodízio ali dentro faria o lead
  circular entre vendedores sem ninguém decidir nada.
- **Só o lead tem contagem por motivo de perda.** O negócio grava
  `cancel_reason_code`, mas nenhuma tela ainda agrupa por ele — o funil de
  valor mostra o motivo no detalhe, não no consolidado.

Dívidas que os itens 10 e 11 da Onda 1 deixaram declaradas:

- **A conferência para publicar usa o que está salvo, não o formulário aberto.**
  Quem digita a cor e clica em "Publicar" sem salvar ainda lê "falta cor". É
  honesto — publicar lê o banco — mas cobra um salvamento a mais.
- ~~**O tempo médio de primeira resposta depende do item 7.**~~ Resolvido em
  23/09/2026: `GET /leads/sla-stats?days=` existe e o relatório consome. A
  degradação visível ("—" quando a rota falha) continua no código, de
  propósito.
- **A exportação CSV tem teto de 5.000 linhas** em negócios e estoque. Loja que
  passar disso exporta um recorte sem aviso — o teto existe para a consulta não
  varrer a base inteira numa região diferente da API.

## Onde o plano de vendas está

`docs/planos/plano-implementacao-vendas.md` governa o trabalho. Estado em 03/09/2026:

| Fase | Estado |
|---|---|
| 0 — Fundação (RLS, testes, CI) | ✅ portão fechado |
| 1 — Negócio (`Deal`) | ✅ portão fechado |
| 2 — Contrato | ✅ 4 de 5 (falta a revisão por advogado) |
| 3 — Consultas veiculares e assinatura externa | 🟡 estrutura pronta nas duas; adaptador Clicksign escrito e testado no sandbox; Clicksign ligada em sandbox; falta fornecedor de consulta e conta de produção da Clicksign |
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

1. **Revisão jurídica do template de contrato, dos Termos e da Política de Privacidade** — bloqueia uso real
2. ~~Concluir o Google OAuth~~ — feito em 22/09/2026
3. **Fase 3** do plano: estrutura pronta — consulta veicular com cache por
   custo de chamada e assinatura externa neutra (22/09/2026). Adaptador Clicksign
   escrito e testado no sandbox (22/09/2026). Falta contratar o fornecedor de
   consulta, validar uma assinatura de ponta a ponta no sandbox (Clicksign já
   ligada em 22/09/2026) e contratar a conta de produção da Clicksign
4. ~~**Revisar responsividade** de `/relatorios`, `/agendamentos` e `/equipe`~~ — feito em 22/09/2026
5. ~~**Seed com negócio faturado**~~ — feito em 22/09/2026 (`SEED_DEMO_RESET=1` renova as datas)
