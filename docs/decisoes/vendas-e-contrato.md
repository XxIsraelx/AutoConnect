# Vendas e contrato

> Extraído do [CLAUDE.md](../../CLAUDE.md) em 22/09/2026. Lá fica a regra curta; aqui, o porquê.

## Dinheiro nunca é `number`

`Decimal(14,2)` no banco, `Prisma.Decimal` no cálculo, **string** no JSON. No
front, `formatarBRL` do `@autoconnect/shared` formata a partir da string, sem
passar por ponto flutuante. `0.1 + 0.2` não é `0.3`, e um centavo numa comissão
vira ligação do vendedor.

`packages/shared/src/domain/dinheiro.ts` faz aritmética em centavos inteiros
(`bigint`) para quem precisa somar no navegador.

## Um veículo, um negócio vivo

Índice único parcial `deals_veiculo_negocio_vivo_idx`, com
`WHERE status NOT IN ('canceled','rescinded')`. A checagem no service não
resolveria: entre o `SELECT` que confere e o `INSERT` que grava cabe outra
transação, e o resultado é o mesmo carro vendido duas vezes, descoberto na
entrega.

Se `DEAL_TERMINAL_STATUSES` mudar, **este índice muda junto** — há teste que
liga as duas listas.

## A máquina de estados mora no `shared`

`DEAL_TRANSITIONS` é consultada pelo front (para decidir quais botões mostrar) e
pelo back (para recusar). Duas cópias da regra produz um botão que abre diálogo
e termina em 409. Transição inválida é **409, não 400**: o pedido é bem formado,
o estado é que conflita.

Assimetria deliberada: antes de `signed` o negócio é **cancelado**; depois dela,
**distratado**. São eventos jurídicos diferentes.

## Contrato

Três garantias, e uma armadilha medida:

1. **Template versionado por tenant.** Editar cria versão nova; o contrato
   aponta para a versão exata que usou.
2. **Snapshot, não join.** Se o preço do veículo mudar, o contrato assinado não
   muda junto.
3. **Hash na emissão**, e o download **regenera** o PDF do snapshot e confere o
   hash antes de entregar. Não bate, não sai.

⚠ **O pdfmake não é determinístico por padrão** — ele carimba o relógio na data
de criação, e o mesmo contrato gera bytes diferentes a cada execução. Medido,
não suposto. `ContractPdfService.gerar()` recebe `emitidoEm` e o usa como data
de criação; sem isso o hash não prova nada. Fontes Helvetica embutidas no
pdfkit: nenhum arquivo de fonte no deploy.

Contrato que saiu de `draft` é **imutável por trigger no banco**
(`contrato_emitido_e_imutavel`), não só por regra de service — ali é uma linha
que alguém remove sem perceber, e o efeito só aparece quando um cliente
contesta a assinatura.

## Garantia: a cláusula que não se deve conseguir escrever

`validarGarantia` recusa emitir contrato em que a garantia contratual apareça
como **redução** da legal de 90 dias, que cobre o veículo inteiro (CDC art. 26,
II + art. 51, I). A regra é específica: prazo curto **sem** restrição de escopo
passa — o que se recusa é prazo menor **combinado** com escopo restrito, que é
o disfarce clássico ("3 meses de motor e câmbio").

`textoDaGarantia` sempre declara a legal, mesmo havendo contratual: omiti-la é
o que torna a cláusula abusiva.

## As duas partes precisam estar identificadas

O contrato recusa emissão sem qualificação do **comprador** (`DealBuyer`:
nome, CPF validado por dígitos, RG, endereço) e sem **representante legal** da
loja (`Tenant.legalRepName/Cpf/Role`, configurado uma vez). Um documento que
diz "portador(a) do documento ____" parece contrato e não identifica quem se
obrigou.

O comprador fica no negócio, não no perfil do cliente: a loja não escreve em
`customer_profiles` (isolado por `app.user_id`), e o contrato precisa do dado
como estava na emissão.

## Consulta veicular

Cache antes de idempotência, idempotência antes da chamada — **cada consulta é
cobrada por chamada**. TTL por tipo (débito 24h, leilão 90 dias) e cache por
concessionária: compartilhar revelaria que a concorrente consultou aquela placa.

A chamada ao fornecedor fica **fora** do `withTenant`: relançar erro dentro da
transação desfazia por rollback o próprio registro da falha, e a loja veria
cobrança na fatura sem correspondente no sistema.

Sem `CONSULTA_FORNECEDOR`, a API recusa com mensagem clara em vez de devolver
"nada encontrado" — que viraria selo afirmando carro limpo com base em consulta
que nunca aconteceu. O valor `simulado` é ignorado em produção.

> ⚠ **O template padrão do código não foi revisado por advogado.** Está
> declarado como ponto de partida. O portão da Fase 2 exige essa revisão antes
> de qualquer cliente real emitir contrato.
