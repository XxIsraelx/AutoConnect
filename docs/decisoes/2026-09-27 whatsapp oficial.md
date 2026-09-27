---
tipo: decisao
data: 2026-09-27
estado: aceita
---

# WhatsApp oficial: camada neutra, número da loja e janela de 24 h

Item C1 do [plano de resolução](../planos/plano-resolucao-de-pendencias.md) (item 12
do [plano de paridade](../planos/plano-paridade-crm.md)). Feito pela sessão 2 da
[divisão entre sessões](../planos/divisao-entre-sessoes.md).

## Contexto

A revenda atende no WhatsApp, e o sistema não enxergava essa conversa: o botão do
lead abria o `wa.me` no celular do vendedor, o clique virava uma linha na timeline
e o resto — o que foi dito, quando, quanto tempo levou para responder — ficava
fora. É o dado que o Raio-X promete medir. 11 dos 15 concorrentes levantados têm a
caixa de entrada oficial.

A API oficial (Meta, "API de nuvem") tem três regras que moldam tudo:

- **mensagem livre só até 24 h depois da última mensagem do cliente**; fora disso,
  e no primeiro contato da loja, só **modelo aprovado** pela Meta;
- a Meta **cobra por modelo enviado** (utilidade, marketing, autenticação); a
  resposta dentro da janela, a conversa que o cliente abriu, não é cobrada;
- cada número tem um id (`phone_number_id`), e o webhook é **um só por app**, com
  eventos de todos os números misturados na mesma entrega, assinados com o
  segredo do app (`X-Hub-Signature-256`).

Não há conta na Meta ainda. A decisão 2 do plano de paridade (o custo entra no
preço ou é adicional) continua aberta.

## Decisão

**Camada neutra primeiro, como a cobrança e a assinatura externa:**
`ProvedorDeWhatsApp` no shared, provedor escolhido por `WHATSAPP_FORNECEDOR`
(vazio = desligado, `simulado`, `meta`), e o resto do sistema nunca vê o payload
da Meta.

- **O número é da loja, a credencial é da plataforma.** O app do AutoConnect é o
  provedor de tecnologia; a loja conecta o número em **Canais** informando o
  `phone_number_id`. Um token só (`WHATSAPP_ACCESS_TOKEN`, usuário de sistema do
  app). Uma conta ativa por loja; um número ativo em uma loja só.
- **Cliente que escreve vira lead pelo mesmo caminho do formulário**
  (`LeadsService.criarDeCanal`): deduplicação por telefone canônico, rodízio e
  prazo de primeiro contato. A conversa nasce com `channel = whatsapp`.
- **O vendedor responde pelo mesmo campo do chat.** Dentro da janela, texto livre
  pelo socket; fora dela, a tela esconde o campo e oferece os modelos. A API
  confere a janela antes de gravar — a tela não é a trava.
- **Modelos são um catálogo fechado no shared** (`MODELOS_DE_WHATSAPP`), com o
  texto: o que se grava na conversa é o que o cliente leu, e os parâmetros saem
  do lead, da loja e de quem envia.
- **A mensagem nunca some.** Grava `enviando`, avisa a tela, chama o provedor fora
  da transação, grava o id ou a recusa (`falhou` + motivo). Status do provedor só
  avançam (`statusDeEntregaAvanca`).
- **O uso do mês é medido** (conversas, recebidas, modelos por categoria) em
  **Canais**, para a decisão 2 ser tomada com número em vez de chute.

## Por quê

- **Chave da conversa = telefone canônico, não `wa_id`.** O WhatsApp devolve
  celular brasileiro de conta antiga **sem o nono dígito** (`551187654321`). Com
  o `wa_id` cru como chave, o lead do portal (com o nove) e a resposta do cliente
  (sem) virariam duas conversas. `contatoDoWhatsApp` usa a mesma forma canônica da
  deduplicação de leads. Para **enviar**, usa-se o `wa_id` quando o cliente já
  escreveu (é o endereço que o WhatsApp reconhece), senão 55 + canônico.
- **O corpo cru não é guardado**, ao contrário da cobrança e da assinatura: uma
  entrega pode trazer eventos de várias lojas, e gravá-la na linha de uma loja
  guardaria a conversa da outra. Fica o evento normalizado (só desta loja) e o
  SHA-256 do corpo.
- **Evento que quebra devolve 500; número sem loja devolve 200.** O primeiro faz a
  Meta reentregar (a idempotência torna a repetição inofensiva, e perder a
  mensagem do cliente não é aceitável); o segundo é entrega autêntica para um
  número que ninguém conectou, e insistir não o faria aparecer.
- **Status adiantado é reaplicado.** O "sent" da Meta pode chegar antes de o id
  da mensagem estar gravado aqui; o evento fica pendente e é reaplicado quando o
  envio volta — senão a mensagem ficaria "enviada" para sempre, mesmo lida.
- **Modelo por REST, texto por socket.** O modelo custa: passa pelo guard de
  somente leitura (loja bloqueada não gera custo novo). A resposta dentro da
  janela é gratuita e segue o chat, que já não passava pelo guard.
- **Proposta com botão de aceite não vai pelo WhatsApp**: o botão existe no chat
  do sistema; no WhatsApp viraria um texto sem o aceite que move o negócio.

## Descartado

- **BSP (360dialog, Twilio, Gupshup)** no lugar da Meta direto: cobra por cima da
  Meta e não muda o desenho. Se vier, é outro adaptador.
- **Token por loja guardado no banco**: exigiria cifrar segredo por tenant e
  rotação por loja, para um ganho que o token da plataforma já dá (a loja
  compartilha o número com o app no cadastro incorporado).
- **Número por filial agora**: o índice é uma conta ativa por loja. Relaxar é
  trocar o índice e a tela de Canais, quando uma loja pedir.
- **Baixar mídia (áudio, foto)** já: exige outra chamada à Meta por mídia e um
  destino de arquivo. Hoje a mensagem entra como aviso ("o cliente enviou um
  áudio — abra no WhatsApp"), com a legenda quando há.

## Onde está no código

- `packages/shared/src/domain/whatsapp.ts` (janela, status, contato, modelos,
  contrato do provedor) e `schemas/whatsapp.ts`.
- `apps/api/src/modules/whatsapp/`: `formato-meta.ts` (o formato da Meta nos dois
  sentidos), `provedor.ts` (fábrica), `provedor-simulado.ts`, `provedor-meta.ts`,
  `whatsapp.service.ts`, `whatsapp.controller.ts`.
- `apps/api/src/gateway/chat.gateway.ts` (texto pelo socket) e a sala
  `tenant:<id>` em `chat-eventos.service.ts`.
- `LeadsService.criarDeCanal` (`modules/leads/leads.service.ts`).
- Migration `20260927200000_whatsapp_oficial`: `whatsapp_accounts` e
  `whatsapp_webhook_events` com RLS; `conversations.channel`; índices únicos
  parciais; a constraint `conversations_tem_quem_responde` com a terceira forma.
- Telas: `app/(dashboard)/canais`, `chat` e o botão "WhatsApp da loja" em `leads`.
- Testes: `whatsapp.spec.ts` (shared), `formato-meta.spec.ts`, `provedor.spec.ts`,
  `provedor-meta.spec.ts` e `test/whatsapp.e2e-spec.ts` (32 casos, com o RLS
  aplicado de verdade no CI).

## O que falta para ligar em produção

⚠ **O adaptador da Meta nunca falou com a Meta.** Escrito pela documentação e
testado com `fetch` de mentira. É a única peça que depende da conta.

1. **Conta**: Business Manager verificado, app do tipo "Empresa" com o produto
   WhatsApp, e o número da loja registrado na conta (ou compartilhado com o app
   pelo cadastro incorporado).
2. **Modelos**: criar e aprovar os quatro de `MODELOS_DE_WHATSAPP` com **o mesmo
   nome e o mesmo texto** (idioma `pt_BR`). Se a Meta reclassificar a categoria,
   atualizar o catálogo.
3. **Webhook**: `https://api.autoconnectapp.com.br/api/v1/webhooks/whatsapp`, com
   o `WHATSAPP_VERIFY_TOKEN`, assinando o campo `messages`.
4. **Variáveis no Railway** (serviço da API): `WHATSAPP_FORNECEDOR=meta`,
   `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_GRAPH_URL` — ver `.env.example`.

**O que conferir na primeira conversa real:** o cabeçalho `X-Hub-Signature-256`
contra o corpo cru; o formato do `wa_id` de um celular antigo (sem o nove) e se o
envio para ele volta pelo mesmo `wa_id`; os códigos de erro reais (131047 fora da
janela, 131026 não entregue, 132001 modelo inexistente, 190 token); e o "sent"
chegando antes da resposta do envio.
