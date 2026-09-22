---
tipo: decisao
data: 2026-09-22
estado: aceita
---

# Assinatura eletrônica externa: camada neutra, provedor simulado

## Contexto
O contrato já é emitido com hash e assinado por registro interno (nome, papel,
ip, userAgent, hash aceito). Para uso real a loja quer mandar o contrato a um
provedor de assinatura eletrônica (Clicksign é o candidato), que envia o
convite por e-mail, colhe as assinaturas e devolve o PDF assinado por webhook
— assíncrono, repetido e fora de ordem. Não há conta nem contrato com provedor
ainda.

## Decisão
Uma interface de domínio `ProvedorDeAssinatura` (`@autoconnect/shared`) com
adaptador por provedor, escolhido por `ASSINATURA_FORNECEDOR`. Hoje existem
`ProvedorIndisponivel` (padrão, 503, opção escondida na tela) e
`ProvedorSimulado` (em memória, recusado em produção). Plugar a Clicksign é
escrever um adaptador e um `case` na fábrica.

## Por quê
- **Mesma camada de anticorrupção da consulta veicular.** O payload do
  provedor não sai do adaptador: o resto do sistema vê `envelope`,
  `signatários` e eventos normalizados (`assinou`, `recusou`, `concluido`,
  `expirou`, `cancelado`, `ignorado`). Trocar de provedor não mexe em service,
  tabela nem tela.
- **Formato inspirado na Clicksign**, por ser o provedor provável: envelope com
  signatários de id próprio, webhook com `Content-Hmac: sha256=<hex>` e evento
  de fechamento separado do de assinatura (`auto_close`). O adaptador real vira
  tradução, não redesenho.
- **Webhook autenticado por HMAC-SHA256 do corpo cru**, comparado em tempo
  constante (`assinatura/hmac.ts`). A rota recebe o `Buffer` exato
  (`common/middleware/corpo-cru.ts`, montado só nela, antes do parser JSON):
  reserializar o JSON muda bytes e o HMAC deixaria de bater. HMAC inválido é
  401 antes de qualquer acesso ao banco.
- **Idempotência em duas camadas.** Cada entrega é gravada crua em
  `contract_signature_events` com `(request_id, event_key)` único — a chave é o
  id do evento no provedor ou o SHA-256 do corpo —, e o evento passa por
  `aplicarEventoDeAssinatura`, que é pura: estado terminal não muda mais,
  `concluido` antes do último `assinou` dá o mesmo resultado, repetição é
  no-op. Os webhooks do mesmo envelope são serializados por `SELECT … FOR
  UPDATE` na solicitação.
- **Nenhuma ida à rede dentro de transação**, pela mesma razão da consulta:
  envio = reserva (transação) → provedor → grava (transação); conclusão = baixa
  o PDF assinado → aplica (transação).
- **Um envio vivo por contrato** (`pending`/`sent`), por índice único parcial
  `contract_signature_requests_viva_idx`. O estado `pending` (reservado, antes
  da resposta do provedor) existe para que o clique duplo não crie dois
  envelopes e dois e-mails ao cliente; `pending` com mais de 10 min é marcado
  `failed` no próximo envio.
- **Assinaturas não se misturam.** Com envio vivo, `POST /contracts/:id/sign`
  é 409; com assinatura interna já registrada, o envio externo é 409. Metade
  por dentro e metade pelo provedor deixaria duas trilhas de evidência, nenhuma
  provando sozinha o aceite das duas partes.
- **"Assinado" continua sendo a mesma coisa.** Na conclusão o contrato vai a
  `signed` por `ContractsService.gravarAssinaturas` — o mesmo caminho da
  assinatura interna — com uma `ContractSignature` por parte. A evidência muda:
  `request_id` + `external_signer_id` no lugar de ip/userAgent, e a trilha
  completa fica nos eventos crus. O negócio **não** avança de status sozinho,
  como já não avançava com a assinatura interna.
- **PDF assinado**: SHA-256 gravado na conclusão; arquivo no bucket privado
  quando há Storage, e sem ele só o hash — o download busca no provedor e
  confere o hash antes de entregar (mesma regra do contrato emitido).
- **Cancelamentos**: anular o contrato ou cancelar/distratar o negócio marca o
  envio como cancelado **na mesma transação** (conclusão atrasada passa a ser
  ignorada) e cancela no provedor depois, em melhor esforço com erro no log. O
  cancelamento manual faz o contrário — provedor primeiro —, porque ali falhar
  e deixar o usuário repetir é melhor que dizer "cancelado" com o envelope
  aberto.

### A leitura privilegiada do webhook
O webhook chega sem usuário e sem loja; o único dado é o id do envelope, cuja
autenticidade o HMAC acabou de provar. Achar a loja exige atravessar
concessionárias — o mesmo caso do convite por token, já aceito para
`PrivilegedPrismaService`. A travessia é mínima: `findUnique` por
`(provider, external_id)`, devolvendo só `id` e `tenantId`. Tudo depois roda em
`withTenant` da loja dona. O arquivo está na lista de "atravessa pela conexão
privilegiada, e isso é visível" do `isolamento.spec.ts`.

### Envelope desconhecido: 200, não 404
A entrega é autêntica, então o envelope foi criado com este segredo por outra
instalação (homologação na mesma conta do provedor). Repetir não o fará
aparecer, e 4xx faria o provedor insistir. Responde 200 `envelope-desconhecido`
com aviso no log.

## Descartado
- **Adaptador Clicksign já agora**: sem conta de sandbox não há como testar
  contra o formato real, e um adaptador escrito de cabeça viraria dívida.
- **`rawBody: true` no `NestFactory`**: guardaria o corpo cru de todas as rotas
  e exigiria a mesma opção em cada teste que sobe a app — `configureApp` deixa
  de ser a fonte única da configuração.
- **`express.raw()`**: o `express` não é dependência direta da API e o pnpm não
  o resolve dali; o middleware à mão tem 30 linhas.
- **URL assinada para o PDF assinado**: o front já baixa com `Authorization`
  (como o contrato emitido), e só o servidor consegue conferir o hash antes de
  entregar. O download sai pela API, conferido.
- **`SECURITY DEFINER` no banco para o lookup do webhook**: esconderia a
  travessia numa função SQL, fora do alcance do `isolamento.spec.ts`.

## Onde está no código
- `packages/shared/src/domain/assinatura-externa.ts` (+ `.spec.ts`) — interface,
  estados, `aplicarEventoDeAssinatura`
- `apps/api/src/modules/contracts/assinatura/` — `provedor.ts` (fábrica e
  indisponível), `provedor-simulado.ts`, `hmac.ts`, `assinatura-externa.service.ts`,
  `assinatura-externa.controller.ts`
- `apps/api/src/common/middleware/corpo-cru.ts` e `app.setup.ts`
- Migration `20260922120000_assinatura_externa` — `contract_signature_requests`,
  `contract_signature_events`, índice parcial, RLS, `deal_buyers.email`,
  `tenants.legal_rep_email`, `contract_signatures.request_id/external_signer_id`
- `apps/api/test/assinatura-externa.e2e-spec.ts`
- Web: `negocios/[id]/AssinaturaExterna.tsx`

## O que o adaptador Clicksign vai precisar
- Env: `ASSINATURA_FORNECEDOR=clicksign`, `ASSINATURA_WEBHOOK_SECRET` (o
  *secret* do webhook no painel), mais token de API e URL base
  (sandbox/produção) — a desligar em `test/setup-e2e.ts` como as demais.
- `criarEnvelope`: criar envelope, subir o documento (base64), criar os dois
  signatários (nome, e-mail, CPF), requisitos de assinatura/autenticação,
  ativar o envelope e disparar a notificação. Guardar os ids dos signatários.
- `cancelar`: cancelar o envelope. `baixarAssinado`: baixar o documento
  assinado quando o envelope fechar.
- `interpretarWebhook`: conferir `Content-Hmac`, mapear `sign` → `assinou`,
  `refusal` → `recusou`, `auto_close`/`close` → `concluido`, `deadline` →
  `expirou`, `cancel` → `cancelado`, o resto → `ignorado`.
- Cadastrar o webhook apontando para `<API>/api/v1/webhooks/assinatura`.
