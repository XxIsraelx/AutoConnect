# Isolamento por tenant

> Extraído do [CLAUDE.md](../../CLAUDE.md) em 22/09/2026. Lá fica a regra curta; aqui, o porquê.

## A regra

As tabelas de venda e contrato (`deals`, `deal_payments`, `deal_status_events`,
`trade_ins`, `vehicle_acquisitions`, `vehicle_costs`, `contract_templates`,
`deal_contracts`, `contract_signatures`, `deal_warranties`, `deal_buyers`,
`vehicle_queries`) seguem a mesma
regra, e carregam o dado mais sensível do sistema: preço de compra, margem,
contrato assinado e CPF de signatário.

**Todo acesso a tabela com `tenant_id` passa por `withTenant`.** Todo acesso a
tabela do consumidor final (`customer_favorites`, `customer_profiles`,
`price_alerts`, `saved_searches`, `user_sessions`) passa por `withUser`.

```ts
// certo
return this.prisma.withTenant(tenantId, (tx) => tx.lead.findMany());

// errado — roda sem contexto; quando a aplicação conectar como
// autoconnect_app, não enxerga linha nenhuma
return this.prisma.lead.findMany({ where: { tenantId } });
```

Os dois métodos abrem transação e definem `app.tenant_id` / `app.user_id` via
`set_config(..., true)`, que é a forma **parametrizável** — a versão anterior
interpolava o id na string SQL.

## Como as policies funcionam

Cada tabela com `tenant_id` tem `tenant_isolation`, comparando a coluna com
`current_setting('app.tenant_id', true)`. Quando a variável não foi definida, a
função devolve `NULL`, a comparação vira `NULL` e a policy trata como falso:
**esquecer de setar o tenant fecha tudo, não abre tudo.**

Três casos têm tratamento explícito:

| Caso | Solução |
|---|---|
| Rotas públicas (catálogo, `/c/[slug]`, mapa) | Policy `leitura_publica` em `vehicles`, `vehicle_images`, `dealership_branches` e `tenants`, liberando só o que já está na vitrine — o filtro é `status = 'available'`, o mesmo que o `catalog.service` usa |
| Super admin | `PrivilegedPrismaService` — conexão pela `DIRECT_URL`, dona das tabelas, que ignora RLS. Também é o caminho de `tenant_invites` e do login, que buscam antes de existir tenant |
| Tabelas sem `tenant_id` | Catálogo global (`vehicle_brands`, `vehicle_models`, …) é leitura para todos e escrita só pelo dono; as do cliente isolam por `user_id` |
| **Cliente atravessa concessionárias** | Ele agenda na loja A e conversa com a B. Policy `acesso_cliente` em `appointments`, `conversations` e `messages`, por `app.user_id` |
| **Cliente não pertence a loja nenhuma** | `users.tenant_id` é NULL para clientes, então a policy de tenant os tornaria invisíveis. `acesso_proprio` (ele mesmo) + `cliente_relacionado` (a loja vê quem tem lead, agendamento ou conversa com ela — **não** a base inteira) |

## Escopo da requisição

Controllers não passam `tenantId` para os services: passam um `Escopo`, criado
por `escopoDa(req.user)` em `common/escopo.ts`.

| Situação | Escopo | Consulta |
|---|---|---|
| Usuário com concessionária | `{ tipo: 'tenant' }` | `withTenant` |
| **Super admin sem loja selecionada** | `{ tipo: 'global' }` | conexão privilegiada, sem filtro |
| Qualquer outro papel sem loja | — | `ForbiddenException` |

O tipo existe para que `null` **não** possa significar "vê tudo". Um `tenantId`
perdido no meio do caminho vira erro alto, e não uma consulta sem filtro — que
é como um bug comum viraria vazamento entre concessionárias.

Super admin **impersonando** tem `tenantId` no token e portanto escopo de
tenant: o consolidado não vaza para dentro da tela de uma loja só.

## A conexão privilegiada

`PrivilegedPrismaService` existe para as operações que não têm tenant a que se
restringir: super admin, login (busca por e-mail antes de saber a loja) e
convite por token. Ele **não** é `@Global`, ao contrário do `PrismaModule` —
quem precisa atravessar concessionárias declara `PrivilegedPrismaModule` nos
imports, e isso aparece no diff do PR.

Não use para acesso comum a dado de concessionária.

## O que garante que a regra continue valendo

`common/prisma/isolamento.spec.ts` varre o código e falha se um arquivo novo
acessar tabela de tenant fora de `withTenant`. Os módulos ainda não migrados
estão numa lista de pendências explícita, com o motivo de cada um — a lista só
pode encolher, e o teste também falha se alguém deixar nela um módulo já
migrado.

## Os quatro acessos

| Método | Quando | Define |
|---|---|---|
| `withTenant(tenantId, fn)` | dado da concessionária | `app.tenant_id` |
| `withUser(userId, fn)` | dado do consumidor final | `app.user_id` |
| `withTenantAndUser(t, u, fn)` | cliente agindo dentro de uma loja (captura de lead, registro de visita) | ambos |
| `withPublic(fn)` | catálogo, mapa, `/c/[slug]` | **nada**, de propósito |

`withPublic` roda sem contexto: sobra apenas a policy `leitura_publica`. Existe
para que "esta consulta é pública" seja uma decisão escrita, não a ausência de
uma decisão.

## Ligar a fiscalização em produção

> Os passos abaixo já foram feitos (ver o aviso de 10/09). Ficam como registro e
> como roteiro para reverter.

> **Estado em 10/09/2026:** o banco de produção já mostra a aplicação
> conectando como `autoconnect_app` (conexões pelo Supavisor desde o deploy das
> 17:39 UTC; o papel tem senha e nenhuma data de expiração). Ou seja, o RLS
> **já fiscaliza em produção**. Dois caminhos rodavam sem contexto e quebraram
> em silêncio com isso — importação em lote (500) e gráfico de leads por dia
> (vazio) —, e `isolamento.spec.ts` agora recusa `this.prisma.$transaction` e
> SQL cru pelo cliente comum, o padrão pelo qual os dois escaparam.

Todo o código já opera sob RLS — o CI prova isso rodando a suíte de integração
conectada como `autoconnect_app`. Falta só a troca de configuração:

1. `ALTER ROLE autoconnect_app PASSWORD '<senha>'` (a senha **não** está na
   migration: segredo não entra em arquivo versionado). Evite os caracteres
   `@ # / : ? & %`, que quebram a URL.
2. No Railway, apontar **`DATABASE_URL`** para `autoconnect_app` e manter
   **`DIRECT_URL`** como o dono (`postgres`), que é a conexão privilegiada.

Reverter é trocar a `DATABASE_URL` de volta.

Enquanto isso não acontece, a aplicação conecta como dona das tabelas e o RLS
fica inerte — nada quebra, e o isolamento continua sendo o `where: { tenantId }`
de sempre, mantido de propósito como primeira linha de defesa.

Também **não** usamos `FORCE ROW LEVEL SECURITY` — com ele o próprio dono
passaria a ser filtrado, e migrations, seed e a conexão privilegiada parariam
de enxergar dados.
