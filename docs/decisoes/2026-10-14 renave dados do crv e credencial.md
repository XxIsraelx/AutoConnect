---
tipo: decisao
data: 2026-10-14
estado: aceita
---

# RENAVE: o código de segurança do CRV não é gravado, e a credencial da integradora fica no `.env`

## Contexto

A R2 do [plano fiscal](../planos/plano-fiscal-renave-nfe.md) põe uma camada
neutra (`ProvedorDeRenave`) entre o AutoConnect e a integradora. O manual do
renave-ws (SERPRO, lido em 14/10/2026) mostra que transmitir pede dados que o
sistema não tem:

- **entrada:** placa, RENAVAM, tipo e número do CRV, **código de segurança do
  CRV**, hodômetro com a data da medição e o documento do proprietário atual;
- **saída:** placa, RENAVAM, **código de segurança do CRV** e o documento do
  comprador.

O código de segurança é o que autoriza a transferência do veículo — quem o tem
consegue comandar operação sobre o carro. E a credencial da loja na
integradora seria o primeiro segredo **por loja** guardado no banco: nenhum
módulo faz isso hoje.

## Decisão

1. **O código de segurança do CRV é pedido no envio, repassado à integradora e
   nunca gravado** — nem na linha, nem no snapshot, nem no corpo guardado da
   resposta. Reenviar pede de novo. RENAVAM, tipo e número do CRV e o
   hodômetro entram no snapshot, porque estão impressos no CRLV que circula
   com o carro.
2. **A credencial da integradora fica no `.env`** (`RENAVE_FORNECEDOR` e as
   variáveis do adaptador), como conta de parceiro da plataforma com a loja
   identificada pelo CNPJ. Nenhum segredo por loja no banco nesta fase.

## Por quê

O código de segurança é a mesma classe de dado da senha do certificado A1
(N3 do plano): serve para um ato e não precisa existir depois dele. Guardado,
cada backup, cada log de consulta e cada acesso privilegiado vira um caminho
para comandar a transferência de um carro de cliente. A integradora já o tem;
nós não precisamos.

Segredo por loja exige cifra com chave da plataforma, rotação e um plano para
o dia em que a chave vazar. Isso merece decisão própria, com a integradora
escolhida na mão (R3) — e a R2 roda com o simulado, que não tem credencial.

## Descartado

- **Guardar o código cifrado para reenviar sem perguntar.** Poupa uma digitação
  no caso raro (falha de rede) em troca de um dado que autoriza transferência
  parado no banco.
- **Pedir o código na aquisição do veículo**, junto do custo. Seria guardá-lo
  por semanas para usar uma vez.
- **Credencial por loja já na R2.** Sem integradora escolhida, seria desenhar o
  cofre antes de saber o formato da chave.

## Onde está no código

- `packages/shared/src/schemas/renave.ts` — `enviarRenaveSchema` (o código entra
  só no corpo do envio).
- `apps/api/src/modules/renave/renave-integracao.service.ts` — monta o pedido ao
  provedor e grava o snapshot **sem** o código; o e2e confere que ele não
  aparece em nenhuma coluna.
- `apps/api/src/modules/renave/provedor.ts` — fábrica pelo `.env`.
