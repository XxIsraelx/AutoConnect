---
tipo: decisao
data: 2026-10-14
estado: aceita
---

# A troca não gera lançamento no financeiro, em nenhuma das pontas

## Contexto

Na venda com troca, o cliente paga parte do carro com o usado. O financeiro
gerado pelo sistema lançava as duas pontas como dinheiro:

- a forma de pagamento `trade_in` do negócio virava **conta a receber** — que
  nunca cai em conta nenhuma;
- a aquisição do usado, de origem `trade_in`, virava **conta a pagar** —
  "Compra do veículo", que nunca sai do caixa.

As duas tinham o mesmo valor e se anulavam no fluxo de caixa, então o erro não
aparecia no saldo previsto — mas a lista de contas a receber e a de contas a
pagar mostravam dinheiro que não existe. A pendência original falava só da
primeira; a sessão 1 achou a segunda, e corrigir só uma faria o fluxo prometer
uma saída de caixa no valor da troca.

## Decisão

**Nenhuma das pontas vira lançamento.** O `deal_payment` de `trade_in` não gera
conta a receber, e a aquisição de origem `trade_in` não gera conta a pagar. Se
uma aquisição for corrigida para troca depois de gerar a conta a pagar, a ainda
prevista é cancelada com motivo; a já paga fica.

## Por quê

Nenhum dinheiro mudou de mão. O caixa responde "quanto entra e sai de
dinheiro", e a troca não é nenhum dos dois. A troca continua registrada onde ela
é fato: no negócio (forma de pagamento) e no custo do usado (aquisição) — e o
DRE não muda, porque receita e CMV vêm do negócio faturado e do
`vehicleCostSnapshot`, não dos lançamentos.

## Descartado

- **Lançar as duas como compensadas na mesma data** (entrada e saída pagas numa
  conta "compensação de troca"). Deixa a troca visível no extrato, ao preço de
  duas linhas que não são dinheiro e de uma conta que não existe no banco — e a
  conciliação por OFX nunca as encontraria.
- **Corrigir só a conta a receber**, como a pendência original sugeria. O fluxo
  passaria a prometer uma saída de caixa que não existe.

## O que fica para trás

Lançamentos de troca gerados **antes** desta decisão continuariam no banco —
e se houvesse algum previsto, a loja cancelaria à mão, com motivo (mês fechado
não muda). **Conferido em produção em 14/10/2026, só leitura: nenhum** — zero
contas a receber de `trade_in` e zero contas a pagar de aquisição por troca.

⚠ Como todo o financeiro, entra na revisão do contador.

## Onde está no código

- `apps/api/src/modules/financeiro/geracao.service.ts` — `aoFaturarNegocio`
  (filtro `kind: { not: 'trade_in' }`) e `aoRegistrarAquisicao` (retorno cedo e
  cancelamento da prevista).
- `apps/api/test/financeiro-troca.e2e-spec.ts`.
