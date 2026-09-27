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
| **WhatsApp oficial** | ✅ estrutura | ✅ completo | desde 27/09/2026 (sessão 2, item C1): camada neutra com provedor simulado, webhook com HMAC do corpo cru e idempotente, cliente que escreve vira lead pelo caminho do formulário (dedupe, rodízio, prazo), resposta pelo chat com a janela de 24 h conferida na API, modelos aprovados, status de entrega, uso do mês em **Canais**. **Adaptador da Meta escrito e NÃO exercitado — falta a conta** ([decisão](../decisoes/2026-09-27%20whatsapp%20oficial.md)) |
| **Leads dos portais** | ✅ estrutura | ✅ completo | desde 27/09/2026 (sessão 2, item C2): endereço de entrada por loja e portal (URL de webhook e e-mail de encaminhamento, token só em hash), entregas guardadas cruas e reprocessáveis, formato AutoConnect no webhook e leitor genérico de e-mail com rótulos, código de confirmação do Gmail na tela, lead pelo caminho do formulário com origem `portal`. **Falta a conta do e-mail de entrada (Postmark) e uma notificação real da OLX** ([decisão](../decisoes/2026-09-27%20leads%20dos%20portais.md)) |
| **Push do vendedor** | ✅ completo | ✅ completo | desde 27/09/2026 (sessão 2, item C3): Web Push com VAPID pelo service worker (sem app de loja), lead novo para o vendedor da vez (ou a gerência, sem responsável), mensagem do cliente para quem cuida da conversa, aparelho que muda de dono, logout que desinscreve. Verificado de ponta a ponta com o serviço de push real. **Falta só cadastrar as chaves VAPID no Railway** ([decisão](../decisoes/2026-09-27%20push%20do%20vendedor.md)) |

## Pendências conhecidas

Auditadas em 04/09/2026, contra o repositório. Revistas item por item em
27/09/2026, contra o código e a produção.

> **A ordem de resolução mora em [plano de resolução das pendências](plano-resolucao-de-pendencias.md)**
> — aqui fica o registro de cada achado; lá, em que onda ele entra, o custo e de
> quem depende. Item resolvido é riscado aqui e marcado lá.

**Como registrar** (regra em [CLAUDE.md](../../CLAUDE.md), seção "Estado do projeto"):
achou e não resolveu na mesma tarefa, registra aqui antes de encerrar. Cada item diz
**onde** (arquivo:linha, rota, tela ou comando), **o que é**, **evidência** (saída de
comando, consulta, trecho de código), **impacto**, **sugestão de correção**, **como
testar** e **quando, quem e em qual tarefa** encontrou. Resolvido: riscar com `~~…~~`
e anotar "resolvido em DD/MM/AAAA" e o commit — como os itens abaixo já fazem.

**Bloqueiam uso real**
- ⚠ **Template de contrato não revisado por advogado.** O sistema emite
  documento com efeito jurídico a partir de um template declarado no código
  como ponto de partida.
- ⚠ **Sem fornecedor de consulta veicular.** Depende de contrato comercial. A
  estrutura está pronta e a API recusa em voz alta enquanto não houver.
- ~~**Sem conta na Asaas**~~ (25/09/2026) — **resolvido em 27/09/2026**: a conta existe,
  `COBRANCA_FORNECEDOR`, `ASAAS_API_KEY`, `ASAAS_API_URL`, `COBRANCA_WEBHOOK_TOKEN` e
  `ASAAS_SAQUE_TOKEN` estão no Railway, e o adaptador **já falou com a Asaas de verdade**: o
  Israel contratou o Essencial na loja `autohaus` em produção, a assinatura e a fatura nasceram
  no gateway e o super admin as cancelou pelo `/admin`. O boot de 27/09/2026 não traz nenhum
  `cobrança desligada` nem `ASAAS_SAQUE_TOKEN ausente`. **Continua em aberto** saber se a chave
  é de produção ou de sandbox — ver o item "O sandbox da cobrança é invisível", abaixo. A lista
  do que conferir está no fim da
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

**Encontradas em 27/09/2026** — Claude Cowork, ao revisar o plano da nova landing

- ✅ **Resolvido em 27/09/2026** ([decisão](../decisoes/2026-09-27%20plano%20de%20precos.md): tabela de lançamento no catálogo, lida também pela landing). **Preço sem decisão: três tabelas diferentes.**
  - Onde: `apps/web/src/app/page.tsx` (seção Planos), `packages/shared/src/domain/cobranca.ts`
    (`CATALOGO_DE_PLANOS`) e o programa de fundadores (combinado fora do repositório em 22/09/2026).
  - O que é: a home anuncia Trial de 14 dias com "até 10 veículos, 1 usuário" e Pro a R$ 297
    com "até 5 usuários". A cobrança cobra Essencial R$ 279 (até 30 veículos), Crescimento
    R$ 479 (até 80) e Profissional R$ 799 (ilimitado), com usuários ilimitados, e o trial roda
    com o teto de 30 veículos. O programa de fundadores fala em 5 lojas grátis no "Pro como é
    hoje", R$ 197 travado da 6ª loja em diante e R$ 297 como preço público.
  - Evidência: `grep -n "R\$ 297" apps/web/src/app/page.tsx`; `CATALOGO_DE_PLANOS` em
    `cobranca.ts`; [decisão de cobrança](../decisoes/2026-09-25%20cobranca%20e%20bloqueio%20por%20vencimento.md).
  - Impacto: a loja lê um preço na home e recebe outro na cobrança. O rascunho do termo de
    fundador promete "até 5 usuários" de um plano que não existe mais. E a home fura a regra de
    `cobranca.ts` de que os valores moram só ali.
  - Sugestão: decidir (o Israel adiou em 27/09/2026) e registrar em `docs/decisoes/`. A home
    passa a ler `CATALOGO_DE_PLANOS` e `DURACAO_DO_TRIAL_DIAS` do shared em vez de texto fixo.
  - Como testar: nenhum valor em R$ digitado à mão em `page.tsx`; teste que monta os planos da
    home a partir do catálogo.
- ◐ **Em parte em 27/09/2026** ([decisão](../decisoes/2026-09-27%20plano%20de%20precos.md): a isenção existe — cortesia concedida pelo super admin, com motivo `fundadora` ou `interna`; falta o termo do programa refletir o Crescimento). **Programa de fundadores não existe no repositório.**
  - Onde: nenhum arquivo — buscar "fundador" em `docs/`, `apps/` e `packages/` não retorna nada.
  - O que é: combinado em 22/09/2026 — 5 lojas não pagam nunca pelo plano, com cadastro do
    estoque e treinamento feitos pelo Israel, em troca de feedback, depoimento e indicação. Não
    há decisão registrada nem jeito de marcar uma loja como isenta.
  - Impacto: a loja fundadora cai no trial de 14 dias e fica somente leitura quando ele vence
    (`avaliarCobranca`). Hoje só o super admin estendendo o trial à mão evita isso.
  - Sugestão: nota em `docs/decisoes/` e uma isenção explícita (plano ou marca de cortesia que
    `avaliarCobranca` respeite), com teste. Depende do item de preço.
  - Como testar: loja fundadora com trial vencido continua escrevendo; loja comum no mesmo
    estado é bloqueada.
  - Também afeta: a loja "AutoConnect" que recebe os pedidos de Raio-X no
    [plano da nova landing](plano-nova-landing.md) precisa da mesma isenção.
- ✅ **Resolvido em 27/09/2026** ([decisão](../decisoes/2026-09-27%20loja%20de%20demonstracao.md): loja de demonstração, fora da busca e do mapa). **Loja fictícia em produção aparece para compradores reais.**
  - Onde: tabela `tenants`, slug `demo` ("Aurora Seminovos"); `/buscar`, o mapa e `/c/demo`.
  - O que é: 25 veículos, 22 publicados, `created_at` em 04/10/2024. Contradiz a nota acima de
    que o banco de produção não foi semeado.
  - Evidência: no Supabase de produção em 27/09/2026,
    `select t.slug, v.listing_status, count(*) from vehicles v join tenants t on t.id = v.tenant_id group by 1, 2`
    → `demo`: 22 published e 3 draft; `autohaus`: 3 published.
  - Impacto: comprador de verdade pode mandar lead ou agendar test drive com uma loja que não
    existe, e o lojista em prospecção vê uma "concorrente" falsa no mapa.
  - Sugestão: decidir entre manter como vitrine de demonstração (fora do `/buscar` e do mapa,
    com aviso "loja de demonstração" em `/c/demo`) ou tirar (`is_active = false`). Descobrir como
    ela foi criada.
  - Como testar: `/buscar` e o mapa de produção sem a Aurora; `/c/demo` com o aviso, se ficar.
- ~~**"Já tenho conta →" da home leva o lojista ao login de cliente.**~~ — resolvido em
  27/09/2026 (`2835e34`, na fase 1 da nova landing): o CTA vive em
  `components/landing/CtaFinal.tsx` e aponta para `/login`. Conferido no HTML servido em
  produção em 27/09/2026 — `/entrar` só aparece no rodapé, como "Área do cliente".
- ~~**Exportação dos dados da loja incompleta**~~ — **resolvida em 27/09/2026**: entraram
  `appointments.csv`, `conversations.csv` e `messages.csv` (uma linha por mensagem, com o
  texto), todos com o recorte de carteira do resto do painel e reunidos em
  *Configurações › Levar seus dados*, ao lado dos quatro que já existiam. O teto de 5.000
  linhas passou a **avisar dentro do arquivo** quando corta. **Falta a lista de clientes
  vinculados**, que sai junto com o item D2 (listagem de clientes da loja) — as duas leem a
  mesma relação, e duas consultas diferentes discordariam. **Completado no mesmo dia:**
  `customers.csv` entrou junto com o modo "Cliente da loja" do agendamento, os dois lendo
  `common/clientes-relacionados.ts`.
  - Onde: `GET /leads/export/csv` e, em `relatorios.controller.ts`, `salespeople.csv`,
    `deals.csv`, `inventory.csv`, `appointments.csv`, `conversations.csv`, `messages.csv` e
    `customers.csv`.
  - Reunidas em *Configurações › Levar seus dados*.
  - Impacto: o rascunho do termo de fundador (cláusula 6) e a portabilidade da LGPD pedem que a
    loja leve todos os seus dados; hoje ela não consegue.
  - Sugestão: CSV de agendamentos e de conversas no padrão de `relatorios`, ou um ZIP único em
    `/configuracoes`, sempre dentro de `withTenant`.
  - Como testar: e2e que baixa cada CSV com dois tenants e confirma que nenhum vaza dado do
    outro; abrir no Excel e conferir os acentos.

- ~~**E-mail de contato num domínio que talvez não exista**~~ — resolvido em
  27/09/2026: `CONTATO_SUPORTE` no shared, um lugar só, apontando para o
  endereço de suporte real. O domínio `autoconnect.app` nunca foi nosso.
  - Onde: `apps/web/src/components/PaginaLegal.tsx:5` (`CONTATO_LEGAL`, usado em `/termos` e
    `/privacidade`), `components/ErroAoCarregar.tsx:7` (`SUPORTE`),
    `components/AvisoDeEnvioDeFotos.tsx:32` e o plano Enterprise da home (`page.tsx:245`). A
    maquete da home também mostra `autoconnect.app/dashboard`.
  - O que é: produção roda em `autoconnectweb-production.up.railway.app` (CLAUDE.md, "Deploy") e
    o domínio próprio ainda não foi registrado segundo o plano growth; o e-mail do negócio em uso
    é `suporte.autoconnect@gmail.com`.
  - Evidência: `grep -rn "autoconnect\.app" apps/web/src` em 27/09/2026. Não deu para checar o
    DNS daqui (sem rede no ambiente).
  - Impacto: se o domínio não for seu, o canal do titular da LGPD em `/privacidade`, o contato
    dos Termos e o "fale com o suporte" das telas de erro mandam e-mail para o vazio — e alguém
    pode registrar o domínio e receber essas mensagens.
  - Sugestão: confirmar se `autoconnect.app` é seu. Se não for, registrar o domínio escolhido
    (`.app` ou `.com.br`) com e-mail funcionando, ou trocar as quatro ocorrências por
    `suporte.autoconnect@gmail.com` numa constante só no shared.
  - Como testar: mandar um e-mail para o endereço exibido em `/privacidade` e recebê-lo; `grep`
    sem endereço fixo fora da constante.
  - Encontrado em: 27/09/2026 · Claude Cowork · ao planejar o próximo passo do plano growth.

- ~~**CLAUDE.md com frases desatualizadas.**~~ — resolvidas em 27/09/2026: a do trial, as três da Asaas e a contagem de testes (1.081: 778 na API, 303 no shared).
  - Onde: `CLAUDE.md`, seção "Cadastro de loja e primeiro acesso" (linha do trial) e seção
    "Testes e CI" (contagem de testes).
  - O que é: diz "⚠ Nada acontece quando o trial vence — bloqueio é a Onda 3" (linha 451), mas
    a Onda 3 está fechada e a seção "Cobrança e bloqueio por vencimento" do mesmo arquivo diz
    "Trial vencido bloqueia na hora". ~~E cita 1.036 testes~~ — a contagem foi corrigida em
    27/09/2026 (1.076: 773 na API, 303 no shared).
  - **Mais três frases desatualizadas, achadas na auditoria de 27/09/2026**, todas sobre a
    Asaas, agora que a conta existe e o adaptador já cobrou em produção: a tabela do Stack diz
    "adaptador não exercitado" (linha 21), a seção de cobrança diz "⚠ **O adaptador da Asaas
    nunca falou com a Asaas**" (linha 595) e "Estado do projeto" lista "**ausência de conta na
    Asaas**" como bloqueio de uso real (linha 798).
  - Evidência: `grep -n "Nada acontece quando o trial" CLAUDE.md`; saída do
    `pnpm exec turbo run typecheck lint test` na branch `claude/emails-corporativos`.
  - Impacto: quem lê só a seção de cadastro conclui que o trial não bloqueia e pode escrever
    código ou texto de venda assumindo isso.
  - Sugestão: trocar a frase por "Trial vencido bloqueia — ver *Cobrança e bloqueio por
    vencimento*" e atualizar a contagem.
  - Como testar: `grep` sem "Nada acontece quando o trial"; a contagem bate com a saída do portão.
  - Encontrado em: 27/09/2026 · Claude Code · na tarefa da seção "No celular" da landing.

- ~~**Aviso de hidratação no `<html>` em toda página, no modo dev.**~~ — resolvido em 27/09/2026 com `suppressHydrationWarning` no `<html>`, que é o uso previsto para script de tema.
  - Onde: `apps/web/src/app/layout.tsx` (`SCRIPT_TEMA` e `<html lang="pt-BR">`).
  - O que é: o script de tema roda antes do React e põe `class="dark"` e `style="color-scheme"`
    no `<html>`; o HTML do servidor não os tem, e o React avisa "Extra attributes from the
    server: class,style" a cada carga.
  - Evidência: console do navegador em `http://localhost:3000/` com `pnpm dev`.
  - Impacto: só ruído no console de desenvolvimento (em produção o React não avisa e mantém os
    atributos) — mas o ruído esconde aviso de hidratação de verdade quando aparecer um.
  - Sugestão: `<html lang="pt-BR" suppressHydrationWarning>`, que é o uso previsto para
    script de tema; vale só para os atributos do próprio `<html>`, não para os filhos.
  - Como testar: recarregar a home em dev e o console não trazer mais o aviso.
  - Encontrado em: 27/09/2026 · Claude Code · ao verificar a moldura do celular na landing.

**Encontradas em 27/09/2026** — Claude Code, na auditoria de pendências pedida depois do
conserto do plano pendente de pagamento

- **Três `NEXT_PUBLIC_*` da landing não existem no serviço web do Railway.**
  - Onde: serviço `@autoconnect/web`, ambiente `production`. Faltam
    `NEXT_PUBLIC_RAIO_X_TENANT_ID`, `NEXT_PUBLIC_CLARITY_ID` e `NEXT_PUBLIC_SITE_URL` —
    as três estão documentadas em [CLAUDE.md](../../CLAUDE.md) e lidas por
    `components/landing/RaioXForm.tsx:27`, `components/landing/Clarity.tsx:22` e
    `app/(landing)/page.tsx:29`.
  - O que é: sem o id da loja, o formulário do Raio-X **não aparece** — o pedido cai no
    `wa.me`, que é o fallback deliberado do código. Sem o id do Clarity, nada é medido. O
    `NEXT_PUBLIC_SITE_URL` tem fallback embutido (`https://autoconnectapp.com.br`) e não
    quebra nada hoje.
  - Evidência: a lista de variáveis do serviço web no Railway em 27/09/2026 não traz nenhuma
    das três; o HTML servido em `https://autoconnectapp.com.br/` tem 8 ocorrências de `wa.me`
    e zero de `clarity`.
  - Impacto: a captação principal da nova landing está no caminho alternativo, e o funil que
    justificaria o Raio-X não é medido. Como `NEXT_PUBLIC_*` é embutida no **build**, cadastrar
    a variável só vale com um deploy novo depois dela.
  - Sugestão: criar a loja "AutoConnect" em produção (cadastro normal) e cadastrar o
    `tenant_id` dela; decidir se o Clarity entra agora. A loja precisa da **cortesia** do super
    admin, senão o trial dela vence em 14 dias e o Raio-X para de gravar lead.
  - Como testar: a home passa a mostrar o formulário em vez do botão de WhatsApp, e um pedido
    de teste vira lead na loja "AutoConnect".
  - Encontrado em: 27/09/2026 · Claude Code · na auditoria de pendências.

- ~~**`GET /fipe/variantes` não tem quem chame**~~ — **resolvido em 27/09/2026** ligando a tela nela, e não apagando: com confiança alta a estimativa devolve `alternativas: []` de propósito, e o lojista que discordava da escolha ficava sem menu nenhum. `/veiculos/novo` ganhou "Não é este o seu carro? Ver todas as versões", que carrega a lista sob demanda (erro aparece no card, não no console).
  - Onde: `apps/api/src/modules/fipe/fipe.controller.ts:49`.
  - O que é: a rota existe, é validada por Zod e ninguém a chama — nem tela, nem teste. A
    tela de cadastro de veículo usa `/fipe/estimate`, que já devolve `alternativas` no mesmo
    corpo; o `select` de variante é alimentado por ali.
  - Evidência: cruzamento das 165 rotas dos controllers com todas as chamadas do `apps/web` em
    27/09/2026 — sobraram 5, quatro delas legítimas (callback do Google e os três webhooks) e
    esta. `grep -rn "fipe/variantes" apps/api/test apps/web/src` não retorna nada.
  - Impacto: código morto numa rota autenticada — ou funcionalidade pensada e nunca ligada. As
    duas merecem decisão, não silêncio.
  - Sugestão: apagar a rota (o método do serviço continua sendo usado pelo `estimate`), ou
    ligar a tela nela quando a lista precisar ser recarregada sem refazer a estimativa.
  - Como testar: o cruzamento rota × chamada volta a ter só as 4 legítimas.
  - Encontrado em: 27/09/2026 · Claude Code · na auditoria de pendências.

- ~~**O sandbox da cobrança é invisível**~~ — **resolvido em 27/09/2026**, e com uma
  correção ao próprio achado: **o aviso no boot já existia**
  (`cobranca/provedor.ts`, "Asaas em SANDBOX com NODE_ENV=production: nada será
  cobrado de verdade"). O que faltava era no produto — e a ausência dele em
  produção **prova que a chave é de produção**: a fatura da `autohaus` foi dinheiro
  de verdade. O que entrou: a cobrança passou a aparecer na aba Sistema do
  `/admin` (era o **único** serviço externo fora do painel, e é o que tira dinheiro
  da conta), por `estadoDaCobrancaNoPainel`, com teste das cinco respostas; e a
  tela do plano mostra um aviso de homologação quando o gateway é sandbox e não é
  o simulado (que já tem seção própria).
  - Onde: `apps/api/src/modules/cobranca/provedor-asaas.ts:204` (`this.sandbox` sai da URL),
    `cobranca.service.ts:143` (vai no `GET /cobranca`) e
    `app/(dashboard)/configuracoes/plano/page.tsx:46` (`sandbox: boolean` **declarado e nunca
    renderizado** — só `simulado` aparece na tela).
  - O que é: a assinatura externa avisa duas vezes quando está em sandbox com
    `NODE_ENV=production` (log de boot em `assinatura/provedor.ts:103` e selo na tela); a
    cobrança não avisa em lugar nenhum. Uma chave de sandbox em produção cobraria ninguém, em
    silêncio.
  - Evidência: o boot de 27/09/2026 traz `Clicksign em SANDBOX com NODE_ENV=production` e
    **nenhuma** linha equivalente para a Asaas; `grep -rn "\.sandbox" apps/web/src` não
    retorna nada.
  - Impacto: a diferença entre "a loja pagou" e "a loja fingiu pagar" não aparece em nenhum
    log nem em nenhuma tela. Também impede conferir a pendência acima sem abrir o painel do
    Railway.
  - Sugestão: repetir o padrão da assinatura — `log.warn` no boot quando a URL tem `sandbox` e
    `NODE_ENV=production`, e selo na tela do plano e na aba Sistema do `/admin`.
  - Como testar: subir com `ASAAS_API_URL=https://api-sandbox.asaas.com` e
    `NODE_ENV=production` e ver o aviso no boot; a tela do plano mostrar o selo.
  - Encontrado em: 27/09/2026 · Claude Code · na auditoria de pendências.

**Encontradas em 27/09/2026** — Claude Code (sessão 2), ao fazer o WhatsApp oficial (C1)

- **A mensagem do vendedor no chat do sistema não para o prazo de primeiro contato.**
  - Onde: `apps/api/src/gateway/chat.gateway.ts` (`onSend`, ramo que não é WhatsApp) e
    `packages/shared/src/domain/sla.ts` (`INTERACOES_DE_PRIMEIRA_RESPOSTA`, que inclui `chat`).
  - O que é: o comentário do `sla.ts` diz que a mensagem do vendedor no chat conta como
    primeira resposta, mas nenhum caminho a registra: o gateway grava a mensagem e não cria a
    interação nem chama `SlaService.registrarPrimeiraResposta`.
  - Evidência: `grep -rn registrarPrimeiraResposta apps/api/src` só acha
    `LeadsService.addInteraction` (a interação registrada à mão) e o WhatsApp novo.
  - Impacto: o vendedor que responde o lead pelo chat do sistema aparece com o prazo
    estourado, e o relatório de tempo de resposta conta contra ele.
  - Sugestão: no `onSend`, para mensagem da equipe numa conversa com `leadId`, fazer o que
    `WhatsappService.gravarSaida` faz — interação `chat` na primeira mensagem da conversa e
    `registrarPrimeiraResposta(..., 'chat')`. O gateway é da sessão 2; não corrigido aqui
    para não misturar com o C1.
  - Como testar: e2e do gateway — lead com prazo, vendedor escreve pelo socket,
    `first_responded_at` preenchido e uma interação `chat` na timeline.
  - Encontrado em: 27/09/2026 · Claude Code (sessão 2) · no item C1.

- **O lembrete de agendamento ainda não sai pelo WhatsApp.**
  - Onde: o modelo existe (`lembrete_agendamento` em `MODELOS_DE_WHATSAPP`), mas o cron de
    lembretes vive em `modules/appointments/`, que é da sessão 1 (item D1).
  - O que é: o item 12 do plano de paridade pede "modelos aprovados para lembrete de
    agendamento"; o envio automático não foi ligado para não escrever no módulo da outra
    sessão.
  - Impacto: o lembrete continua só por e-mail — e o agendamento sem conta, que é o comum,
    muitas vezes não tem e-mail (o cron pula).
  - Sugestão: depois do D1, o cron chama `WhatsappService.enviarModelo` (ou um método novo
    que abra a conversa pelo telefone do agendamento) quando a loja tem número conectado.
  - Como testar: agendamento amanhã com telefone e sem e-mail → o cron manda o modelo e
    marca `reminderSentAt`.
  - Encontrado em: 27/09/2026 · Claude Code (sessão 2) · no item C1.

- **Foto, áudio e documento do cliente entram só como aviso.**
  - Onde: `apps/api/src/modules/whatsapp/whatsapp.service.ts` (`aplicarMensagem`).
  - O que é: a mensagem de mídia vira "o cliente enviou um áudio — abra no WhatsApp", com a
    legenda. Baixar exige chamar a Meta pelo id da mídia e guardar o arquivo.
  - Impacto: a foto do carro de troca, comum na negociação, não aparece no sistema.
  - Sugestão: quando houver conta, baixar pela Graph API e guardar no bucket privado do
    Supabase (mídia do cliente não é pública como a foto do anúncio).
  - Como testar: cliente manda foto → a conversa mostra a imagem por URL assinada.
  - Encontrado em: 27/09/2026 · Claude Code (sessão 2) · no item C1.

**Encontrada em 27/09/2026** — Claude Code (sessão 2), ao fazer o push do vendedor (C3)

- **O agendamento pedido pelo cliente não gera push.**
  - Onde: `apps/api/src/modules/appointments/` (sessão 1) e `app/(dashboard)/layout.tsx`
    (`useLeadsBadge`, que ainda avisa "Novo agendamento" com a aba aberta).
  - O que é: o push cobre lead novo e mensagem do cliente; o agendamento feito pelo cliente
    no site só aparece no contador do menu e no aviso da aba aberta.
  - Impacto: o test drive pedido pelo site fica sem confirmação até alguém abrir o painel —
    menor que o lead (o cliente já está engajado), mas é o mesmo "vendedor no pátio".
  - Sugestão: no ponto em que o agendamento do cliente é criado, chamar
    `PushService.avisarLeadNovo`-como (um `avisarAgendamento` novo no `PushService`) para o
    vendedor do agendamento ou a gerência. Não feito aqui para não escrever no módulo de
    agendamentos, que é da sessão 1 (item D1).
  - Como testar: e2e — cliente agenda pelo site, o vendedor com aparelho inscrito recebe o aviso.
  - Encontrado em: 27/09/2026 · Claude Code (sessão 2) · no item C3.

**Lacunas frente ao mercado** — Claude Cowork, 27/09/2026, na pesquisa de preços
([plano de preços](https://claude.ai/code/artifact/daf7ac7d-5114-4621-9028-3759dbb07be8)).
O que os concorrentes com preço público entregam e o AutoConnect não. Várias já estão num
plano; entram aqui porque **pesam no preço**: o desconto proposto sobre a média do mercado
existe por causa delas, e a tabela só sobe quando as duas primeiras existirem.

- **Integração com portais de anúncio — publicar o estoque e receber os leads.**
  - Onde: não existe módulo. Publicação automática é o item 22 da Onda 5 (sem estimativa) e a
    entrada de leads dos portais é o item 13 da Onda 2, ambos no
    [plano de paridade](plano-paridade-crm.md).
  - O que é: o lojista cadastra o carro uma vez e ele aparece em OLX, Webmotors, iCarros e
    Mercado Livre; o lead que chega por lá entra no funil sozinho.
  - Evidência: Auto Adm inclui "60+ portais" em todos os planos, a partir de R$ 249; o Basic
    da Autoconf (R$ 299) já tem integrador; o Pro da ecosys AUTO publica em vários portais. No
    [levantamento](levantamento-crms-e-paridade.md), 13 de 15 produtos captam lead de portal.
  - Impacto: é o que o lojista mais paga num sistema de revenda e o primeiro item que ele
    compara. Sem isso o AutoConnect precisa cobrar bem abaixo da média, e loja que já usa
    integrador não troca.
  - Sugestão: começar pela entrada de leads (item 13), que é ingestão; para publicar, avaliar
    um integrador terceiro em vez de uma API por portal. A decisão 3 do plano de paridade
    (quais portais primeiro) depende de onde as lojas fundadoras anunciam — perguntar na
    implantação.
  - Como testar: carro publicado no AutoConnect aparece no portal em até N minutos e some ao
    ser vendido; lead de teste enviado pelo portal cai no funil com a fonte certa e no vendedor
    de plantão.
  - **Situação em 27/09/2026:** a **entrada** está pronta (item C2, sessão 2) — endereço por
    loja e portal, webhook e e-mail, testada com o provedor simulado; falta a conta do e-mail
    de entrada e uma notificação real da OLX. A **publicação** continua sem módulo. Ver a
    [decisão](../decisoes/2026-09-27%20leads%20dos%20portais.md).
- ◐ **Emissão de nota fiscal (NF-e) — adiada por decisão em 27/09/2026** ([plano de resolução](plano-resolucao-de-pendencias.md#adiado-por-decisão)). A contradição entre os dois planos deixou de existir: os dois apontam para o adiamento.
  - Onde: não existe módulo. O [plano de vendas](plano-implementacao-vendas.md), Fase 5,
    prevê NF-e via emissor terceiro (Focus NFe, NFe.io, Tecnospeed); o
    [plano de paridade](plano-paridade-crm.md), em "O que este plano deliberadamente não faz",
    diz que NF-e fica fora.
  - O que é: emitir a nota de entrada e de saída do veículo a partir do negócio fechado.
  - Evidência: Auto Adm inclui NF-e em todos os planos; na Autoconf entra no Pro (R$ 499); o
    guia de preços da Autoconf põe NF-e já na faixa básica de mercado (R$ 199 a R$ 399).
  - Impacto: loja que emite nota no sistema atual precisa de um segundo sistema para usar o
    AutoConnect — é um motivo para não trocar. E hoje ninguém sabe qual dos dois planos vale.
  - Sugestão: decidir e corrigir o plano que perder; se entrar, emissor terceiro como a Fase 5
    já descreve, com o negócio (`Deal`) como origem dos dados da nota.
  - Como testar: negócio faturado em homologação do emissor gera NF-e autorizada com os dados
    do comprador e do veículo; cancelamento dentro do prazo legal funciona.
- **WhatsApp oficial dentro do sistema.**
  - Onde: item 12 da Onda 2 do plano de paridade; hoje só link `wa.me`, e o clique vira
    interação no lead.
  - Evidência: 11 de 15 produtos no levantamento; WhatsApp oficial no Pro da ecosys AUTO; a
    Autoconf vende um plano de agente de IA no WhatsApp a R$ 1.199.
  - Impacto: a conversa com o cliente fica fora do sistema, e com ela o histórico e a medição
    do tempo de resposta — que é o argumento central do Raio-X.
  - Sugestão: seguir o item 12; decidir antes a decisão 2 do plano de paridade (a API da Meta
    cobra por conversa: embutido no preço ou adicional).
  - Como testar: mensagem enviada ao número da loja aparece na caixa do vendedor de plantão, e
    a resposta dele sai pelo WhatsApp e conta no prazo de primeiro contato.
  - **Situação em 27/09/2026:** a estrutura inteira está pronta e testada com o provedor
    simulado (o "como testar" acima passa em `test/whatsapp.e2e-spec.ts`); falta a conta na
    Meta e a decisão 2. Ver a [decisão](../decisoes/2026-09-27%20whatsapp%20oficial.md).
- **App do vendedor com notificação.** — ◐ push pronto em 27/09/2026 (item C3, sessão 2);
  falta cadastrar as chaves VAPID no Railway. Ver a
  [decisão](../decisoes/2026-09-27%20push%20do%20vendedor.md).
  - Onde: item 14 da Onda 2; hoje site responsivo e PWA, sem push de verdade.
  - Evidência: 11 de 15 produtos no levantamento; MobiGestor e Autoconf têm app nas lojas.
  - Impacto: vendedor fora do computador não vê o lead novo a tempo, e o rodízio perde a razão.
  - Sugestão: seguir o item 14 (push pelo service worker antes de app nativo).
  - Como testar: lead novo gera notificação no celular do vendedor de plantão com o navegador
    fechado.
- **Domínio próprio da loja (`www.sualoja.com.br`).**
  - Onde: a vitrine existe em `/c/[slug]`; não há domínio personalizado nem plano para isso.
  - Evidência: Auto Adm inclui "site profissional com SSL" em todos os planos; ecosys AUTO
    vende "endereço exclusivo" no Pro.
  - Impacto: loja que já tem site com domínio próprio perde o endereço ao migrar, e a vitrine
    com endereço do AutoConnect parece menos dela.
  - Sugestão: domínio personalizado apontando para a vitrine (CNAME + certificado automático no
    Railway), como adicional ou a partir do Crescimento.
  - Como testar: `www.lojateste.com.br` abre a vitrine da loja com HTTPS válido, e o link do
    carro compartilhado usa esse domínio.
- **Financeiro da loja (fluxo de caixa, contas a pagar e receber).**
  - Onde: não existe; há margem por negócio e custo do veículo. O
    [levantamento de vendas](levantamento-vendas-e-contratos.md), pergunta 2, recomenda parar no
    DRE por veículo e comissão, sem registro de que o Israel decidiu.
  - Evidência: financeiro no Pro da Autoconf (R$ 499), no Ultra da ecosys AUTO (R$ 1.497) e no
    Altimus.
  - Impacto: aparece nas faixas de cima do mercado; sem ele o Profissional compete só pelo CRM.
  - Sugestão: registrar a decisão em `docs/decisoes/` (a recomendação é não virar ERP).
  - Como testar: não se aplica até a decisão.

**Do plano de vendas, sem registro até aqui** — Claude Cowork, 27/09/2026, ao conferir o
[plano de vendas](plano-implementacao-vendas.md) contra esta lista. NF-e, fornecedor de
consulta, conta da Clicksign, revisão jurídica, feature flag e região da API já estão acima.

- **RENAVE obrigatório no país inteiro — o prazo de adaptação termina em 28/09/2026.**
  - Onde: nada no código (`git grep -i renave` vazio). O plano prevê na Fase 5 a integração
    "por integradora credenciada, com certificado ICP-Brasil" e a tabela `renave_events` antes da
    integração; a Onda 4 do [plano de paridade](plano-paridade-crm.md) (item 18) cobre só o
    contrato de consignação.
  - O que é: a Resolução Contran nº 1.026/2026 tornou o RENAVE obrigatório para toda revenda de
    usados: entrada e saída do estoque, transferência entre revendas e consignação registradas por
    integradora autorizada pela Senatran, com e-CNPJ, e consignação com contrato assinado
    digitalmente. Os 90 dias de adaptação contados da publicação (fim de junho/início de julho de
    2026) terminam em 28/09/2026.
  - Evidência: [ANAUTOS](https://anautos.org.br/2026/07/02/contran-publica-resolucao-no-1-026-2026-e-torna-renave-obrigatorio-em-todo-o-brasil/)
    e [Renavix](https://www.renavix.com.br/resolucao-1026), lidos em 27/09/2026. Conferir no DOU
    antes de virar requisito — é o que o próprio plano pede no "Nível 5".
  - Impacto: a obrigação é da loja, não do AutoConnect, mas o estoque do sistema passa a precisar
    bater com o RENAVE e a NF-e (veículo, valor, data, tipo de operação). Revenda Mais e Autoconf
    já publicam material sobre o assunto; o lojista vai perguntar na primeira conversa.
  - Sugestão: agora, uma resposta honesta no FAQ e no roteiro ("o AutoConnect ainda não envia ao
    RENAVE; você segue com a sua integradora"). Depois, na ordem do plano: `renave_events` com
    protocolo e payload, campo para o protocolo da integradora na entrada e na saída do veículo,
    e só então a integração.
  - Como testar: veículo com entrada registrada guarda o protocolo; negócio faturado sem
    protocolo de saída mostra o aviso; uma entrada e uma saída de ponta a ponta no ambiente de
    homologação da integradora.
- **Relatório COAF de pagamento em espécie.**
  - Onde: Fase 5 do plano ("a de melhor relação custo-benefício... sem integração externa
    nenhuma"). `DealPayment` já tem o método `cash` em `schema.prisma`.
  - O que é: um job que soma pagamentos em espécie por CPF numa janela móvel de seis meses,
    alerta ao cruzar o limite e gera relatório exportável para a loja comunicar ao COAF.
  - Evidência: o plano de vendas; nenhuma linha de código com "coaf".
  - Impacto: é obrigação da loja que recebe em espécie, e hoje ela precisa somar à mão. Barato de
    entregar e argumento de venda para quem teme multa.
  - Sugestão: implementar como o plano descreve, depois de conferir o limite e o prazo vigentes
    nas normas do COAF (o plano pede essa verificação antes de virar requisito).
  - Como testar: três pagamentos em espécie do mesmo CPF que somam acima do limite em seis meses
    geram o alerta; o mesmo valor espalhado por sete meses não gera; o relatório exporta em CSV.
- **Fase 4 — crédito e F&I, sem nada começado.**
  - Onde: Fase 4 do plano; a tabela "Onde o plano de vendas está" marca ⬜.
  - O que é: `FinanceProposal` com o protocolo da financeira, produtos de F&I com aceite individual
    e data (venda casada é proibida; a evidência do aceite separado defende a loja), e fila com
    BullMQ para envio e reconciliação.
  - Evidência: o próprio plano. A mitigação escrita nele para "integração de crédito não fecha
    comercialmente" é modelar `FinanceProposal` com **preenchimento manual** antes de qualquer API
    — o vendedor já digita no portal do banco hoje.
  - Impacto: financiamento está na maioria das vendas de loja; sem registro, o negócio não mostra
    em que pé está o crédito nem a receita de F&I.
  - Sugestão: começar pelo registro manual da proposta (banco, valor, status, protocolo) ligado ao
    `Deal`, sem integração; a integração multibanco segue sendo o item 21 da Onda 5.
  - Como testar: proposta manual criada, aprovada e recusada aparece na timeline do negócio; um
    produto de F&I só entra no negócio com aceite próprio registrado.
- **Validações que teste não cobre (Nível 5 do plano), além da revisão jurídica.**
  - Onde: seção 6, "Nível 5 — O que teste não cobre".
  - O que é: (a) conferência contábil, com o contador de uma loja real, do que o sistema registra
    como custo, receita e margem; (b) teste de aceitação com um vendedor real fechando um negócio
    de verdade — o [piloto](../produto/piloto-simulado-operacao.md) foi simulado; (c) verificação
    das fontes regulatórias (RENAVE e COAF) antes de virarem requisito.
  - Impacto: margem e comissão erradas são descobertas pelo cliente; fluxo que parece certo na
    simulação trava no balcão.
  - Sugestão: fazer (a) e (b) com a primeira loja fundadora, na semana de implantação; (c) antes de
    começar RENAVE ou COAF.
  - Como testar: ata de cada validação em `docs/produto/`, com o que mudou por causa dela.
- **Portões do plano de vendas não foram marcados.**
  - Onde: `plano-implementacao-vendas.md`, portões das Fases 0, 1 e 2 e a "Definição de pronto" —
    todas as caixas seguem `[ ]`. A tabela "Onde o plano de vendas está", abaixo, diz "Estado em
    03/09/2026".
  - Impacto: quem lê o plano acha que as Fases 0 e 1 não fecharam; é o tipo de documento velho que
    já fez um agente tomar decisão errada.
  - Sugestão: marcar cada caixa cumprida com a data e o teste que prova, e atualizar a data da
    tabela.
  - Como testar: todo item marcado aponta para um teste ou commit que existe.

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
- ~~**Não há listagem de clientes da loja.**~~ — resolvido em 27/09/2026. O
  endpoint já existia (`GET /deals/customers`, criado para vincular cliente ao
  negócio) e respeitava a policy `cliente_relacionado`; **o que faltava era a
  tela usá-lo**. O modal de agendamento ganhou o modo "Cliente da loja", com
  busca por nome ou e-mail e as contagens do vínculo ao lado do nome (é o que
  distingue homônimos). A consulta saiu de dentro de `deals.service` para
  `common/clientes-relacionados.ts`, porque a exportação de portabilidade
  responde à mesma pergunta e duas cópias divergiriam.
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
- ~~**Só o lead tem contagem por motivo de perda.**~~ — resolvido em 27/09/2026:
  `GET /tenant/reports/lost-reasons` agrupa os terminais do período por
  `cancel_reason_code` e o cartão "Por que perdemos" entrou em `/relatorios`. O
  consolidado é do servidor de propósito: o funil de `/negocios` é montado com a
  página carregada, e contar ali daria o total da página.

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

1. **Revisão jurídica do template de contrato, dos Termos, da Política de Privacidade e do Termo do Programa de Fundadores** ([rascunho de 27/09/2026](https://claude.ai/code/artifact/75b007e3-22aa-4410-905c-7799be769db6)) — bloqueia uso real
2. ~~Concluir o Google OAuth~~ — feito em 22/09/2026
3. **Fase 3** do plano: estrutura pronta — consulta veicular com cache por
   custo de chamada e assinatura externa neutra (22/09/2026). Adaptador Clicksign
   escrito e testado no sandbox (22/09/2026). Falta contratar o fornecedor de
   consulta, validar uma assinatura de ponta a ponta no sandbox (Clicksign já
   ligada em 22/09/2026) e contratar a conta de produção da Clicksign
4. ~~**Revisar responsividade** de `/relatorios`, `/agendamentos` e `/equipe`~~ — feito em 22/09/2026
5. ~~**Seed com negócio faturado**~~ — feito em 22/09/2026 (`SEED_DEMO_RESET=1` renova as datas)
6. **Nova landing de captação** — [plano](plano-nova-landing.md) em 5 fases; a 1ª não depende de decisão nenhuma
