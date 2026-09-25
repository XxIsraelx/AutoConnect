---
tipo: decisao
data: 2026-09-25
estado: aceita
---

# Validação de saque: recusa por padrão, autorizada uma a uma

## Contexto

A Asaas passou a **exigir**, para liberar a chave de API de produção, que a
conta ative a *validação de saque via webhook*
([documentação](https://docs.asaas.com/docs/mecanismo-para-validacao-de-saque-via-webhooks)).
Com o recurso ativo, toda operação de saída de dinheiro da conta — transferência
bancária, pagamento de conta, Pix por QR Code, recarga de celular e estorno de
Pix — faz a Asaas chamar uma URL nossa, cerca de **5 segundos** depois do
pedido, perguntando se pode.

A resposta tem de conter, exatamente, `{"status":"APPROVED"}` ou
`{"status":"REFUSED","refuseReason":"…"}`. **A operação é cancelada** se a
resposta não contiver nenhum dos dois, ou se a chamada falhar três vezes
seguidas.

Sem isto, a cobrança das lojas não sai do sandbox — é o último bloqueio entre a
[Onda 3 da cobrança](2026-09-25%20cobranca%20e%20bloqueio%20por%20vencimento.md)
e o primeiro real pagante.

## Decisão

`POST /api/v1/webhooks/asaas/saque`, pública, autenticada pelo token que a
Asaas devolve em `asaas-access-token` (variável **própria**,
`ASAAS_SAQUE_TOKEN`), respondendo **`REFUSED` por padrão**.

Só é aprovada a operação que casar com uma **autorização prévia** criada pelo
super admin em `/admin › Saques`: tipo de operação, valor (exato ou teto),
prazo curto (30 min por padrão) e **uso único**. Casou, consome. Toda decisão —
aprovada ou recusada, autenticada ou não — vira linha em `withdrawal_decisions`
com o pedido cru.

## Por quê

### Aprovar por padrão seria desligar o mecanismo pelo lado de dentro

O ataque que este recurso existe para deter é: alguém obtém a `ASAAS_API_KEY` e
pede uma transferência. Nesse cenário o payload que chega ao nosso webhook é
**perfeitamente válido** — quem o monta é a própria Asaas. Um webhook que
responde `APPROVED` para tudo que tem forma correta não recusaria nada: seria
uma trava que diz "pode" para o ladrão com a mesma convicção com que diria para
o dono.

A única coisa que distingue o saque legítimo do roubado é algo que o ladrão da
chave não tem: uma autorização criada **antes**, dentro do AutoConnect, atrás do
login de super admin. É por isso que a decisão não olha só o payload — ela
compara o payload com o que foi registrado de antemão, que é exatamente o que a
documentação da Asaas recomenda.

### Uso único, prazo curto e valor casado

Uma autorização que sobrevive ao saque é uma segunda chance para quem estiver
esperando. O prazo é de minutos porque o fluxo real é "autorizo aqui, peço o
saque lá, a Asaas pergunta 5 segundos depois" — não existe motivo para uma
autorização viver o dia.

O valor no modo `exato` recusa **um centavo a menos** também, e não só a mais: o
valor é a identidade do saque autorizado, não um limite. Quem precisa de folga
(tarifa, arredondamento de conta a pagar) usa o modo `teto`, que é explícito na
tela.

Entre várias autorizações que casam, consome a **mais apertada**. Gastar a mais
larga deixaria a justa de pé, e o que sobra de pé é o que alguém usa depois.

### Sem token configurado, recusa — nunca aprova

A falha de configuração mais provável é subir a API sem a variável. O caminho
seguro e o caminho conveniente apontam para lados opostos aqui, e o escolhido é
o seguro: sem `ASAAS_SAQUE_TOKEN`, tudo é `REFUSED`, com erro no boot, erro por
requisição e um aviso vermelho na aba `/admin › Saques`. O saque do dono para de
funcionar — e é assim que ele descobre no primeiro minuto, em vez de descobrir
quando a trava não servir para nada.

A comparação é em **tempo constante**, sobre o SHA-256 dos dois lados, pelo
mesmo motivo do [webhook de cobrança](2026-09-25%20cobranca%20e%20bloqueio%20por%20vencimento.md):
`timingSafeEqual` lança com tamanhos diferentes, e tratar esse lance como "não
confere" responderia mais rápido e vazaria o comprimento do token.

### Nunca 500, nunca demorar

A Asaas cancela a operação depois de três falhas. Uma exceção vazando do
controller seria uma falha — gastaria uma das três chances, não diria nada a
quem pediu o saque e não deixaria registro. Por isso o serviço **não lança**:
banco fora, coluna faltando, payload monstruoso, tudo vira `REFUSED` com motivo
legível, que é ao mesmo tempo a recusa e a explicação (o `refuseReason` aparece
no painel e no e-mail de erro da conta Asaas).

No caminho da resposta há **uma transação e nada mais**: nenhuma chamada de
rede, nenhum e-mail, nenhum PDF.

### Reentrega repete a decisão; operação nova não herda nada

A Asaas reentrega quando a nossa resposta não chega. Se a segunda entrega da
**mesma** operação encontrasse a autorização já consumida, ela recusaria um
saque que acabamos de aprovar — um pacote perdido cancelaria a transferência do
dono. Por isso `(provider, tipo, id da operação)` é único e a violação do único
faz a resposta repetir a decisão já tomada, com o consumo desfeito junto (a
gravação e o consumo estão na mesma transação).

Isso não afrouxa o uso único: uma operação **diferente**, ainda que do mesmo
tipo e valor, tem outro id e encontra a autorização gasta. Os dois casos estão
travados em `saque.e2e-spec.ts`.

Pedido **sem token válido nunca entra com o id da operação** — entra num balde
próprio (`operation_type = 'NAO_AUTENTICADO'`) com a chave sendo o SHA-256 do
corpo. Sem isso, quem adivinhasse o id de um saque futuro gravaria um `REFUSED`
para ele, e a entrega verdadeira, depois, só repetiria essa recusa.

### As tabelas são da plataforma, e o RLS diz isso

`withdrawal_authorizations` e `withdrawal_decisions` **não têm `tenant_id`**, e
isso é a decisão, não um esquecimento: não são dado de loja nenhuma. Não existe
concessionária a que restringi-las, então a policy é a negação explícita
(`apenas_a_plataforma`, `USING (false)`): o papel `autoconnect_app` não lê nem
escreve nada ali, e quem alcança é só a conexão dona das tabelas, pelo
`PrivilegedPrismaService`.

RLS ligado **com** policy, e não ligado sem nenhuma — as duas negam igual no
Postgres, mas `rls-policies.e2e-spec.ts` trata "RLS sem policy" como
esquecimento, e está certo. Negação por escolha tem nome.

## ⚠ O risco operacional: API fora do ar = saque cancelado

Este é o preço da trava, e ele é real:

> **Enquanto o recurso estiver ativo na Asaas, todo saque da conta depende de
> esta API responder.** Se a API estiver fora do ar, se o deploy estiver no
> meio, se o banco estiver inacessível ou se a URL mudar, a Asaas tenta três
> vezes e **cancela a operação**.

Cancelar é o lado seguro do erro — o dinheiro não sai — mas é o lado caro do
acerto: uma transferência legítima morre junto, e a Asaas avisa por e-mail (o
endereço é configurado junto com a URL, no mesmo formulário).

### Como destravar

1. **Refazer o pedido de saque** depois que a API voltar. A operação foi
   cancelada, não perdida: nada saiu da conta, e pedir de novo com a
   autorização criada resolve o caso comum (deploy em andamento, reinício).
2. **Desligar o recurso no painel da Asaas** — *Menu do usuário › Integrações ›
   Mecanismos de segurança*, o mesmo lugar onde se liga. A documentação
   descreve a ativação e a configuração (URL, e-mail de erro, token) e **não
   diz, em lugar nenhum, que a ativação é irreversível** nem menciona qualquer
   trava para desativar; ela também não afirma explicitamente que se pode
   desligar. Como a Asaas exige o recurso ativo para liberar a chave de
   produção, **desligá-lo pode custar a chave**, e é por isso que este item é o
   segundo e não o primeiro.
   ⚠ **Não confirmado na prática** — não temos conta com o recurso ativo. Vale
   conferir no painel, com a conta criada, antes de precisar.
3. **Falar com o suporte da Asaas** se as duas primeiras não servirem. Um saque
   solicitado pelo painel dela, com o recurso ativo, passa pela mesma validação.

Mitigação do dia a dia, e o motivo de a rota ser tão magra: ela não depende do
gateway de cobrança estar configurado, não depende de assinatura, não pede JWT,
não manda e-mail e faz uma consulta só. O que pode derrubá-la é a API inteira
estar fora — que é o mesmo evento que já derruba o produto.

## Descartado

- **Aprovar automaticamente qualquer operação com payload válido.** Anularia o
  mecanismo. Ver acima.
- **Aprovar quando o token não estiver configurado.** O mesmo erro, vestido de
  conveniência de ambiente de desenvolvimento.
- **Autorização por teto global ("qualquer saque até R$ X por dia").** Um teto
  permanente é uma autorização que nunca expira: quem roubasse a chave sacaria
  o teto todo dia. O teto existe, mas dentro de uma autorização única e curta.
- **Regra automática ("aprovar saque para a minha própria conta bancária").** A
  conta favorecida vem no payload, e confiar nela seria confiar no que o
  atacante controla junto com a chave. Além disso, trocar a conta favorecida é
  uma operação de painel, não de API.
- **Guardar a decisão depois de responder, em segundo plano.** Sem
  infraestrutura de fila (não há Redis aqui), "depois" é "talvez". Auditoria de
  dinheiro que só existe quando dá certo não é auditoria — e a gravação é o que
  torna a reentrega idempotente.
- **Reaproveitar o `COBRANCA_WEBHOOK_TOKEN`.** São coisas diferentes: um
  autentica aviso de fatura paga, o outro autoriza saída de dinheiro. Um token
  só faria o vazamento de qualquer um dos dois valer pelos dois.
- **Pôr isto dentro do módulo de cobrança.** A cobrança é dinheiro entrando das
  lojas, com `tenant_id` em toda linha. Isto é dinheiro saindo do caixa do
  dono, sem loja nenhuma. Vizinhança faria a tabela da plataforma herdar, por
  descuido, o desenho multi-tenant que ela não tem.

## O que o dono precisa fazer no painel da Asaas

1. *Menu do usuário › Integrações › Mecanismos de segurança* → ativar a
   validação de saque.
2. URL: `https://autoconnectapi-production.up.railway.app/api/v1/webhooks/asaas/saque`
3. E-mail para os avisos de erro (é por ele que se descobre um cancelamento).
4. Token de autenticação: gerar um, e pôr **o mesmo valor** em
   `ASAAS_SAQUE_TOKEN` no Railway. O token é opcional para a Asaas e
   **obrigatório** para nós — sem ele, esta aplicação recusa tudo.
5. Conferir se a ativação também vale para operações feitas pela interface web
   da Asaas, e não só pela API (a configuração oferece as duas).

## Onde está no código

- `packages/shared/src/domain/saque.ts` (+ `.spec.ts`) — tipos de operação,
  modos de valor, `decidirSaque` (pura), motivos das recusas, validade padrão
- `apps/api/src/modules/saques/payload-asaas.ts` (+ `.spec.ts`) — o formato da
  Asaas e as duas respostas exatas; **não lança nunca**
- `apps/api/src/modules/saques/saques.service.ts` — token, transação de consumo,
  trilha e idempotência
- `apps/api/src/modules/saques/saques.controller.ts` — `POST
  /webhooks/asaas/saque` (`@Public()`) e `/admin/saques` (só super admin)
- `apps/api/src/app.setup.ts` — `ROTA_WEBHOOK_SAQUE` com corpo cru
- Migration `20260925215522_validacao_de_saque` — as duas tabelas, sem
  `tenant_id`, com RLS negando o papel da aplicação
- `apps/api/test/saque.e2e-spec.ts` — 33 casos
- Web: `app/admin/AbaSaques.tsx`, aba **Saques** do painel do super admin
