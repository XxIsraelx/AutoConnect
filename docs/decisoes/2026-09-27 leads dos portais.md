---
tipo: decisao
data: 2026-09-27
estado: aceita
---

# Leads dos portais: endereço de entrada por loja, capturar agora e entender depois

Item C2 do [plano de resolução](../planos/plano-resolucao-de-pendencias.md) (item 13
do [plano de paridade](../planos/plano-paridade-crm.md)). Feito pela sessão 2 da
[divisão entre sessões](../planos/divisao-entre-sessoes.md). OLX primeiro, pela
[divisão](../planos/divisao-entre-sessoes.md) — que respondeu a decisão 3.

## Contexto

O lead do portal (OLX, Webmotors, iCarros, Mercado Livre) chega hoje no e-mail da
loja, e alguém copia nome e telefone para o sistema — ou não copia. 13 de 15
produtos do levantamento captam lead de portal. Publicar o estoque nos portais é
outro item (Onda 5); este é a **entrada**.

Não há conta de integração com nenhum portal, nem um e-mail real de lead da OLX
para usar de amostra. O formato exato de cada notificação é desconhecido.

## Decisão

**Cada loja ganha um endereço de entrada por portal**, com um token só: uma URL de
webhook (`/webhooks/portais/<token>`) e um e-mail de encaminhamento
(`leads+<token>@<domínio de entrada>`). O token aparece uma vez; o banco guarda o
hash.

**Capturar agora, entender depois.** Toda entrega é guardada crua
(`portal_deliveries`). O que o sistema sabe ler vira lead na hora, pelo mesmo
caminho do formulário (`LeadsService.criarDeCanal`: deduplicação, rodízio, prazo),
com a origem `portal` e o portal em `metadata.portal`. O que não sabe fica
visível em **Canais** como "não entendido" e é **reprocessado** quando o leitor
daquele portal existir.

**Quem lê hoje:**
- webhook: o **formato AutoConnect** (`leadDePortalSchema`) — que qualquer
  integração (Zapier, Make, RD Station, o próprio portal) consegue montar;
- e-mail: um **leitor genérico** (`interpretarEmailDeLead`) que procura os rótulos
  que os portais usam ("Nome:", "Telefone:", "Mensagem:", "Anúncio:"), em linha ou
  em tabela HTML.

O leitor específico de cada portal entra quando houver amostra real.

## Por quê

- **Guardar o cru é o que torna seguro começar sem amostra.** Um leitor da OLX
  escrito por adivinhação erraria calado; com o cru guardado e o reprocessamento,
  errar custa um clique depois — o lead não se perde enquanto o leitor não chega.
- **Aqui o cru é guardado; no WhatsApp, não.** O endereço é de uma loja só, então
  a entrega inteira é dela. No WhatsApp, uma entrega mistura várias lojas.
- **E-mail é o caminho universal.** Todo portal avisa por e-mail; nem todo tem
  webhook, e os que têm exigem contrato de integrador. Encaminhar é configuração
  da caixa da loja, sem pedir nada ao portal.
- **Token hexadecimal minúsculo**, não base64: parte da cadeia de encaminhamento
  troca maiúsculas por minúsculas na parte local do endereço.
- **A confirmação do Gmail aparece na tela.** Para encaminhar automaticamente, o
  Gmail manda um código **para o endereço daqui**; sem mostrá-lo, o dono
  configuraria o encaminhamento e ele nunca começaria a valer. A entrega vira
  "aviso" com o código (`codigoDeConfirmacaoDoGmail`).
- **Só telefone rotulado entra.** Um número solto no e-mail costuma ser o da
  própria loja ou do portal, no rodapé.
- **O carro não é vinculado sozinho.** Casar título de anúncio com estoque por
  texto erraria o carro; o anúncio vai na mensagem do lead (título, preço,
  código, link), e o vendedor vincula com um clique.
- **Não é erro para quem envia.** Corpo fora do formato responde 200 e fica
  guardado: um 4xx faria o portal reenviar para sempre algo que só um leitor novo
  vai entender. Token inexistente é 404 (a URL está errada); destinatário de
  e-mail sem loja é 200 com descarte (a mensagem é autêntica, e reenviar não a
  faria achar dono).

## Descartado

- **Ler a caixa da loja por IMAP**: exigiria guardar a senha do e-mail da loja.
- **Um endereço por loja para todos os portais**: sem saber de qual portal veio,
  o leitor específico e o rótulo "OLX" no lead dependeriam de adivinhar pelo
  remetente — que o encaminhamento às vezes reescreve.
- **Um valor de `LeadSource` por portal**: multiplicaria o enum a cada integração.
  A origem é `portal`; qual portal fica no `metadata`.

## Onde está no código

- `packages/shared/src/domain/portais.ts` (portais, lead normalizado, formato
  AutoConnect, leitor genérico, confirmação do Gmail, endereço de entrada) e
  `schemas/portais.ts`.
- `apps/api/src/modules/portais/`: `email-de-entrada.ts` (provedor neutro, simulado
  e Postmark), `leitores.ts` (funções puras sobre o cru), `portais.service.ts`,
  `portais.controller.ts`.
- Migration `20260927201000_leads_dos_portais`: `portal_connections` e
  `portal_deliveries` com RLS; `LeadSource.portal`; uma conexão ativa por loja e
  portal.
- Tela: cartão "Leads dos portais" em `app/(dashboard)/canais`.
- Testes: `portais.spec.ts` (shared), `email-de-entrada.spec.ts` e
  `test/portais.e2e-spec.ts` (19 casos, com o RLS aplicado no CI).

## O que falta para ligar em produção

1. **E-mail de entrada**: uma conta no Postmark (Inbound) com um subdomínio — por
   exemplo `entrada.autoconnectapp.com.br`, com o MX apontando para o Postmark — e
   o webhook de entrada em
   `https://entrada:<EMAIL_ENTRADA_TOKEN>@api.autoconnectapp.com.br/api/v1/webhooks/email-de-entrada`.
   Variáveis: `EMAIL_ENTRADA_FORNECEDOR=postmark`, `EMAIL_ENTRADA_TOKEN`,
   `EMAIL_ENTRADA_ENDERECO` (`.env.example`). Sem isso, só a URL de webhook
   funciona — e a tela diz.
2. **Uma notificação real da OLX** (e de cada portal): encaminhada para o
   endereço de uma loja, ela fica guardada; se o leitor genérico não a entender,
   vira o caso de teste do leitor específico, e as entregas guardadas são
   reprocessadas.

⚠ **O adaptador do Postmark nunca recebeu um e-mail de verdade** — escrito pela
documentação. Conferir na primeira entrega: o `OriginalRecipient` com o `+token`,
e o Basic auth chegando no cabeçalho.
