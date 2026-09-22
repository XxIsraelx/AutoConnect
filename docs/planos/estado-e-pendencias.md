# Estado, pendências e próximos passos

> Extraído do [CLAUDE.md](../../CLAUDE.md) em 22/09/2026. Lá fica a regra curta; aqui, o porquê.

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
| **Assinatura externa** | ✅ estrutura | ✅ completo | camada neutra, webhook com HMAC, provedor simulado e adaptador Clicksign (API 3.0, testado no sandbox); **ligado em sandbox; falta assinatura de ponta a ponta e conta de produção** ([decisão](../decisoes/2026-09-22%20assinatura%20externa.md)) |

## Pendências conhecidas

Auditadas em 04/09/2026, contra o repositório.

**Bloqueiam uso real**
- ⚠ **Template de contrato não revisado por advogado.** O sistema emite
  documento com efeito jurídico a partir de um template declarado no código
  como ponto de partida.
- ⚠ **Sem fornecedor de consulta veicular.** Depende de contrato comercial. A
  estrutura está pronta e a API recusa em voz alta enquanto não houver.
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
  externa usa a própria configuração como chave: sem `ASSINATURA_FORNECEDOR`,
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
