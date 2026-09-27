---
tipo: decisao
data: 2026-09-27
estado: aceita
---

# Plano de preços

## Contexto
Havia três tabelas diferentes: a cobrança (`CATALOGO_DE_PLANOS`) cobrava R$ 279, R$ 479 e
R$ 799; a home antiga anunciava outra coisa; e o programa de fundadores, combinado fora do
repositório em 22/09/2026, falava em R$ 197 e R$ 297 e num "Pro como é hoje, até 5 usuários" que
não existe mais ([pendência de 27/09/2026](../planos/estado-e-pendencias.md)).

A pesquisa de preços do Cowork (documento "Plano de preços — AutoConnect", no projeto do Claude)
comparou Auto Adm, Autoconf, ecosys AUTO, Altimus e RD Station: o mercado cobra de R$ 179 a
R$ 1.497 por mês, e **todos incluem integração com portais já no plano de entrada** — o que o
AutoConnect ainda não tem, junto com NF-e (bloco "Lacunas frente ao mercado" das pendências).

## Decisão
- **Tabela de lançamento:** Essencial R$ 197 (30 veículos), Crescimento R$ 347 (80),
  Profissional R$ 597 (ilimitado). Todos os módulos e usuários ilimitados em todos os planos; o
  plano de cima passa a se chamar "Profissional" também na tela.
- **Fundadoras** (5 lojas) não pagam nunca, no Crescimento. A loja interna da AutoConnect (a do
  Raio-X) também não. As duas são **cortesia**: `tenant_subscriptions.courtesy_since`, concedida
  e revogada só pelo super admin, com motivo e autor gravados.
- **Revogar a cortesia** devolve a loja ao trial com 7 dias para escolher um plano — nunca
  bloqueio na hora.
- **Preço travado por tabela, não por valor:** quem assina no lançamento fica com a **tabela**
  de lançamento — se subir do Essencial para o Crescimento, paga o Crescimento de lançamento
  (R$ 347), não o da tabela cheia. A trava é gravada na primeira contratação e fica **na loja**:
  mudar de plano hoje passa por cancelar e contratar de novo, e a trava tem de sobreviver a isso.
  Consequência aceita: a loja que cancela e volta meses depois também volta no preço de
  lançamento.
- **Limite de filiais** (1 / 2 / 5): conferido ao **criar** filial, como o teto de estoque é
  conferido ao publicar. Loja que já tem mais filiais que o plano mantém todas; só a próxima é
  recusada (422, dizendo o plano que comporta). Filial desativada não conta. Até 27/09/2026 não
  existia como criar filial nenhuma — a matriz nascia no cadastro e era a única; o cadastro de
  filial entrou junto com o limite (`POST /tenant/branch`, só `tenant_admin`).
- **Tabela cheia** (sugestão de R$ 247 / R$ 447 / R$ 747) só quando houver integração com portais.
- **Anual:** 12 meses pelo preço de 10, uma cobrança só (`YEARLY` na Asaas); o pagamento cobre
  365 dias.

## Por quê
- R$ 197 fica abaixo de Auto Adm e Autoconf na entrada, que é onde estão as revendas pequenas
  da prospecção; a distância para a média cresce nos planos de cima, onde a falta de portais e
  NF-e pesa mais.
- Plano por tamanho, e não por módulo: travar o CRM no plano de cima esconderia justamente o que
  o Raio-X vende (tempo de resposta, rodízio, prazo de primeiro contato).
- Cortesia como situação própria (`avaliarCobranca` → `cortesia`), e não trial estendido à mão:
  a fundadora que ninguém lembrasse de estender cairia em somente leitura, e o painel não diria
  por que a loja não paga.
- Travar a **tabela** e não um valor: com um valor só, a loja de lançamento que cresce ou pagaria
  a tabela cheia no plano novo (punindo quem cresceu) ou ficaria com o preço do plano pequeno.

## Descartado
- **Manter R$ 279 / R$ 479 / R$ 799**: perto da média do mercado, caro para quem entra sem portal.
- **Cortesia como plano novo no enum** (`SubscriptionPlan`): o teto de estoque e o painel leem o
  plano; a fundadora precisa do teto do Crescimento, e um plano "cortesia" duplicaria a faixa.
- **Isenção por trial longo** (`trialEndsAt` em 2099): funciona até alguém "corrigir" a data, e
  não diz a ninguém que a loja é fundadora.

## Onde está no código
- `CATALOGO_DE_PLANOS`, `MOTIVOS_DE_CORTESIA`, `PLANO_DA_CORTESIA` e a regra 0 de
  `avaliarCobranca` em `packages/shared/src/domain/cobranca.ts` (testes em `cobranca.spec.ts`).
- Migration `20260927140000_cortesia_de_cobranca`.
- `PATCH` e `DELETE /admin/tenants/:id/cortesia` (`admin.service.ts`), guard e cron lendo a
  cortesia, contratação recusada com 409 (`cobranca.service.ts`).
- `cobranca.e2e-spec.ts`, bloco "cortesia".
- Tela de plano (`/configuracoes/plano`), gaveta da loja no painel do super admin e a seção de
  planos da landing, que lê os preços do catálogo.
- Preço travado e anual: `TABELAS_DE_PRECO`, `tabelaDaLoja`, `precoDoPlano` e `DIAS_DO_CICLO`
  no shared; `price_table` e `billing_cycle` na assinatura (migration
  `20260927150000_preco_travado_e_ciclo`); `contratar` com `ciclo`; adaptador da Asaas e
  provedor simulado.
- Filiais: `limiteDeFiliais` no shared, `createBranch` em `tenants.service.ts`, `Filiais.tsx` em
  `/configuracoes`.
- `cobranca.e2e-spec.ts`, blocos "preço travado e ciclo anual" e "limite de filiais do plano".
