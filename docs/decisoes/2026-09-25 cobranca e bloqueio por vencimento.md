---
tipo: decisao
data: 2026-09-25
estado: aceita
---

# Cobrança: Asaas, faixa por estoque e somente leitura no vencimento

## Contexto

Desde [o cadastro em autosserviço](2026-09-25%20cadastro%20em%20autosservico.md) a
loja nasce com **trial de 14 dias e data de fim gravada** (`trialEndsAt`) — e
nada acontecia quando essa data passava. A loja seguia usando o produto de
graça, sem aviso e sem caminho para pagar. Plano e trial eram trocados à mão
pelo super admin, e não existia cobrança nenhuma.

O objetivo do projeto é fechar o **primeiro cliente pagante**. Receber por fora
do primeiro cliente é aceitável; do terceiro, não.

## Decisão

Uma interface de domínio `ProvedorDeCobranca` (`@autoconnect/shared`) com
adaptador por gateway, escolhido por `COBRANCA_FORNECEDOR`. Existem
`CobrancaIndisponivel` (padrão, 503, contratação escondida na tela),
`ProvedorSimuladoDeCobranca` (em memória, recusado em produção) e
`ProvedorAsaas` (API v3).

**Cobrança por loja, faixa por volume de estoque, usuários ilimitados:**

| Plano | Estoque | Preço |
|---|---|---|
| Essencial | até 30 veículos | R$ 279/mês |
| Crescimento | até 80 veículos | R$ 479/mês |
| Pro | ilimitado | R$ 799/mês |

Vencido o prazo, a loja entra em **modo somente leitura**. Nada é apagado nem
escondido.

## Por quê

### O gateway: Asaas

Pix, boleto e cartão numa API só. **55,9% dos compradores de SaaS no Brasil não
usam cartão de crédito** (B2B Stack, fev/2026: boleto 18,6%, Pix 15,9%) — um
gateway só de cartão cortaria metade do mercado. O meio de pagamento padrão na
contratação é `indefinido`, que na Asaas vira `billingType: UNDEFINED`: a
fatura abre com as três opções e quem escolhe é o cliente, não nós.

### A camada neutra é a mesma da assinatura eletrônica

O payload do gateway não sai do adaptador: o resto do sistema vê `assinatura`,
`fatura` e eventos normalizados (`pagamento_confirmado`, `pagamento_vencido`,
`assinatura_cancelada`, `reembolso`, `ignorado`). Trocar de gateway não mexe em
service, tabela nem tela.

### Webhook autenticado por **token**, não por HMAC

A Asaas não assina o corpo. Ela devolve, em toda entrega, o token cadastrado
junto do webhook, no cabeçalho `asaas-access-token`
([docs](https://docs.asaas.com/docs/sobre-os-webhooks)); desde a mudança de
"obrigatoriedade e auto-geração de tokens" não existe mais webhook sem token. A
comparação é em **tempo constante**, sobre o SHA-256 dos dois lados — o digest
está lá porque `timingSafeEqual` lança com tamanhos diferentes, e tratar esse
lance como "não confere" responderia mais rápido e vazaria o comprimento.

O corpo chega **cru** de qualquer forma (`corpoCru` no `app.setup`), não por
exigência de HMAC, mas porque é o que se guarda para auditoria e o que vira
chave de idempotência quando o evento chega sem id.

### Idempotência em duas camadas, como na assinatura

`(provider, event_key)` único em `billing_webhook_events` — a chave é o id do
evento no gateway ou o SHA-256 do corpo. E `aplicarEventoDeCobranca` é **pura**:
`pagamento_confirmado` repetido dá o mesmo estado, e um segundo
`pagamento_vencido` **não estende a carência** (senão quem nunca paga ganharia
sete dias por mês, para sempre). Os webhooks da mesma assinatura são
serializados por `SELECT … FOR UPDATE`.

`PAYMENT_CONFIRMED` (pago, dinheiro ainda não disponível) e `PAYMENT_RECEIVED`
(disponível na conta) **liberam os dois**: para o cliente o pagamento já
aconteceu, e segurar a loja bloqueada até a compensação puniria quem pagou.

### A leitura privilegiada do webhook

Mesmo caso da assinatura externa e do convite por token: o webhook chega sem
usuário e sem loja, e o único dado é o id da assinatura no gateway, cuja
autenticidade o token acabou de provar. `findFirst` por chave, devolvendo só
`id` e `tenantId`; tudo depois roda em `withTenant`. Assinatura desconhecida
responde **200 `assinatura-desconhecida`**, não 404 — a entrega é autêntica, e
4xx faria o gateway reentregar para sempre.

### O bloqueio: um guard global, não uma checagem por rota

Bloquear rota a rota é a forma garantida de esquecer uma — foram seis vezes
nesta base que endpoint e tela não se encontraram. `SomenteLeituraGuard` é
**global** e a regra é "toda escrita passa por mim": rota nova nasce bloqueada
sem ninguém lembrar dela, e o que precisa de exceção pede
`@LiberadoNoBloqueio()`, o que aparece no diff.

`GET` passa sempre. Passam também, nomeadamente:

| Exceção | Por quê |
|---|---|
| `/cobranca/*` | Pagar é como se sai do bloqueio. Uma tela de pagamento bloqueada pelo não pagamento é uma armadilha fechada |
| `/auth/*` (classe já `@Public()`) | Entrar, sair e trocar senha não são escrita de dado da loja |
| `POST /vehicles/:id/unpublish` | Tirar do ar nunca pode ficar travado — mesma regra do e-mail não verificado |
| `PATCH /users/me`, `POST /users/me/password` | O perfil é da pessoa, não da loja |
| Super admin | Estender trial de uma loja bloqueada tem de funcionar justamente quando é preciso |

O status é **402 Payment Required**, com `codigo: assinatura_somente_leitura` —
a tela reconhece o código e leva à página de plano.

### O veredito mora num lugar só

`avaliarCobranca` (shared) é pura e decide tudo: o guard, a faixa de aviso no
painel, a tela de plano, o painel do super admin e o cron de avisos. Três
cópias da regra seriam três chances de a tela dizer "tudo certo" enquanto a API
responde 402 — e o painel do super admin é exatamente onde se olha quando
alguém liga reclamando.

### Trial vencido bloqueia na hora; **fatura** vencida tem 7 dias de carência

O teste grátis já são 14 dias de graça; dar mais sete no fim dele seria um
trial de 21 dias mal contado. A carência é do **boleto**: ele compensa em até 3
dias úteis, e quem paga na sexta pode ver o crédito só na terça. Sete dias
cobrem isso com folga e ainda dão uma semana a quem esqueceu — bloquear um
cliente que ia pagar custa muito mais que uma semana de uso.

**Contratar não é pagar, mas destrava.** Quem escolhe o plano volta a escrever
antes de o boleto vencer (`graceUntil` = primeiro vencimento + carência). Se
nunca pagar, o `PAYMENT_OVERDUE` reabre a carência e o bloqueio volta.

### A vitrine pública **continua no ar**

Era a alternativa oferecida, e a decisão foi a contrária, por três razões:

1. **Pune quem não deve.** O consumidor que procura um carro não tem nada com a
   fatura da loja.
2. **Mata o inbound que pagaria a conta.** Uma loja sem anúncios no ar não
   vende, e uma loja que não vende não paga.
3. **O lead que chega bloqueado é argumento, não punição.** O dono abre o painel
   e vê "3 leads novos" que ele pode ler e ligar, mas não responder pelo
   sistema. Isso convence a pagar melhor que uma vitrine apagada.

Servir dado já publicado não nos custa nada; o que custa é escrita. O lead
público entra por rota `@Public()`, que o guard não toca.

### Limite de estoque: no **publicar**, e nunca despublicando

O teto é conferido ao publicar, não ao cadastrar — a loja continua registrando
tudo o que tem no pátio. E **o que já está no ar continua no ar**: tirar do ar
um anúncio que a loja vendeu a semana inteira para cobrar mais caro é cobrança
por reféns.

**Conta veículo não arquivado, rascunho incluído.** `archived` é a lixeira do
estoque, e cobrar por ele empurraria a loja a apagar o próprio histórico para
caber na faixa. Rascunho conta porque o carro está no pátio; se não contasse, a
loja inteira caberia no Essencial com 200 carros "quase publicados", e a faixa
mediria anúncios no ar em vez de estoque sob gestão, que é o que ela vende.

A contagem roda **dentro da transação com contexto de tenant** da publicação, e
não pelo cache do guard: quem acabou de arquivar um carro para abrir vaga não
pode esperar meio minuto.

### O cache de 30 segundos, e por que a volta não espera por ele

O guard roda em toda escrita, e a API está numa região diferente do banco
(~0,6 s por consulta): sem cache, cadastrar um veículo passaria a custar uma ida
a mais ao Postgres. Meio minuto é curto o bastante para um vencimento pegar
quase na hora — e a **volta não espera o TTL**: webhook, troca de plano pelo
super admin e extensão de trial chamam `invalidar(tenantId)`. Trinta segundos
olhando para um aviso de bloqueio depois de pagar é tempo de sobra para abrir um
chamado.

### O cron avisa; ele **não** bloqueia

Quem bloqueia é `avaliarCobranca`, a cada escrita: uma loja cujo trial venceu às
3h da manhã está em somente leitura às 3h01, tenha o cron rodado ou não. O job
diário faz o que só ele pode fazer — **avisar**, porque um bloqueio sem aviso
vira chamado. Roda sob `executarEmUmaReplica` como os demais.

Idempotência **sem coluna nova por tipo de aviso**: `lastNoticeAt` comparado ao
*marco* da situação (três dias antes do fim do trial; o fim do trial; o
vencimento da fatura; o fim da carência). Um e-mail por marco, e a loja em
somente leitura não recebe o mesmo aviso todo dia — que é o jeito mais rápido de
um aviso deixar de ser lido. Sem e-mail no cadastro, `lastNoticeAt` é gravado do
mesmo jeito, como o `reminderSentAt` do lembrete de agendamento.

### Os planos foram **renomeados no enum**

Eram `starter`/`pro`/`enterprise`, herdados de um desenho de cobrança que nunca
existiu. Agora são `essencial`/`crescimento`/`profissional`: um `plan =
'enterprise'` que na tela se chama "Pro" seria mais uma tradução para alguém
errar. A migration mapeia os valores antigos um a um; o que não for reconhecido
cai em `trial`, que é o estado que não cobra ninguém por engano.

## Descartado

- **Cobrar por usuário.** Num setor de alta rotatividade de vendedor, cobrar por
  assento faz a loja evitar cadastrar gente. No vertical automotivo ninguém cobra
  assim (Boom por loja, AutoForce por marca; Followize e Autoweb vendem "usuários
  ilimitados" como argumento) — ver `docs/planos/levantamento-crms-e-paridade.md`, §5.
- **Derrubar a vitrine no vencimento.** Ver acima.
- **Despublicar anúncios ao estourar a faixa.** Ver acima.
- **Apagar ou esconder dado de loja inadimplente.** Nunca. O dado é do cliente;
  a assinatura compra o direito de *escrever*, não a posse do que já existe.
- **Renderizar Pix/boleto por conta própria.** O link da fatura do gateway
  resolve os três meios numa tela, e exibir meio de pagamento é trabalho de quem
  tem certificação PCI.
- **`seatsLimit`.** A coluna fica, sem uso e comentada: a faixa é de estoque e
  os usuários são ilimitados.
- **Bloquear no cron, gravando um `status = 'blocked'`.** O estado derivado de
  uma data não precisa ser materializado, e materializá-lo criaria a janela em
  que o banco diz "ativa" e o calendário diz o contrário.

## Onde está no código

- `packages/shared/src/domain/cobranca.ts` (+ `.spec.ts`) — catálogo de planos,
  `avaliarCobranca`, `aplicarEventoDeCobranca`, interface `ProvedorDeCobranca`
- `apps/api/src/modules/cobranca/` — `provedor.ts` (fábrica e indisponível),
  `provedor-simulado.ts`, `provedor-asaas.ts` (+ `.spec.ts`), `token-webhook.ts`,
  `cobranca.service.ts`, `cobranca.controller.ts`, `estado-da-loja.service.ts`,
  `vencimentos.cron.ts`
- `apps/api/src/common/guards/somente-leitura.guard.ts` — o bloqueio global
- `apps/api/src/modules/vehicles/vehicles.service.ts` — `recusarSeEstourouAFaixa`
- Migration `20260925172139_cobranca_asaas` — renomeia o enum, acrescenta
  `external_customer_id`, `payment_method`, `grace_until`, `canceled_at`,
  `last_notice_at` em `tenant_subscriptions`, cria `tenant_invoices` e
  `billing_webhook_events` com RLS
- `apps/api/test/cobranca.e2e-spec.ts` — 36 casos
- Web: `(dashboard)/configuracoes/plano/page.tsx`,
  `components/AvisoDeCobranca.tsx`, `admin/AbaConcessionarias.tsx`

## O que falta para ligar de verdade

⚠ **O adaptador da Asaas nunca falou com a Asaas** — não há conta, nem sandbox.
O que está escrito veio da documentação pública, e os testes usam `fetch`
dublado. Com uma conta em mãos, precisa ser conferido:

1. **O cabeçalho do token no webhook.** A doc diz `asaas-access-token`; a
   primeira entrega real confirma (ou não) a grafia exata.
2. **Se o webhook traz `id` do evento.** Sem ele a chave de idempotência cai no
   SHA-256 do corpo — que funciona, mas é mais frágil se a Asaas variar bytes
   entre reentregas.
3. **`POST /customers/:id` como atualização.** É o que a doc indica; confirmar
   que não cria um segundo cliente.
4. **`GET /subscriptions/:id/payments`** — o formato do envelope (`data`) e se a
   `invoiceUrl` vem em toda cobrança, inclusive a de cartão.
5. **`DELETE /subscriptions/:id`** — confirmar que é 200/204 e que 404 em
   assinatura já removida é o que o adaptador assume (no-op).
6. **Valor e data**: `value` em reais com duas casas e `nextDueDate` em
   `AAAA-MM-DD` — conferir que a Asaas não recusa o formato UTC.
7. **Cadastrar o webhook** apontando para `<API>/api/v1/webhooks/cobranca`, com
   os eventos `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`,
   `PAYMENT_REFUNDED` e `SUBSCRIPTION_DELETED`, e pôr o token gerado em
   `COBRANCA_WEBHOOK_TOKEN`.
8. **No Railway**: `COBRANCA_FORNECEDOR=asaas`, `ASAAS_API_KEY`, `ASAAS_API_URL`,
   `COBRANCA_WEBHOOK_TOKEN`.

Até lá, `COBRANCA_FORNECEDOR` vazio deixa a contratação escondida e o bloqueio
valendo — quem desbloqueia é o super admin, à mão, como sempre foi.

## Conta no gateway: começa com CPF

O Asaas aceita conta de **pessoa física**, só com CPF — atende autônomo, MEI e
empresa, e pessoa física também emite boleto. O cadastro pede CPF, data de
nascimento, endereço, telefone, conta bancária e foto do documento, e a análise
leva até 2 dias úteis. A conta pode ser **convertida para pessoa jurídica
depois**, sem trocar de gateway.

Isso destrava o começo sem CNPJ, que era o bloqueio real em 25/09/2026. Fora do
escopo desta decisão, mas registrado porque afeta o lançamento: receber como
pessoa física tem efeito fiscal no CPF, e a nota fiscal do serviço prestado às
revendas é exigência à parte do gateway. Os dois são conversa de contador.

Fontes: [conta digital](https://www.asaas.com/conta-digital) ·
[pessoa física emite boleto](https://blog.asaas.com/pessoa-fisica-pode-emitir-boleto/) ·
[converter PF para PJ](https://central.ajuda.asaas.com/hc/pt-br/articles/32092013910939-Como-alterar-minha-conta-de-pessoa-f%C3%ADsica-para-pessoa-jur%C3%ADdica-E-de-pessoa-jur%C3%ADdica-para-pessoa-f%C3%ADsica)
