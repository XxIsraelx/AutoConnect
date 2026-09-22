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
adaptador por provedor, escolhido por `ASSINATURA_FORNECEDOR`. Existem
`ProvedorIndisponivel` (padrão, 503, opção escondida na tela),
`ProvedorSimulado` (em memória, recusado em produção) e `ProvedorClicksign`
(API 3.0, ver [Adaptador Clicksign](#adaptador-clicksign-api-30)).

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
- **Adaptador Clicksign antes da conta de sandbox**: um adaptador escrito de
  cabeça viraria dívida. Ele só foi escrito com o sandbox em mãos (ver abaixo).
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
  indisponível), `provedor-simulado.ts`, `provedor-clicksign.ts` (+ `.spec.ts`),
  `hmac.ts`, `assinatura-externa.service.ts`,
  `assinatura-externa.controller.ts`
- `apps/api/src/common/middleware/corpo-cru.ts` e `app.setup.ts`
- Migration `20260922120000_assinatura_externa` — `contract_signature_requests`,
  `contract_signature_events`, índice parcial, RLS, `deal_buyers.email`,
  `tenants.legal_rep_email`, `contract_signatures.request_id/external_signer_id`
- `apps/api/test/assinatura-externa.e2e-spec.ts`
- Web: `negocios/[id]/AssinaturaExterna.tsx`

## Adaptador Clicksign (API 3.0)

`apps/api/src/modules/contracts/assinatura/provedor-clicksign.ts`, ligado por
`ASSINATURA_FORNECEDOR=clicksign` com `CLICKSIGN_ACCESS_TOKEN`,
`CLICKSIGN_API_URL` (base sem `/api/v3`, https) e `ASSINATURA_WEBHOOK_SECRET`.
Faltando qualquer um, a fábrica loga erro e devolve o indisponível — o boot
não cai. `test/setup-e2e.ts` zera as `CLICKSIGN_*`.

JSON:API (`Accept`/`Content-Type: application/vnd.api+json`), token cru em
`Authorization`, `fetch` global com timeout de 20 s por chamada. Não 2xx vira
erro com o `detail` da Clicksign e sem o token: 400/422 → 422, 401/403 → 503
("verifique CLICKSIGN_ACCESS_TOKEN"), 429 → 503, resto → 502, timeout → 504.

### Envio (`criarEnvelope`)
1. `POST /envelopes` — `name`, `locale: pt-BR`, `auto_close: true`,
   `deadline_at` (prazo), `block_after_refusal: true` e
   **`deadline_partial_signature_action: canceled`**: sem isso o prazo vencido
   com uma só assinatura *finaliza* o documento — contrato bilateral assinado
   por uma parte.
2. `POST /envelopes/:id/documents` — `filename`, `content_base64` como data URI
   (`data:application/pdf;base64,…`) e `metadata` (ver webhook).
3. `POST /envelopes/:id/signers` × 2 — nome, e-mail, `has_documentation: true`,
   `documentation` = CPF formatado quando há, `refusable: true` (o padrão da
   Clicksign é não deixar recusar), comunicação por e-mail.
4. `POST /envelopes/:id/requirements` × 4 — por signatário, qualificação
   (`action: agree`, `role`) e autenticação (`action: provide_evidence`,
   `auth: email`, token por e-mail).
5. `PATCH /envelopes/:id` com `status: running` (ativa).
6. `POST /envelopes/:id/notifications` (dispara os e-mails).

Falha em qualquer passo depois do 1 desfaz na Clicksign (rascunho excluído,
ativo cancelado) e propaga o erro original. Nome sem sobrenome é recusado
antes da primeira chamada — a Clicksign exige nome e sobrenome.

**Qualificação por papel:** `dealer` → `seller` (Parte vendedora), `customer`
→ `buyer` (Parte compradora) — é o que as partes são num contrato de compra e
venda. `party` seria genérico demais; `contractor`/`contractee` são de
prestação de serviço.

### Cancelamento e PDF assinado
Na 3.0 o envelope só vai de `draft` a `running`: rascunho se exclui
(`DELETE /envelopes/:id`); ativo se cancela **por documento**
(`PATCH /envelopes/:id/documents/:doc` com `status: canceled`). Já cancelado é
no-op; já finalizado (`closed`) é 409.
`baixarAssinado` lista os documentos, lê o detalhe e baixa
`links.files.signed` — URL pré-assinada do S3 (~5 min), baixada sem o token.
Documento ainda não `closed` ou sem o link → 503, e o webhook responde 5xx
para a Clicksign reentregar.

### Webhook
**Cabeçalho do HMAC.** A página técnica
[Segurança de Webhooks](https://developers.clicksign.com/docs/seguranca-de-webhooks)
diz `Content-Hmac: sha256=<hex>` (HMAC-SHA256 do corpo com o *secret* do
webhook). O FAQ da [página inicial do portal](https://developers.clicksign.com/)
diz que "cada aviso inclui o cabeçalho `x-clicksign-signature`", sem formato.
Aceitamos os dois, com o mesmo segredo e comparação em tempo constante:
`Content-Hmac` exige o prefixo `sha256=`; `x-clicksign-signature` aceita com
ou sem ele. Nenhum outro cabeçalho vale. A primeira entrega real deve dizer
qual deles a Clicksign manda — aí o outro pode sair.

**Envelope pelos metadados.** O webhook é por documento: `document.key` é o
id do documento, não o do envelope que guardamos. O upload grava em
`metadata` (que a Clicksign devolve "com o documento nos webhooks")
`autoconnect_envelope` e `autoconnect_papeis` (`sha256(e-mail)` → papel — hash
para não pôr e-mail em metadado). Como o corpo inteiro passa pelo HMAC, o
metadado é tão confiável quanto o resto. Sem ele, o adaptador devolve o id do
documento e o service responde 200 `envelope-desconhecido` com aviso.

**Quem assinou.** `idSignatarioExterno` = `event.data.signer.key`, `papel` =
pelo hash do `signer.email`. `aplicarEventoDeAssinatura` casa pelo id e, se o
id não casar com ninguém, pelo papel — a doc não garante que o `signer.key`
do webhook seja o id devolvido pela API 3.0.

| Evento Clicksign | Normalizado | Observação |
|---|---|---|
| `sign` | `assinou` | traz `data.signer` |
| `refusal` | `recusou` | traz `data.signer`; com `block_after_refusal` encerra |
| `auto_close` | `concluido` | logo após a última assinatura |
| `document_closed` | `concluido` | arquivo pronto para download |
| `close` | `concluido` | finalização manual no painel |
| `deadline` | `expirou` | horário em `data.reached_at` |
| `cancel` | `cancelado` | |
| qualquer outro | `ignorado` | `upload`, `add_signer`, `signature_started`… |

Três eventos concluem de propósito: se o `auto_close` chega antes de o PDF
assinado existir, o download dá 503, a entrega volta, e o `document_closed`
também conclui. A repetição é no-op pela máquina de estados.

### Smoke test no sandbox (22/09/2026)
Script fora do repositório, com o adaptador real: criou envelope, documento,
dois signatários `@example.com` (um com CPF) e os quatro requisitos — todos
201 —, **sem ativar nem notificar** (as duas chamadas foram interceptadas).
Leitura de volta confirmou `deadline_partial_signature_action: canceled`,
`block_after_refusal: true`, metadados gravados como objeto, `refusable: true`,
requisitos `agree:buyer`, `agree:seller`, `provide_evidence:email`. O
cancelamento excluiu o rascunho (204; GET seguinte 404). O caminho de erro
(nome de uma palavra → 400 da Clicksign) virou 422 com o `detail`, sem o
token, e também excluiu o rascunho. O sandbox ficou limpo.

**Não verificado** (exige assinar de verdade): o cabeçalho do HMAC na entrega
real, o nome `signed` do link do PDF assinado e se `signer.key` = id 3.0.

### O que falta para ligar
- Cadastrar o webhook na Clicksign (painel ou `POST /api/v3/webhooks`)
  apontando para `<API>/api/v1/webhooks/assinatura`, com os eventos `sign`,
  `refusal`, `auto_close`, `document_closed`, `close`, `deadline`, `cancel`, e
  pôr o *secret* gerado em `ASSINATURA_WEBHOOK_SECRET`.
- No Railway: `ASSINATURA_FORNECEDOR=clicksign`, `CLICKSIGN_ACCESS_TOKEN`,
  `CLICKSIGN_API_URL`, `ASSINATURA_WEBHOOK_SECRET`. Com URL de sandbox e
  `NODE_ENV=production` a API liga mas avisa no log: sandbox não tem validade.
- Uma assinatura de ponta a ponta no sandbox para fechar os três pontos não
  verificados acima.
- Conta de produção da Clicksign (contrato comercial).
