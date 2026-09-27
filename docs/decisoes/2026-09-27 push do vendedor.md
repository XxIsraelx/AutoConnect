---
tipo: decisao
data: 2026-09-27
estado: aceita
---

# Push do vendedor: Web Push com VAPID, sem aplicativo de loja

Item C3 do [plano de resolução](../planos/plano-resolucao-de-pendencias.md) (item 14
do [plano de paridade](../planos/plano-paridade-crm.md)). Feito pela sessão 2 da
[divisão entre sessões](../planos/divisao-entre-sessoes.md).

## Contexto

O rodízio entrega o lead ao vendedor da vez e o prazo de primeiro contato começa a
correr — mas o aviso era a contagem no menu e uma notificação do navegador que só
saía **com o painel aberto** (polling de 30 s). No pátio, com o celular no bolso,
o lead esperava e o prazo estourava. MobiGestor e Autoconf têm app nas lojas.

## Decisão

**Web Push padrão (RFC 8030 + VAPID, RFC 8292)**, pelo service worker do próprio
site — sem aplicativo de loja. O provedor fica atrás de `ProvedorDePush`
(`PUSH_FORNECEDOR`: vazio · `simulado` · `webpush`), como os outros canais.

**O que avisa:**
- lead novo → o vendedor da vez; sem responsável (rodízio desligado, ninguém de
  plantão) → a gerência (`tenant_admin` e `manager`);
- mensagem do cliente (WhatsApp, visitante do link, cliente com conta) → quem
  cuida da conversa. No WhatsApp, a primeira mensagem de alguém novo gera só o
  aviso de lead (que já leva o texto), não dois.

**Cada aparelho é uma inscrição**, identificada pelo endpoint do serviço de push
do navegador. Ativa-se em **Canais** ou pelo convite da barra lateral.

## Por quê

- **Sem conta de terceiro e sem loja de aplicativos.** As chaves VAPID são
  geradas uma vez (`npx web-push generate-vapid-keys`); Chrome, Firefox, Edge e
  Safari (macOS, e iOS 16.4+ com o app na tela inicial) conferem sozinhos. O
  manifesto já era `standalone`.
- **O service worker não intercepta requisição.** Só `push` e
  `notificationclick`: um cache mal invalidado serviria tela velha depois de um
  deploy.
- **O aviso nunca derruba quem chamou.** Sai depois do commit, sem `await`; falha
  vira log. Um serviço de push fora do ar não pode fazer o webhook do WhatsApp
  responder erro.
- **Uma segunda tentativa para falha passageira** (rede, 429, 5xx), 2 s depois. A
  verificação local mostrou um "Socket timeout" até o serviço do Google que, sem
  ela, teria perdido o aviso de um lead.
- **Inscrição expirada sai no primeiro envio** (404/410 do serviço): é o
  navegador dizendo que desinstalaram ou limparam os dados.
- **O aparelho muda de dono.** Sair da conta desinscreve o aparelho; e inscrever
  um aparelho que estava com alguém de **outra loja** toma a inscrição — o único
  passo privilegiado, pelo endpoint, que só o próprio navegador tem. Sem isso, os
  leads da pessoa anterior continuariam aparecendo no celular da nova.
- **Etiqueta por lead e por conversa**: dez mensagens do mesmo cliente
  substituem o aviso anterior em vez de virarem dez; `renotify` faz vibrar de novo.
- **O aviso da aba aberta (o polling antigo) cala quando o push está ativo** no
  aparelho — senão o lead chegaria duas vezes, uma genérica.
- **TTL de 6 h**: um aviso de lead de ontem não serve para nada.

## Descartado

- **App nativo (React Native, Capacitor)**: loja de aplicativos, conta de
  desenvolvedor e um segundo produto para manter, para entregar o mesmo aviso.
- **Firebase Cloud Messaging direto**: amarra ao Google; o Web Push padrão passa
  pelo FCM no Chrome de qualquer jeito, sem a dependência.
- **Aviso de prazo vencendo** agora: exigiria outro cron; o aviso de lead novo já
  chega no começo do prazo. Fica para quando houver pedido.

## Onde está no código

- `packages/shared/src/domain/push.ts` (texto das notificações, contrato,
  schema da inscrição).
- `apps/api/src/modules/users/push/`: `provedor.ts` (fábrica, simulado, Web Push),
  `push.service.ts`, `push.controller.ts`.
- Disparos: `LeadsService` (formulário, site, manual, canal), `CatalogService`
  (troca), `WhatsappService`, `ConversationsService` (visitante) e o gateway do
  chat (cliente com conta).
- Migration `20260927202000_push_do_vendedor` (`push_subscriptions` com RLS).
- `apps/web/public/sw.js`, `src/lib/push.ts`, `components/notificacoes/`, o
  convite na barra lateral e o logout que desinscreve.
- Testes: `push.spec.ts` (shared), `provedor.spec.ts` e `test/push.e2e-spec.ts`.

## O que falta para ligar em produção

Só as chaves — não há conta a abrir. No serviço da API no Railway:
`PUSH_FORNECEDOR=webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (as duas de
`npx web-push generate-vapid-keys`, geradas uma vez e **nunca trocadas** — trocar
invalida todas as inscrições) e `VAPID_SUBJECT` (`mailto:` do suporte).

Verificado localmente de ponta a ponta com o Web Push real: o Chrome se
inscreveu no serviço de push do Google, a API mandou o teste e o aviso de um lead
novo, e o service worker os mostrou.
