---
tipo: plano
---

# Plano — módulo financeiro da loja

Decidido em 27/09/2026 ([decisão](../decisoes/2026-09-27%20modulo%20financeiro.md)): o
AutoConnect passa a ter financeiro. Reverte a recomendação do
[levantamento de vendas](levantamento-vendas-e-contratos.md) de parar no DRE por
veículo, com os olhos abertos para o que aquela recomendação protegia.

## O que "completo" quer dizer aqui

**Financeiro gerencial completo, não contabilidade fiscal.** A diferença não é de
tamanho, é de destinatário: o gerencial responde ao dono da loja ("tenho dinheiro
para pagar o mês que vem?"), o fiscal responde ao Estado (SPED, apuração,
obrigações acessórias) e tem o contador como usuário. Entra tudo do primeiro;
o segundo segue adiado junto com a NF-e, e a exportação para o contador é a
ponte entre os dois.

| Entra | Fica fora (e por quê) |
|---|---|
| Contas a pagar e a receber, com baixa | SPED e apuração de imposto — é produto do contador |
| Fluxo de caixa previsto e realizado | Folha de pagamento — CLT é outro domínio inteiro |
| Plano de contas (categorias de receita e despesa) | Contabilidade de partidas dobradas |
| Contas: caixa, bancos, adquirentes | Open Finance na primeira volta (certificado e homologação) |
| DRE gerencial mensal da loja | Conciliação de cartão maquininha por maquininha |
| Conciliação bancária por OFX | |
| Fechamento de mês, com trava | |
| Exportação para o contador | |

## Cinco regras que valem para o módulo inteiro

1. **Dinheiro é `Decimal(14,2)` no banco e `Prisma.Decimal` na conta.** Já é a
   regra do projeto; aqui ela é a diferença entre um caixa que fecha e um que não
   fecha. Nada de `number` em nenhuma camada, nem "só para somar".
2. **Saldo é sempre derivado, nunca gravado.** Saldo em coluna vira saldo errado
   no primeiro lançamento editado. Soma-se em `Decimal` a partir dos lançamentos,
   com índice para isso doer pouco.
3. **Um número, uma fonte.** Custo do veículo vendido, margem e comissão já têm
   definição no shared e no `deals`. O financeiro **referencia** essas linhas; não
   copia, não recalcula. Duas definições da mesma conta é o erro que já deu R$
   1.950,00 numa tela e R$ 147,50 na outra para a mesma pessoa.
4. **Nada apaga.** Lançamento errado é **cancelado** com motivo, e a linha fica.
   Mês fechado tranca o que é anterior à data de fechamento, com quem fechou.
   Auditoria em baixa, cancelamento, edição de valor e fechamento.
5. **Financeiro é de gerência.** `manager` e `tenant_admin` (e super admin, pelo
   impersonate). Vendedor não vê o caixa da loja — a mesma razão da carteira
   fechada e do CSV de clientes restrito.

---

## Fase 1 — o esqueleto do dinheiro ✅ 27/09/2026

**Entregue em 27/09/2026:** quatro tabelas com RLS, os CHECKs de coerência, o
trigger do mês fechado, `GET/POST/PATCH` de contas, categorias e lançamentos,
baixa idempotente, cancelamento com motivo, fechamento e reabertura de mês, e o
resumo que responde as quatro perguntas do dono. 19 testes de regra no shared e
18 e2e — incluindo o que confere que o saldo da API é o mesmo que a regra pura dá
sobre as mesmas linhas, e que a loja vizinha não vê nada.

Tabelas novas, todas com `tenant_id` e policy `tenant_isolation` na migration:

- **`financial_accounts`** — onde o dinheiro está: caixa, banco, adquirente.
  `kind`, `name`, `bankName`, `openingBalance`, `active`. Saldo inicial existe
  porque a loja começa a usar no meio da vida dela.
- **`financial_categories`** — plano de contas curto: `direction` (entrada/saída),
  `name`, `group` (veículos, operação, pessoal, impostos, financeiro, outros),
  `active`. Nasce **semeada** por loja com um conjunto mínimo, senão a primeira
  tela pede cadastro antes de qualquer lançamento.
- **`financial_entries`** — o lançamento. `direction`, `status`
  (`previsto | pago | cancelado`), `value`, `dueDate`, `paidAt`, `accountId`,
  `categoryId`, `branchId?`, `supplierName?`, `description`, `notes?`,
  `dealId?`, `vehicleId?`, `dealPaymentId?`, `recurrenceId?`,
  `canceledAt?`/`cancelReason?`, `createdBy`.
- **`financial_periods`** — mês fechado: `year`, `month`, `closedAt`, `closedBy`.
  Trigger recusa escrita em lançamento com `dueDate` dentro de mês fechado, como
  o contrato emitido já faz.

Decisões desta fase, com o padrão que vou adotar se você não disser outra coisa:

- **Regime de caixa**, com `dueDate` (vencimento) e `paidAt` (baixa). Competência
  entra depois como campo opcional, se o contador pedir — a loja pensa em caixa.
- **Baixa parcial não existe.** Parcela é linha própria: três parcelas são três
  lançamentos. Baixa parcial é a porta de entrada do saldo que não fecha.
- **`branchId` opcional** no lançamento: a loja com duas filiais vai querer
  separar, e quem tem uma só nem vê o campo.

## Fase 2 — a loja usa ✅ 28/09/2026

**Entregue:** `/financeiro` no painel, com seis abas — Visão, A pagar, A receber,
Lançamentos, Contas e Categorias. O item do menu só aparece para gerência, e a API
recusa o vendedor com 403: esconder no menu sem fechar a API é esconder, não
proteger.

- **Visão** — a pergunta do dono: saldo por conta hoje, o que vence nos próximos
  7 dias, o que está atrasado, e o resultado do mês corrente.
- **A pagar** e **A receber** — lista filtrável por período, status, categoria e
  filial; baixa em um clique (data e conta, com padrão de hoje); atrasado em
  vermelho, e a soma sempre visível no topo.
- **Lançamentos** — criar e cancelar com motivo (editar entra junto do fluxo de
  caixa, na Fase 4). Recorrência de 3, 6, 12 ou 24 meses — **sempre com fim**:
  série sem fim é lixo acumulando no banco e um fluxo de caixa que promete 2040.
- **Contas e Categorias** — o saldo por conta e o plano de contas que a loja
  ajusta. Uma revenda tem categoria que nenhum padrão adivinha ("despachante",
  "leilão"), e é aqui que ela entra.
- Falha de carga com `ErroAoCarregar`, falha de ação inline, formulário que edita
  dado existente não renderiza se a carga falhou — o padrão do projeto.

## Fase 3 — o dinheiro que o negócio já gerou ✅ 28/09/2026

**Entrega:** o financeiro para de ser digitação e passa a nascer do que a loja já
faz. É aqui que ele fica melhor que planilha.

- **Negócio faturado → contas a receber.** Cada `deal_payment` vira um lançamento
  previsto, com `dealPaymentId` preenchido; confirmar o pagamento no negócio dá
  baixa no financeiro, e vice-versa. Um lado só de verdade, e o outro espelha.
- **Aquisição do veículo → conta a pagar** ao fornecedor, com `vehicleId`.
- **Custo de preparação → conta a pagar**, item por item, com o fornecedor que já
  é digitado hoje.
- **Sem dupla contagem:** o lançamento gerado **aponta** para a linha de origem.
  A tela que mostrar as duas coisas junta pela origem, não soma duas vezes.
- ⏸ **Comissão do vendedor → conta a pagar**: fica para a Fase 4, junto do
  fechamento de mês, que é quando ela é apurada. A categoria e a chave de origem
  (`comissao`) já existem esperando.

## Fase 4 — fluxo de caixa, DRE e fechamento ✅ 28/09/2026

- **Fluxo de caixa** diário e semanal: previsto (pelo vencimento) versus
  realizado (pela baixa), por conta e consolidado, com saldo projetado. O gráfico
  responde "em que dia o caixa fica negativo".
- **DRE gerencial mensal:** receita de veículos, CMV pelo
  `vehicleCostSnapshot` dos negócios faturados, despesas por grupo de categoria,
  resultado. **Conferido contra `/relatorios`:** se o faturado do mês divergir do
  relatório de margem, é bug — e vai ter teste comparando os dois.
- **Fechamento de mês** com trava e auditoria; reabrir exige motivo. Fechar
  também **apura a comissão**: uma conta a pagar por vendedor, com
  `calcularComissao` (a mesma de `/equipe`, `/relatorios` e do negócio — não
  existe uma segunda fórmula), vencendo no dia 5 do mês seguinte, que é mês
  aberto. Idempotente pelo `documentNumber`: reabrir e fechar de novo não cria a
  segunda comissão.

## Fase 5 — conciliação bancária ✅ 28/09/2026

- **Importação OFX** (o formato que todo banco brasileiro exporta) para
  `bank_transactions`, idempotente por `(accountId, fitid)` — o mesmo desenho de
  idempotência dos webhooks.
- **Sugestão de conciliação** por valor e data, com janela de tolerância. A regra
  é **pura e no shared**, testável sem banco: é ela que vai errar, e errar em
  silêncio se não tiver teste.
- Conciliar marca o lançamento e a transação; o que sobrar aparece nas duas
  listas, sem inventar lançamento novo.
- **Open Finance fica para depois** — precisa de certificado, homologação e
  contrato com instituição; OFX resolve 90% com 10% do custo.

## Fase 6 — a ponte com o contador ✅ 28/09/2026

- Exportação do período em CSV com categoria, data, valor, documento, conta e a
  **origem no sistema** — a coluna que responde "de onde saiu esta linha que
  ninguém digitou", que é a primeira pergunta de quem recebe o arquivo.
- ⚠ **"O formato que o escritório importa" não existe:** cada um usa o layout do
  sistema dele. O que entregamos são as colunas que todos pedem, e a tela diz que
  a primeira importação vai precisar de um de-para. Prometer "é só importar"
  seria vender o que não se entrega.
- Entra em *Configurações › Levar seus dados*, ao lado dos oito arquivos que já
  estão lá.

---

## O que este plano não promete

- **Não substitui o contador.** Sem SPED, sem apuração, sem folha.
- **Não vira ERP de estoque de peças nem oficina.**
- **Não faz conciliação de cartão por adquirente** na primeira volta: entra como
  conta e lançamento, não como integração.
- ⚠ **Nada aqui foi revisado por contador.** Vale o mesmo aviso do contrato sem
  advogado: o cálculo é gerencial, e a nomenclatura pode não casar com a do
  escritório. A revisão entra junto com a jurídica da Onda B.

## Ordem, e por que ela

Fases 1 e 2 entregam um financeiro que **já serve** — a loja lança e baixa. A
Fase 3 é a que faz valer a pena ter o financeiro **aqui** em vez de numa
planilha: o dinheiro nasce do negócio que já foi fechado no sistema. A 4 responde
a pergunta que o dono faz toda semana. A 5 é a que dá confiança no número. A 6
fecha o ciclo com quem vai olhar isso uma vez por mês.

## Estado

**As seis fases fecharam entre 27 e 28/09/2026.** O que o módulo faz hoje: conta e
plano de contas, a pagar e a receber com baixa, lançamento nascendo do negócio
faturado, da compra e da preparação, fluxo de caixa que responde em que dia o
caixa fica negativo, DRE gerencial, fechamento de mês com comissão apurada e
auditoria, conciliação por OFX e exportação para o contador.

O que **não** faz, e segue de propósito fora: SPED, apuração de imposto, folha de
pagamento, NF-e (adiada em 27/09/2026), conciliação de cartão por adquirente e
Open Finance.

⚠ **Nada disso foi revisado por contador** — entra na mesma revisão da Onda B, com
o contrato e as páginas legais.

O [plano de resolução das pendências](plano-resolucao-de-pendencias.md) registra o
financeiro como adiado; esta nota o substitui.
