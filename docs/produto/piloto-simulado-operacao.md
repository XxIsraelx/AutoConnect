---
tipo: piloto
data: 2026-09-24
---

# Piloto simulado — uma semana na Aurora Seminovos

Operação encenada nas telas de verdade, contra banco **local de teste**
(`localhost:55432/autoconnect_test`), loja gerada por
`DEMO_RESET=1 pnpm --filter @autoconnect/db run demo`.
API em `localhost:4100`, web em `localhost:3100` (portas trocadas porque já
havia uma API na 4000). Produção, Railway, Supabase e Clicksign não foram
tocados. Nenhum código de produto foi alterado.

Papéis: `demo.ana` (vendedora), `demo.gerente` (Patrícia), `demo.dono` (Marcos).
Telas exercitadas em **820 px** (layout de desktop, a partir de `md`) e em
**375 px**.

> **Ressalvas de método.** (1) O clique em link `target="_blank"` não é
> entregue à página pela ferramenta de navegador, então o registro de interação
> por **WhatsApp** não pôde ser exercido ponta a ponta — o caminho do
> `tel:` funciona e usa exatamente o mesmo código. (2) Em parte da sessão o
> clique real foi substituído por disparo do mesmo handler no elemento, por
> limitação da ferramenta; isso não afeta as conclusões sobre fluxo, regra de
> negócio e layout, mas significa que não testei área de toque de alvos
> pequenos. (3) O catálogo global de marcas do banco de teste está poluído com
> 7 marcas de e2e (`Marca 4qtdeq0e`, …) que aparecem no `select` do veículo —
> é sujeira do banco de teste, não afirmo que exista em produção, mas mostra
> que o catálogo global não tem limpeza.

---

## 1. As 25 tarefas

| # | Tarefa | | Por quê |
|---|---|---|---|
| 1 | Ana abre o dia | 🟡 | Cai no `/dashboard`, que abre com razão social, slug, e-mail da loja e mapa de alcance de clientes. Nada diz "comece por aqui". 2 cliques até o primeiro lead, e a lista vem por data, com ganho e perdido no meio. |
| 2 | Abrir e ler o lead | ✅ | Card traz mensagem, veículo, preço e contatos; o drawer "Histórico" traz a linha do tempo completa. |
| 3 | Registrar a ligação | 🟡 | Só clicando no telefone do card. Registrou (`call` na timeline), mas sem nenhuma confirmação na tela, e o texto é fixo: "Ligação iniciada para…". Quem liga do próprio celular não tem como registrar. |
| 4 | Registrar o WhatsApp | ⚪ | Não testável no ambiente (ver ressalva 1). Mesmo caminho de código do telefone. |
| 5 | Anotar o que o cliente quer | 🟡 | Funciona, mas Enter não envia (só o ícone de avião), e fechar o drawer joga fora o que foi digitado sem avisar. Nota é `note` — não para o relógio do SLA, de propósito. |
| 6 | Criar lead do balcão | 🟡 | Cadastra, mas **sem o veículo** — ver bug B2. |
| 7 | Criar lead do telefone | 🟡 | Idem. Telefone fica sem máscara na tela. |
| 8 | Marcar test drive para cliente sem conta | ✅ | "Contato avulso" no modal de agendamento; avisa com honestidade que sem e-mail não sai o lembrete de 24h. |
| 9 | Registrar que compareceu | ✅ | Botão "Concluir" no drawer. O rótulo não é "compareceu", mas o indicador de comparecimento sobe. |
| 10 | Registrar que não compareceu | ✅ | Um clique. Aceita marcar falta em agendamento **de amanhã** sem aviso (B14). |
| 11 | Transformar lead em negócio e montar a proposta | 🟡 | Funciona onde o veículo está livre; nos 4 leads ativos da Ana a demo já tinha negócio aberto e a tela só diz "Este veículo já tem um negócio em andamento" sem link para ele. "Proposta" é só um nome de etapa — não existe proposta para enviar ao cliente. |
| 12 | Aplicar desconto | ❌ → ✅ 25/09 | Não existe campo. O valor de venda só pode ser digitado no instante de abrir o negócio, e só pelo caminho `/veiculos/[id]`. Aberto pelo card do lead, o negócio nasce no preço de tabela e nunca mais muda. |
| 13 | Registrar pagamento composto (entrada + financiamento) | 🟡 | Funciona e fecha certinho ("Fecha com a venda R$ 84.900,00"), depois de descobrir que o campo recusa "20.000,00" com um "Validation failed" solto (B8). |
| 14 | Perder um lead com motivo | 🟡 | Fluxo bom: Mover → Perdido → "POR QUE FOI PERDIDO?" com 8 motivos. Mas o card mostra "SEM MOTIVO INFORMADO" logo depois (B7). |
| 15 | Perder/cancelar um negócio com motivo | 🟡 | Salva o código no banco, e **nenhuma tela mostra o motivo depois** (B12). |
| 16 | Achar "o Carlos do Corolla" | 🟡 | Por nome, acha. Por carro, não: a busca não cobre a observação do lead, e o lead do balcão não tem veículo para casar. Não existe busca de cliente na loja inteira. |
| 17 | Fim do dia: quais leads ficaram sem resposta | 🟡 | Há filtros No prazo / Vencendo / Prazo estourado, mas eles incluem lead perdido (B15), mostram o vazio errado (B6), e o SLA só cobre a **primeira** resposta: lead em negociação parado há 10 dias não dá sinal nenhum. |
| 18 | Gerente vê quem está atendendo | ❌ | `presence` (online/busy/offline) existe no banco e não aparece em `/equipe`. Não há tela de "quem está atendendo agora". |
| 19 | Gerente vê quem estourou prazo | ✅ | `/relatorios` → coluna "Fora do prazo" por vendedor, com o tempo médio de 1ª resposta. |
| 20 | Gerente vê quem está vendendo | 🟡 | `/equipe` traz ranking, mas **por % da meta**: quem vendeu R$ 135.900 aparece em 3º e quem vendeu R$ 78.000 em 1º. |
| 21 | Ajustar plantão (tirar quem faltou) | 🟡 | Funciona e persiste (`is_accepting_leads = false`), mas o texto ao lado do switch é o mesmo ligado e desligado, e o estado só existe dentro do drawer de cada pessoa. |
| 22 | Mudar o prazo de resposta | ✅ | `/configuracoes` → Leads e atendimento → 15 para 30 minutos, gravado. |
| 23 | Publicar rascunhos / tentar publicar o incompleto | ✅ | **O melhor momento do produto.** Pulse publicou; Gol tem o botão desabilitado com "Para publicar, falta pelo menos uma foto"; Kwid, "falta cor e câmbio" — preenchi os dois campos e ele liberou. |
| 24 | Conferir margem de um faturado e a comissão | 🟡 | Margem impecável e congelada ("Venda − Custo total = Margem bruta"). A comissão do negócio não aparece no negócio, e o valor mensal **diverge entre duas telas** (B3). |
| 25 | Emitir contrato e assinar / exportar para a reunião | ✅ | Contrato emitido com hash, PDF de 4,9 KB baixa, assinatura da loja registrada. Exportações Desempenho/Negócios/Estoque saem em CSV com BOM. Ressalvas em B10, A16 e A15. |

**Extra — o dono e as seis perguntas:** quanto vendi 🟡 (não há total; soma-se a
coluna na mão, e "últimos 30 dias" não é o mês), margem ✅, de onde vêm meus
leads ✅ (8 origens), qual vendedor rende mais ✅, quanto tenho parado no pátio
❌ (há "dias em estoque" dos 6 primeiros, não há capital imobilizado).

---

## 2. Bugs

Ordenados por quanto custam. Os três primeiros custam dinheiro ou funil.

### B1 — A API não sobe com `GOOGLE_CLIENT_ID=""`, que é o que o `.env.example` entrega
**Gravidade: alta (impede subir um ambiente novo).**
`apps/api/src/common/strategies/google.strategy.ts` usa `clientID ?? 'not-configured'`.
`??` não pega string vazia. O código até loga "Google OAuth desativado" e, na
linha seguinte, derruba o boot.

1. `cp .env.example .env` e preencher só banco e JWT (é o caminho do README).
2. Subir a API.
3. `TypeError: OAuth2Strategy requires a clientID option` — `Nest application
   failed to start`.

### B2 — O lead de balcão e o de telefone nascem sem veículo e morrem ali

> ✅ **Corrigido em 25/09/2026.** O modal carrega equipe e estoque em chamadas separadas e não pede `/users` para quem não pode vê-la; `PATCH /leads/:id` aceita `vehicleId` (e `null`), com carteira e loja respeitadas. Onda 2, item 12a.
**Gravidade: a mais alta do relatório. Quebra a Onda 0, item 2.**

1. Entrar como `demo.ana` (papel `salesperson`) → `/leads` → "Novo lead".
2. O modal abre com o aviso *"Não foi possível carregar equipe e estoque (Seu
   usuário não tem permissão para ver esta área…). Dá para cadastrar mesmo
   assim e completar depois."*
3. "Veículo de interesse" tem uma única opção: **Nenhum**.

Causa: `GET /api/v1/users` responde **403** para `salesperson`;
`GET /vehicles?status=available` responde **200** — mas `NovoLeadModal.tsx`
carrega os dois num `Promise.all`, e a rejeição de um descarta o sucesso do
outro.

O estrago vem depois: lead sem veículo **não tem botão "Negócio"** no card, e
`PATCH /leads/:id` só aceita status (`updateLeadStatusSchema`) — não existe
rota nem tela para vincular o veículo depois. "Completar depois" é uma promessa
que o produto não cumpre. O cliente que entrou na loja perguntando pelo Corolla
fica num card solto para sempre.

### B3 — A comissão tem dois valores diferentes em duas telas

> ✅ **Corrigido em 25/09/2026.** Uma definição só, no shared: percentual × **valor de venda** dos negócios faturados. As duas telas e o negócio consomem `calcularComissao`, e cada uma cita a base. Decisão em [base da comissão e preço negociável](../decisoes/2026-09-25%20base%20da%20comissao%20e%20preco%20negociavel.md).
**Gravidade: alta (é o número que vira pagamento).**

| Vendedor | `/equipe` (drawer) | `/relatorios` e `salespeople.csv` |
|---|---|---|
| Ana Beatriz | **R$ 1.950,00** — "2,5% sobre R$ 78.000,00 vendidos" | **R$ 147,50** (2.5%) |
| Wesley | R$ 2.138 implícito (2% × 106.900) | R$ 198,00 (2%) |
| Rogério | R$ 3.397,50 implícito | R$ 327,50 (2.5%) |

`/equipe` aplica o percentual sobre o **faturamento**; `/relatorios` aplica sobre
a **margem bruta** (5.900 × 2,5% = 147,50). Nenhuma das duas diz qual é a base.
O CSV que o gerente leva para a reunião carrega a segunda.

### B4 — `status=available` conta rascunho
Dashboard diz "15 veículos disponíveis"; a vitrine `/c/demo` mostra 12. No banco:
12 `available/published` + **3 `available/draft`**. O modal de agendamento também
lista os três rascunhos, então dá para marcar test drive num carro sem foto e
com ficha incompleta.

### B5 — `/veiculos` esconde reservado, vendido e arquivado — e mente no contador
`app/(dashboard)/veiculos/page.tsx:72` fixa `status: 'available'` na query, e a
linha 106 rotula o total como **"16 veículos cadastrados"**. A loja tem 25
(12 publicados + 6 reservados + 4 vendidos + 3 rascunhos). Os filtros de cima
são só de anúncio (Todos/Rascunho/Publicado/Despublicado) — não há filtro de
estoque. O carro que você reservou ontem some da tela de estoque.

### B6 — Filtro de SLA não limpa com "Todos", e o vazio é o vazio errado
1. `/leads` → clicar "Prazo estourado". Lista vazia.
2. Clicar "Todos" na mesma linha. O chip vermelho **continua aceso** e a lista
   continua vazia.
3. A tela diz **"Nenhum lead ainda — Quando clientes demonstrarem interesse, os
   leads aparecerão aqui."** enquanto o cabeçalho diz "11 total".

Só desclicando o próprio chip (ou recarregando) volta. A busca por texto, no
mesmo lugar, mostra o vazio certo ("Nenhum lead encontrado. Tente mudar os
filtros.") — então é inconsistência interna.

### B7 — O motivo da perda vira "SEM MOTIVO INFORMADO" na hora

> ✅ **Corrigido em 25/09/2026.** A lista passou a substituir o lead pelo que o PATCH devolveu, em vez de copiar só o status.
1. Mover → Perdido → escolher "Não respondeu".
2. A faixa "PERDAS POR MOTIVO" já soma "Não respondeu 1" (certo).
3. O chip do card mostra **"SEM MOTIVO INFORMADO"**.
4. Recarregar a página → "NÃO RESPONDEU".

O banco tem `lost_reason_code = nao_respondeu`. A atualização otimista da lista
não carrega o código. Convida o vendedor a escolher o motivo de novo.

### B8 — "Validation failed" solto no lançamento de pagamento
No negócio, "Composição do pagamento", digitar **20.000,00** (formato brasileiro,
que é como o app exibe tudo) e enviar → aparece só **"Validation failed"**, sem
campo apontado e sem dizer o formato. `20000.00` funciona. O placeholder é
`0.00`. É exatamente o caso que o CLAUDE.md manda tratar com `fieldErrors`.

### B9 — `/negocios/[id]` estoura a largura em 375 px

> ✅ **Corrigido em 25/09/2026.** A grade estava com `grid` sem `grid-cols-1`: a coluna implícita crescia até o max-content do cartão mais largo. Com `minmax(0, 1fr)`, 367/367.
`main.scrollWidth = 397` num `clientWidth = 367`. O e-mail do comprador e os
valores da composição do pagamento ficam cortados e a página rola de lado.
Medi também `/leads`, `/agendamentos`, `/negocios` e `/veiculos` a 375 px:
367/367, sem overflow. É só o detalhe do negócio.

### B10 — Contrato emitido sem mover o negócio de etapa

> ✅ **Corrigido em 25/09/2026.** A emissão passa pela máquina de estados e move o negócio para "contrato emitido". Rascunho não emite — `draft` não alcança `contract_issued` —, e a reemissão depois de anular não mexe no status.
Emiti o contrato do Fiat Argo com o negócio em **Proposta**. O contrato foi
criado (`Compra e venda v1`, hash `6b43bddd3620…`) e o negócio **continuou em
Proposta**. O funil por valor passa a colocar em "Proposta" dinheiro que já tem
contrato emitido.

### B11 — "Emitir contrato" habilitado em negócio cancelado

> ✅ **Corrigido em 25/09/2026.** O botão nasce desabilitado em negócio terminal e em rascunho, com o motivo na tela e no `title`.
No Onix cancelado o botão aparece e está `disabled: false`. A API recusa
corretamente (`409 — Negócio em "canceled" não emite contrato`), então não há
dano; é um convite ao erro.

### B12 — O motivo do cancelamento do negócio some

> ✅ **Corrigido em 25/09/2026.** Aparece na lista `/negocios`, no cabeçalho do detalhe e no histórico — o evento de status passou a gravar o rótulo do código, não só o texto livre.
Cancelei com "Não fechou no preço". Banco: `cancel_reason_code = preco`. O
histórico do negócio registra só "Proposta → Cancelado", sem motivo, e a lista
`/negocios` também não mostra. Quem abre amanhã não sabe por que o dinheiro não
entrou — que é justamente o que o código estruturado existe para responder.

### B13 — O badge de leads da sidebar é da loja inteira, mesmo com carteira fechada
`GET /tenant/stats` recebe só o escopo do tenant, sem filtro por vendedor. Com a
carteira fechada, a Ana via **"2 novos aguardando resposta"** no dashboard e
**"Novo (0)"** na própria lista. Ao longo da sessão o badge foi de 2 para 8. Ela
persegue um número que não é dela e que nunca zera.

### B14 — Agendamento futuro aceita "Não compareceu"

> ✅ **Corrigido em 25/09/2026.** "Concluir" e "Não compareceu" só a partir do horário marcado. A API recusa com 409 e a tela já desabilita os dois botões.
Marquei falta num test drive de **amanhã**, sem aviso. O indicador de
comparecimento — que o roteiro de demonstração vende como "o número que ninguém
tem na planilha" — aceita ser contaminado.

### B15 — Lead perdido aparece no filtro "No prazo"
Filtrando "No prazo", o lead que acabei de marcar como Perdido continua na lista.
O filtro de SLA não exclui status terminal.

### B16 — O drawer de histórico não fecha com Esc e descarta a nota digitada
Digitei a nota, fechei no X, reabri: texto perdido, sem confirmação.

### B17 — Agendamento: a lista diz "Ana", o detalhe diz "Não atribuído"
A linha mostra `Hyundai Creta · Ana`; abrindo, "VENDEDOR RESPONSÁVEL: Não
atribuído". A lista exibe o dono do lead, o drawer exibe o vendedor do
agendamento. E o `select` de vendedor no drawer vem vazio para a Ana — mesmo 403
de `/users` do B2: ela não consegue se atribuir a um agendamento.

---

## 3. Atritos de usabilidade, pelo que mais atrapalha o dia

1. **Não existe a tela do meu dia.** O dashboard da vendedora abre com razão
   social, slug, e-mail da loja e um mapa de alcance de clientes — informação de
   dono. O que ela precisa (o que responder agora, o que está atrasado, o que
   esfriou) não tem tela; ela monta na cabeça a partir de `/leads`.
2. **A lista de leads não é uma fila de trabalho.** Ordenada por criação, com
   Ganho e Perdido no meio dos ativos, sem ordenação por urgência e sem
   "somente abertos" por padrão.
3. **Registrar contato depende de clicar no link certo.** Ligou do celular?
   Nada registrado, relógio do SLA correndo, e o gerente recebe alerta de
   estouro de um lead que foi atendido. Nota interna não conta, de propósito —
   então não há saída. E o texto registrado é sempre "Ligação iniciada para…":
   não dá para dizer que não atendeu.
4. **Zero confirmação ao registrar contato.** Só a falha aparece.
5. **O preço não se negocia.** Desconto só na criação do negócio, e só pelo
   caminho `/veiculos/[id]`. `PATCH /deals/:id` aceita `discount` e `saleValue`
   e o front só manda `customerUserId` — é a armadilha nº 1 do CLAUDE.md viva
   na ação mais frequente da venda.
6. **Não existe proposta.** "Proposta" é um nome de etapa; não há documento para
   mandar ao cliente. Hoje o vendedor manda print do WhatsApp.
7. **375 px: sete linhas de filtro antes do primeiro lead.** Na tela de leads o
   primeiro card começa em ~530 px de 812 — dois terços da primeira dobra são
   cabeçalho e chips.
8. **O card mostra idade de criação, nunca de última interação.** Lead de 3 dias
   atendido hoje e lead de 3 dias esquecido são visualmente idênticos.
9. **Busca fraca.** Não cobre a observação do lead. Com carteira fechada, não
   existe busca de cliente na loja inteira — se o cliente foi atendido pelo
   colega, ele não existe para você.
10. **Plantão invisível.** Texto idêntico nos dois estados, e o estado só dentro
    do drawer: para saber quem está de plantão hoje, cinco drawers.
11. **Carteira fechada para lead, aberta para negócio.** A Ana não vê os leads do
    Wesley, mas vê os negócios dele com valor. Ou uma coisa ou outra.
12. **Ranking por % da meta.** Quem vendeu mais aparece em 3º.
13. **O dono soma a coluna na mão.** `/relatorios` não tem linha de total nem
    card de faturamento do período.
14. **CSV no formato errado para o Brasil.** Separador vírgula e decimal ponto
    (`"78000.00"`): no Excel pt-BR cai tudo numa coluna. O BOM UTF-8 está lá,
    os acentos vão bem — falta só o `;` e a vírgula decimal.
15. **"Assinar como Loja" fecha a porta da assinatura eletrônica**, sem avisar, e
    os três botões aparecem lado a lado nessa ordem. Assinou internamente, o
    envio externo some.
16. **"Assinar como Comprador" está no painel da loja.** O vendedor assina pelo
    cliente com um clique, na própria sessão. Pode ser deliberado (assinatura
    presencial), mas não há nada na tela dizendo que é isso.
17. **Telefone sem máscara** no cadastro de lead, com placeholder mascarado.
18. **"NO PRAZO · faltam 12h" às 20h.** A regra de horário comercial está certa;
    a etiqueta faz o vendedor achar que tem 12 horas.

---

## 4. O que faltou

### Impede o uso
- ✅ **Vincular veículo a lead manual** (e corrigir o veículo de qualquer lead).
  Sem isso, todo lead de balcão e telefone é um beco sem saída. *(25/09/2026)*
- ✅ **Editar preço/desconto de um negócio aberto.** *(25/09/2026)*
- **Ver o estoque reservado, vendido e arquivado** na tela de estoque.
- ✅ **Um número de comissão que não tenha duas versões.** *(25/09/2026)*

### Incomoda
- Proposta imprimível/enviável ao cliente.
- Registro manual de ligação com desfecho ("não atendeu", "ligar às 18h").
- Presença ("quem está atendendo agora") e plantão visíveis na lista da equipe.
- Capital parado no pátio: soma do custo do estoque disponível e dias parados
  além dos 6 primeiros.
- Busca de cliente na loja inteira, acima da carteira.
- Totais nas tabelas de relatório e CSV no formato do Excel brasileiro.
- Lembrete/alerta de lead parado (o SLA só cobre a primeira resposta).

---

## 5. Veredito para a Onda 2

> **Os três primeiros foram feitos em 25/09/2026**, junto de B7, B9, B10, B11,
> B12 e B14. O relatório fica como está — é o registro do que foi encontrado —,
> com as marcas de correção em cada bug. O que mudou está no
> [plano de paridade](../planos/plano-paridade-crm.md), itens 12a a 12c.

**Não é WhatsApp oficial, e não é ingestão de leads dos portais. É fechar o
funil manual e o dinheiro do negócio.** Nesta ordem:

**1º — Lead manual completo (B2 + item 12 da tabela).** Foi o que quebrou
primeiro e foi o que quebrou pior. O modal de lead novo é a porta de entrada do
balcão e do telefone — exatamente os leads que a loja gera sozinha e que o
concorrente não traz para ela. Hoje eles entram sem veículo (403 em `/users`
derrubando o estoque junto), não ganham botão de negócio e não têm como ser
corrigidos, porque `PATCH /leads/:id` só move status. Trazer mais lead de portal
antes disso é aumentar a fila de leads que não viram negócio. É um dia de
trabalho: desacoplar o `Promise.all`, liberar uma rota de equipe para vendedor
(ou não pedir equipe quando o papel não pode vê-la) e aceitar `vehicleId` no
PATCH do lead.

**2º — Preço negociável no negócio aberto.** Negociar preço é o que o vendedor
faz o dia inteiro, e não há onde digitar. O `updateDealSchema` já aceita
`discount` e `saleValue`; falta a tela. Sem isso, o negócio aberto pelo card do
lead nasce no preço de tabela e o funil por valor — que é a peça mais bonita do
produto — mostra números que não são os da venda.

**3º — Uma base só para comissão (B3).** R$ 147,50 contra R$ 1.950,00 para a
mesma pessoa no mesmo mês. Num piloto real isso não aparece na demonstração:
aparece no quinto dia, na conversa sobre pagamento, e é o tipo de erro que
encerra o piloto — porque depois dele o lojista deixa de acreditar em todos os
outros números da tela, inclusive na margem, que está certa.

**Depois disso, WhatsApp oficial antes dos portais.** E o motivo saiu da
simulação, não de opinião: hoje **toda** a medição de atendimento está pendurada
em alguém clicar num link `tel:` ou `wa.me` dentro do sistema. Ligou do
celular, o lead fica eternamente "sem resposta", o cron marca estouro e o
gerente recebe um alarme falso — e alarme falso é alarme que se aprende a
ignorar, que é justamente o que o plano da Onda 1 queria evitar. Com API oficial
de WhatsApp o registro deixa de depender da disciplina do vendedor e o SLA passa
a medir a realidade. Ingestão de portais fica em quarto lugar: entrada de lead
não é o gargalo do que eu vi — o gargalo é o que acontece com o lead depois que
ele entra.

**Fora da lista, mas anote:** o B1 (`GOOGLE_CLIENT_ID=""` derruba o boot) custa
meia hora para corrigir e vale a pena fazer antes de qualquer instalação em
máquina de cliente ou ambiente novo, porque é o primeiro passo do README que
falha.

---

## Estado deixado no ambiente

Banco de **teste** com a loja demo alterada pela simulação: 2 leads novos
(Carlos Meneguel, Juliana Prado — esta perdida por "Não respondeu"), 1
agendamento novo (Sergio Palmieri), 1 concluído e 1 falta, negócio do Onix
cancelado por "Não fechou no preço" com pagamento composto lançado, contrato
emitido e assinado pela loja no negócio do Fiat Argo, Fiat Pulse e Renault Kwid
publicados, plantão da Ana desligado e prazo de primeiro contato em 30 minutos.
`DEMO_RESET=1 pnpm --filter @autoconnect/db run demo` (com as duas variáveis
apontando para o banco de teste) devolve tudo ao estado original.

API (4100) e web (3100) seguem rodando a partir de
`scratchpad/run-api.sh` e `scratchpad/run-web.sh`; logs em `api.log` e `web.log`.
