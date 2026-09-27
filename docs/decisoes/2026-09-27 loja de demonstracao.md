---
tipo: decisao
data: 2026-09-27
estado: aceita
---

# Loja de demonstração

## Contexto
Em produção existe uma loja fictícia, slug `demo` ("Aurora Seminovos"), com 22 carros
publicados. Ela aparecia na busca e no mapa para comprador de verdade, que podia mandar lead ou
agendar test drive com uma loja que não existe
([pendência de 27/09/2026](../planos/estado-e-pendencias.md)). Ao mesmo tempo, a
[nova landing](../planos/plano-nova-landing.md) precisa mostrar o produto funcionando para o
lojista em prospecção.

## Decisão
A Aurora fica, marcada como **loja de demonstração** (`tenants.is_demo`): fora da busca global,
do mapa e das buscas salvas; a vitrine `/c/demo` e a página de cada carro continuam no ar, com
uma faixa "Loja de demonstração" e `noindex`. A landing linka `/c/demo`.

## Por quê
Uma vitrine de verdade, navegável, mostra mais que qualquer print — mas só se nenhum comprador
chegar a ela pela busca. O que separa as duas coisas é a busca *entre lojas* (sem `tenantId`),
não a loja em si: por isso o filtro mora na busca global e no mapa, e a vitrine da própria loja
não muda.

## Descartado
- **Tirar a loja (`is_active = false`)**: resolve o comprador, mas a landing fica sem nada ao
  vivo para mostrar.
- **Filtrar pelo slug `demo`** em vez de uma coluna: amarra a regra a um nome e não serve para
  uma segunda loja de demonstração.
- **Bloquear lead e agendamento na loja demo**: o lojista em prospecção quer justamente testar o
  formulário; a faixa avisa quem cair por link direto.

## Onde está no código
- Migration `20260927130000_loja_de_demonstracao` (coluna e marcação da `demo`).
- `FORA_DA_DEMONSTRACAO` em `apps/api/src/modules/catalog/catalog.service.ts`; filtro do mapa em
  `map.service.ts`.
- `AvisoDeDemonstracao` em `/c/[slug]` e `/catalogo/[id]`, com `robots: noindex`.
- `apps/api/test/loja-de-demonstracao.e2e-spec.ts`.
- Pendente: descobrir como a Aurora foi criada em produção (a nota de pendências registra que o
  banco não tinha sido semeado).
