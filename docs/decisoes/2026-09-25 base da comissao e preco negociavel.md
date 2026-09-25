---
tipo: decisao
data: 2026-09-25
estado: aceita
---

# Base única da comissão, e preço negociável até o contrato

Duas decisões que saíram juntas da Onda 2 (itens 12b e 12c do
[plano de paridade](../planos/plano-paridade-crm.md)), porque mexem no mesmo
número: o dinheiro do negócio.

## Contexto

O [piloto simulado](../produto/piloto-simulado-operacao.md) encenou uma semana
de operação e encontrou, no quinto dia, dois defeitos no dinheiro:

- **B3.** A comissão da mesma vendedora, no mesmo mês, era **R$ 1.950,00** em
  `/equipe` e **R$ 147,50** em `/relatorios`. Uma tela aplicava o percentual
  sobre o faturamento; a outra, sobre a margem bruta. Nenhuma das duas dizia
  qual era a base, e o CSV que o gerente leva para a reunião de pagamento
  carregava a segunda.
- **Item 12 da tabela.** Não havia onde digitar desconto. O valor de venda só
  podia ser informado no instante de abrir o negócio, e só pelo caminho
  `/veiculos/[id]`; aberto pelo card do lead, o negócio nascia no preço de
  tabela e nunca mudava. `PATCH /deals/:id` já aceitava `discount` e
  `saleValue` — era a armadilha nº 1 do CLAUDE.md ("endpoint pronto não é
  funcionalidade") viva na ação mais frequente da venda.

## Decisão

**1. Comissão = percentual do perfil × valor de venda dos negócios faturados,
pela data de fechamento (`closedAt`).** A conta mora numa função só,
`calcularComissao` em `shared/domain/comissao.ts`, usada por `/equipe`,
`/relatorios` e pelo próprio negócio. A janela de tempo varia por tela (mês
corrente em `/equipe`, últimos N dias em `/relatorios`) e cada tela diz qual
está exibindo; a **definição** não varia.

**2. O preço é editável enquanto o negócio está aberto e não há contrato
emitido.** Fora disso, `PATCH /deals/:id` recusa com 409: a partir de `signed`
porque há contrato assinado (`isDealEditable`), e com contrato `issued` ou
`signed` porque o PDF arquivado tem os valores impressos. Para renegociar,
anula-se o contrato e emite-se outro.

## Por quê

### Comissão sobre o valor de venda

1. **A margem é informação de gerência** (`VE_CUSTO`). Comissão sobre margem
   não pode ser mostrada a quem a recebe: `margem = comissão ÷ percentual` e
   `custo = venda − margem` — o vendedor deduz o custo do carro com uma
   divisão. E mostrar a comissão **no negócio** era o pedido do piloto: é lá
   que o vendedor pergunta.
2. **A comissão é um custo do veículo** (`VEHICLE_COST_KINDS.commission`) e
   entra na margem. Calcular comissão como percentual de um número que a
   própria comissão reduz é circular: lançar a comissão como custo mudaria a
   comissão.
3. **A margem só existe congelada depois do faturamento e pode ser negativa.**
   Percentual sobre margem negativa dá comissão negativa, que ninguém sabe
   pagar. O valor de venda é positivo, conhecido e acordado com o cliente.

Faturado, e não assinado, porque faturar é o que congela custo e margem e marca
o veículo como vendido — a mesma definição que o relatório de margem e o funil
por valor já usavam (`DEAL_FATURADO_STATUSES`). Assinado ainda admite distrato.

### Contrato emitido congela o preço

O contrato guarda um **snapshot** com os valores e um `contentHash` conferido no
download, para responder "qual documento essa pessoa recebeu?". Mudar o preço
por baixo dele produziria um negócio de R$ 78.000 com um PDF de R$ 84.900
arquivado — e o hash passaria a confirmar um valor que não é mais o do sistema.
Anular e reemitir custa um clique e mantém a trilha inteira.

## Descartado

- **Comissão sobre a margem, mostrada só à gerência.** É o que muitas lojas
  praticam, e o desenho permite trocar (uma função). Foi descartado agora
  porque esconde do vendedor o número que é dele, e porque a circularidade com
  a comissão-como-custo não tem resposta boa sem uma segunda definição de
  margem.
- **Duas comissões declaradas ("sobre venda" e "sobre margem"), uma por tela.**
  É o estado de hoje com um rótulo. Continuaria dando dois valores para a mesma
  pergunta.
- **Percentual por negócio, em vez de por perfil.** Resolveria lojas com regra
  variável, mas exige migration, tela e histórico; nenhum piloto pediu.
- **Permitir editar o preço com contrato emitido, reemitindo em silêncio.**
  Reemitir sozinho apagaria a decisão de quem assinou o quê. A recusa com
  mensagem dizendo onde clicar é mais barata e mais honesta.

## Onde está no código

- `packages/shared/src/domain/comissao.ts` e `comissao.spec.ts` — a definição,
  em centavos inteiros, com `BASE_DA_COMISSAO`/`EXPLICACAO_DA_COMISSAO` para as
  telas citarem a base.
- `apps/api/src/modules/team/team.service.ts` e
  `modules/relatorios/relatorios.service.ts` — as duas fontes que divergiam.
- `apps/api/src/modules/deals/deals.service.ts` — `comissaoDoNegocio` (a
  própria sempre; a do colega só para gerência) e a recusa de alteração de
  valores com contrato vivo.
- `apps/web/src/app/(dashboard)/negocios/[id]/Preco.tsx` e `Comissao.tsx`.
- `apps/api/test/crm-onda2.e2e-spec.ts` — as duas telas a partir da mesma
  fixture, e o preço congelado pelo contrato.
