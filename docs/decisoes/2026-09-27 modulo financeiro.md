---
tipo: decisao
data: 2026-09-27
estado: aceita
---

# Módulo financeiro entra — gerencial, não fiscal

## Contexto

O [levantamento de vendas](../planos/levantamento-vendas-e-contratos.md), na
pergunta 2, recomendava **parar no DRE por veículo e comissão**: contas a
pagar/receber, conciliação bancária e fiscal completo seria "virar ERP e disputar
com TOTVS e CIGAM". A pendência ficou aberta por 24 dias esperando decisão.

O que pesava de cada lado, na conversa de 27/09/2026:

- **Contra:** financeiro sério puxa plano de contas, conciliação, regime
  tributário e obrigações acessórias; puxaria de volta a NF-e, adiada no mesmo
  dia; e é o módulo que cobra manutenção todo mês porque a regra muda por fora.
  A pergunta que o lojista mais faz — "esse carro deu lucro?" — já está
  respondida pelo DRE por veículo, que existe.
- **A favor:** financeiro aparece nas faixas de cima de todos os concorrentes com
  preço público (Pro da Autoconf a R$ 499, Ultra da ecosys AUTO a R$ 1.497,
  Altimus). Sem ele, o nosso Profissional compete **só pelo CRM** contra pacotes
  que dizem fazer tudo, e é um motivo de "não troco de sistema" para a loja que
  já centralizou o caixa em outro lugar.

## Decisão

**O AutoConnect passa a ter módulo financeiro**, no escopo de **financeiro
gerencial completo**: contas a pagar e a receber, contas (caixa, banco,
adquirente), plano de contas, fluxo de caixa previsto e realizado, DRE gerencial
mensal, fechamento de mês, conciliação bancária por OFX e exportação para o
contador. Plano em [plano-financeiro](../planos/plano-financeiro.md), em 6 fases.

**Fiscal continua fora**: SPED, apuração de imposto e folha de pagamento. A NF-e
segue adiada, como decidido no mesmo dia.

## Por quê

A divisão que sustenta a decisão é **de destinatário, não de tamanho**: o
financeiro gerencial responde ao dono da loja ("tenho dinheiro para pagar o mês
que vem?"); o fiscal responde ao Estado e tem o contador como usuário. O primeiro
usa dados que o sistema **já tem** — aquisição, preparação, pagamento composto do
negócio, comissão — e por isso nasce melhor aqui que numa planilha. O segundo
exigiria um produto inteiro, com prazo legal e multa do outro lado.

A recomendação antiga não estava errada no risco que apontava; ela errava em
tratar "financeiro" como uma coisa só. A fronteira desenhada agora mantém a
proteção (não viramos ERP nem contabilidade) sem abrir mão do que o mercado cobra.

## Descartado

- **Não fazer nada** — mantém o Profissional competindo só pelo CRM na faixa em
  que o concorrente entrega caixa.
- **Três relatórios finos** (contas a receber do negócio, extrato de comissão,
  exportação para o contador), que era a minha recomendação intermediária: resolve
  30% com 10% do custo, mas não responde "em que dia o caixa fica negativo", que é
  a pergunta semanal do dono.
- **Financeiro com fiscal** — dobra o escopo, puxa a NF-e de volta e coloca prazo
  legal no caminho crítico de um produto que ainda não tem o primeiro cliente
  pagante.
- **Open Finance na primeira volta** — certificado, homologação e contrato com
  instituição. OFX resolve 90% com 10% do custo.

## Onde está no código

Nada ainda: a Fase 1 abre as tabelas (`financial_accounts`,
`financial_categories`, `financial_entries`, `financial_periods`), todas com
`tenant_id` e policy `tenant_isolation` na própria migration. As cinco regras do
módulo (dinheiro em `Decimal`, saldo derivado, um número e uma fonte, nada apaga,
financeiro é de gerência) estão no topo do
[plano](../planos/plano-financeiro.md).

⚠ **Nada do financeiro foi revisado por contador** — o mesmo aviso do template de
contrato sem advogado. Entra na revisão da Onda B.
