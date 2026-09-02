# AutoConnect — Plano de Implementação: Vendas, Contratos e F&I

> **Escopo confirmado:** loja multimarcas primeiro, modelagem preparada para receber oficina/peças depois.
> **Base:** leitura do repositório em 02/09/2026. Nenhum arquivo de código foi alterado por este documento.
> **Regra que governa o plano:** nada entra sem migration e sem teste.

Documento companheiro: [`levantamento-vendas-e-contratos.md`](./levantamento-vendas-e-contratos.md) — o *o quê* e o *porquê*.

---

## 1. Achados na base atual

Nove achados. Os quatro primeiros afetam diretamente qualquer módulo novo que lide com dinheiro e contrato, e por isso viram a Fase 0.

| # | Achado | Onde | Severidade |
|---|---|---|---|
| 1 | **RLS não existe nas migrations.** Nenhum `ENABLE ROW LEVEL SECURITY`, nenhuma `CREATE POLICY` em nenhuma das 4 migrations. O isolamento foi ligado à mão no Supabase — um banco criado do zero (CI, staging, máquina nova) nasce sem nada. | `packages/db/prisma/migrations/` | **crítico** |
| 2 | **`withTenant()` não protege nada.** Ele seta `app.tenant_id`, mas não há policy que leia essa variável — e o Prisma conecta como dono das tabelas, que ignora RLS de qualquer forma. Custo de transação sem benefício de segurança. | `common/prisma/prisma.service.ts` | **crítico** |
| 3 | **Isolamento inconsistente.** `vehicles`, `users` e `tenants` usam `withTenant`; `leads`, `appointments`, `conversations`, `team` e `admin` usam `this.prisma` com `where: { tenantId }` manual. Um `where` esquecido vaza dados entre concessionárias. | 10 services | **crítico** |
| 4 | **SQL por interpolação de string.** ``$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`)``. O valor vem do JWT, mas é uma injeção esperando um bug na emissão do token. | `prisma.service.ts:31` | **crítico** |
| 5 | **`POST /leads` lê `tenantId` do body cru.** O campo não está no `createLeadSchema` — é `(body as Record<string,unknown>)['tenantId'] as string`. Sem validação de UUID, sem checar se o tenant existe ou está ativo. | `leads.controller.ts` | médio |
| 6 | **Drift entre Prisma e Zod.** O enum `LeadSource` tem `trade_in`; o `createLeadSchema` não. Um lead de troca criado pela rota pública é rejeitado na validação. | `packages/shared/src/schemas/lead.ts` | médio |
| 7 | **Zero testes e zero CI.** Script `test: jest` sem `jest.config`, sem nenhum `.spec.ts` no repositório, sem `.github/workflows`. O turbo já tem a task `test` declarada e vazia. | monorepo | **crítico** |
| 8 | **`db:push` exposto na raiz.** O `CLAUDE.md` proíbe explicitamente, mas o script está a um `pnpm db:push` de distância — e já causou 5 colunas e 5 tabelas fora de migration. | `package.json` | médio |
| 9 | **Rotas duplicadas no web.** `settings` + `configuracoes`, `team` + `equipe`, `login` + `entrar`, `signup` + `cadastrar`. Decidir o padrão antes de criar `/negocios`, senão dobra de novo. | `apps/web/src/app/` | baixo |

> **Correção (verificado em 02/09/2026):** o achado nº 9 estava errado.
> `login`/`entrar` e `signup`/`cadastrar` **não são duplicatas**: são quatro
> fluxos vivos para dois públicos. `/login` (6 referências) leva ao painel da
> concessionária e `/signup` ao `/dashboard`; `/entrar` (7 referências) leva o
> cliente ao `/buscar` e `/cadastrar` à verificação de e-mail. Apagar qualquer
> um quebraria navegação real — a inconsistência é de idioma no nome, não de
> duplicação. `settings` e `team` eram os únicos resíduos de fato: diretórios
> **vazios**, sem arquivo nem referência, removidos.

### Por que isso vem antes

Hoje o dado sensível do sistema é telefone de lead. Depois desta implementação será **preço de compra do veículo, margem da loja, contrato assinado, CPF com comprovante de renda e proposta bancária**. Um vazamento entre concessionárias deixa de ser incidente de privacidade e vira concorrente vendo a margem do outro. O custo de arrumar o isolamento agora é uma migration; depois, é auditar 40 services.

### Dois achados de infraestrutura que mudam decisões

- **A API roda em região diferente do banco** (Railway `us-east4` ↔ Supabase `sa-east-1`), a ~0,6 s por consulta segundo o próprio `CLAUDE.md`. O fechamento de um negócio faz de 8 a 12 consultas — 6 a 8 segundos de latência num clique. Antes de otimizar consulta, **mover a API para `sa-east`**. É mudança de configuração e vale mais que qualquer índice.
- **Os crons são in-process.** `TasksService` usa `@nestjs/schedule`. Com duas réplicas no Railway, todo lembrete de agendamento é enviado **duas vezes**. Hoje passa porque roda uma instância só. Vira bug no dia do primeiro escalonamento — e `bullmq` e `ioredis` já estão instalados e sem uso.

---

## 2. Fase 0 — Fundação

Nenhuma funcionalidade nova. É a fase que torna as outras verificáveis. Menor esforço de todo o plano, maior retorno.

### 2.1 Isolamento real por tenant

O desenho correto usa uma peça que **já existe no projeto**: as duas URLs de banco. `DIRECT_URL` continua sendo o dono, usado só por migrations e seed. `DATABASE_URL` passa a apontar para um papel de aplicação sem posse das tabelas — e aí o RLS finalmente vale, porque só o dono o ignora.

```sql
-- packages/db/prisma/migrations/<timestamp>_rls_tenant_isolation/migration.sql

-- Papel da aplicação. Sem BYPASSRLS, sem posse de tabela.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autoconnect_app') THEN
    CREATE ROLE autoconnect_app LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO autoconnect_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO autoconnect_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO autoconnect_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO autoconnect_app;

-- Uma policy por tabela com tenant_id. Repetir para cada uma.
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehicles
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

**Por que é seguro por padrão:** o segundo argumento `true` do `current_setting` faz a função devolver `NULL` quando a variável não foi definida, em vez de lançar erro. Comparar `tenant_id = NULL` resulta em `NULL`, que a policy trata como falso — **esquecer de setar o tenant não abre tudo, fecha tudo**. É exatamente a falha que se quer: barulhenta e sem vazamento.

Três casos precisam de tratamento explícito, e é aqui que a maioria das implementações de RLS quebra:

- **Rotas públicas** — catálogo, `/c/[slug]`, busca no mapa. Leem veículos de todos os tenants. Solução: policy adicional de leitura pública restrita ao que já é público — `USING (published_at IS NOT NULL AND status = 'available')` — em vez de abrir a tabela inteira.
- **Super admin** — o módulo `admin` consulta todos os tenants por natureza. Solução: um `PrismaService` separado conectando pela `DIRECT_URL`, injetado *só* no `AdminModule`. A travessia entre tenants passa a existir em um lugar identificável, em vez de ser o comportamento padrão de tudo.
- **Tabelas do cliente, não do tenant** — `price_alerts`, `saved_searches`, `customer_favorites`, `customer_profiles` não têm `tenant_id`. Isolam-se por `user_id`, com variável própria (`app.user_id`) e policy equivalente.

### 2.2 `withTenant` correto

```ts
// apps/api/src/common/prisma/prisma.service.ts

async withTenant<T>(tenantId: string, fn: (tx: TenantClient) => Promise<T>): Promise<T> {
  // set_config é a forma parametrizável do SET LOCAL — sem interpolação.
  // O terceiro argumento `true` faz valer só até o fim da transação.
  return this.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
```

E então **a regra passa a ser sem exceção**: todo acesso a tabela com `tenant_id` passa por `withTenant`. Os cinco services que hoje usam `this.prisma` direto são migrados nesta fase. Sem uniformidade, o RLS não tem como ajudar, porque metade das consultas roda fora da transação que define a variável.

> **Cuidado operacional:** o Supabase é acessado pelo pooler na porta 5432 (modo sessão), onde `SET LOCAL` dentro de transação funciona. Se algum dia migrar para a 6543 (modo transação), revalidar este ponto antes de tudo.

### 2.3 Enums derivados, nunca redigitados

O achado nº 6 é sintoma, não causa. A causa é ter a mesma lista de valores escrita em dois arquivos.

```ts
// packages/shared/src/schemas/lead.ts
import { LeadSource, LeadStatus } from '@autoconnect/db';

export const createLeadSchema = z.object({
  tenantId: z.string().uuid(),          // ← achado nº 5, agora validado
  vehicleId: z.string().uuid().optional(),
  source: z.nativeEnum(LeadSource).default(LeadSource.website),
  // ...
});
```

### 2.4 Testes e CI

Arquivos a criar:

| Arquivo | Papel |
|---|---|
| `apps/api/jest.config.js` | Testes unitários, `testRegex: '\\.spec\\.ts$'` |
| `apps/api/test/jest-e2e.config.js` | Testes de integração contra Postgres real |
| `apps/api/test/helpers/tenant-fixture.ts` | Cria dois tenants isolados com dados — base de todo teste de vazamento |
| `packages/shared/jest.config.js` | Testes de domínio puro (máquina de estados, cálculos) |
| `.github/workflows/ci.yml` | typecheck · lint · test · drift de migration |
| `docker-compose.test.yml` | Postgres 17 + PostGIS local para os testes de integração |

```yaml
# .github/workflows/ci.yml (essencial)
services:
  postgres:
    image: postgis/postgis:17-3.4
    env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: autoconnect_test }
    options: >-
      --health-cmd pg_isready --health-interval 5s --health-retries 10

steps:
  - run: pnpm install --frozen-lockfile
  - run: pnpm --filter @autoconnect/db generate
  - run: pnpm --filter @autoconnect/db run migrate:deploy
  - run: pnpm exec turbo run typecheck lint test

  # Trava do acidente do `db push`: falha se schema.prisma e migrations divergirem
  - run: |
      pnpm --filter @autoconnect/db exec prisma migrate diff \
        --from-migrations ./prisma/migrations \
        --to-schema-datamodel ./prisma/schema.prisma \
        --shadow-database-url "$SHADOW_DATABASE_URL" \
        --exit-code
```

O último passo é o mais valioso do arquivo. Ele falha o CI quando alguém altera o `schema.prisma` sem gerar migration — exatamente o acidente que já custou 5 tabelas neste repositório. Deixa de depender de disciplina e passa a depender do robô.

No mesmo PR: remover `db:push` do `package.json` da raiz, ou renomear para `db:push:perigoso`.

### ✅ Portão da Fase 0 — só passa se

- [ ] `pnpm exec turbo run typecheck lint test` verde localmente e no CI
- [ ] Teste de vazamento entre tenants passando para `vehicles`, `leads` e `appointments`
- [ ] Banco criado do zero (`migrate deploy` em base vazia) nasce com RLS ativo — verificado por teste, não por inspeção
- [ ] Catálogo público e painel do super admin continuam funcionando
- [ ] `prisma migrate diff` sem drift

---

## 3. Fase 1 — O Negócio (`Deal`)

A entidade que falta. Depois desta fase o sistema sabe responder "esse carro deu lucro?" — a pergunta que faz o dono da loja pagar a mensalidade.

### 3.1 Schema

Convenções do `schema.prisma` atual: `@map` em snake_case, `@db.Uuid`, `Timestamptz`, `@@index([tenantId])` em tudo.

```prisma
enum DealStatus {
  draft  proposal  negotiating  awaiting_credit  contract_issued
  signed  invoiced  documentation  delivered  canceled  rescinded
}

enum PaymentKind { cash  down_payment  trade_in  financing  consortium  other }
enum PaymentStatus { pending  confirmed  failed  refunded }
enum AcquisitionOrigin { direct_purchase  trade_in  consignment  dealer_transfer  auction  factory }

model Deal {
  id             String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String     @map("tenant_id") @db.Uuid
  branchId       String?    @map("branch_id") @db.Uuid
  leadId         String?    @map("lead_id") @db.Uuid
  vehicleId      String     @map("vehicle_id") @db.Uuid
  customerUserId String?    @map("customer_user_id") @db.Uuid
  salespersonId  String?    @map("salesperson_id") @db.Uuid
  status         DealStatus @default(draft)

  // Dinheiro: sempre Decimal(14,2). Nunca Float, nunca Number no cálculo.
  listPrice      Decimal    @map("list_price")    @db.Decimal(14, 2)
  discount       Decimal    @default(0)           @db.Decimal(14, 2)
  saleValue      Decimal    @map("sale_value")    @db.Decimal(14, 2)

  // Congelados no fechamento — o custo do veículo muda depois, a margem não pode.
  vehicleCostSnapshot Decimal? @map("vehicle_cost_snapshot") @db.Decimal(14, 2)
  grossMargin         Decimal? @map("gross_margin")          @db.Decimal(14, 2)

  closedAt     DateTime? @map("closed_at")    @db.Timestamptz()
  deliveredAt  DateTime? @map("delivered_at") @db.Timestamptz()
  canceledAt   DateTime? @map("canceled_at")  @db.Timestamptz()
  cancelReason String?   @map("cancel_reason")

  payments     DealPayment[]
  statusEvents DealStatusEvent[]
  tradeIn      TradeIn?

  @@index([tenantId, status])
  @@index([tenantId, createdAt(sort: Desc)])
  @@index([vehicleId])
  @@map("deals")
}
```

Mais cinco modelos na mesma migration, com o mesmo padrão:

| Modelo | Papel | Detalhe que importa |
|---|---|---|
| `DealPayment` | Composição do pagamento | *n* por negócio. Entrada + troca + financiamento é o caso comum, não a exceção. A soma dos `value` deve bater com `saleValue` — invariante testável. |
| `DealStatusEvent` | Log de transições | `fromStatus`, `toStatus`, `actorUserId`, `reason`, `occurredAt`. Mesmo padrão do `LeadInteraction` e do `VehicleHistory`, que já existem. |
| `TradeIn` | Usado recebido | Promove o que hoje vive em `Lead.metadata`. Guarda `fipeReference`, `appraisedValue`, `acceptedValue` e o `vehicleId` gerado quando o usado entra no estoque. |
| `VehicleAcquisition` | Como o carro entrou | Um por veículo. `origin`, fornecedor, `purchaseValue`, `enteredAt`. Sem isso não há custo, e sem custo não há margem. |
| `VehicleCost` | Preparação e despesas | *n* por veículo, com categoria e fornecedor. Custo total = aquisição + soma dos custos. |

**Preparado para concessionária de marca:** duas decisões de modelagem agora evitam retrabalho depois — `AcquisitionOrigin` já inclui `factory`, e `Deal` aponta para `Vehicle` por FK em vez de embutir os dados do carro, de modo que uma futura `ServiceOrder` se pendura no mesmo `Vehicle` sem tocar em `Deal`. O que **não** se constrói agora: peças, garantia de fábrica, metas de montadora.

### 3.2 Máquina de estados

```
draft → proposal → negotiating → awaiting_credit → contract_issued
  → signed → invoiced → documentation → delivered
                                        · canceled · rescinded
```

A transição vive no `packages/shared` porque front e back precisam da mesma verdade — o botão só aparece se a transição é válida, e o backend recusa se não for. Duas cópias da regra é como se produz uma tela que oferece uma ação que a API rejeita.

```ts
// packages/shared/src/domain/deal.ts
export const DEAL_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  draft:           ['proposal', 'canceled'],
  proposal:        ['negotiating', 'awaiting_credit', 'contract_issued', 'canceled'],
  negotiating:     ['awaiting_credit', 'contract_issued', 'canceled'],
  awaiting_credit: ['contract_issued', 'negotiating', 'canceled'],
  contract_issued: ['signed', 'canceled'],
  signed:          ['invoiced', 'rescinded'],
  invoiced:        ['documentation', 'rescinded'],
  documentation:   ['delivered', 'rescinded'],
  delivered:       ['rescinded'],
  canceled:        [],
  rescinded:       [],
};

export function canTransition(from: DealStatus, to: DealStatus): boolean {
  return DEAL_TRANSITIONS[from].includes(to);
}
```

Note a assimetria deliberada: antes de `signed` o negócio é **cancelado**; depois de assinado ele é **distratado**. São eventos jurídicos diferentes e o sistema não deve fingir que são o mesmo.

### 3.3 Dinheiro — a regra que não se negocia

Nenhum cálculo monetário com `number` do JavaScript. `0.1 + 0.2` não é `0.3`, e um centavo de diferença numa comissão vira ligação do vendedor.

```ts
// errado — é assim que aparece um centavo do nada
const margem = Number(venda) - Number(custo);

// certo
const margem = new Prisma.Decimal(venda).minus(custo);
```

Na fronteira HTTP, o `Decimal` do Prisma serializa como **string** em JSON. O front deve tratar como string e formatar com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`, nunca com `parseFloat` seguido de conta. Um teste de contrato fixa esse formato para que ninguém "conserte" depois.

### 3.4 Módulo da API

Estrutura idêntica à dos módulos existentes — `controller` + `service` + `module`, Zod parseado no controller, `ParseUUIDPipe` nos params, `@Roles` onde precisa:

```
apps/api/src/modules/deals/
├── deals.controller.ts
├── deals.service.ts
├── deals.module.ts
├── deal-state.service.ts      # transições + gravação do evento
├── margin.service.ts          # custo do veículo e margem, em Decimal
└── deals.service.spec.ts

packages/shared/src/schemas/deal.ts     # Zod de entrada
packages/shared/src/domain/deal.ts      # transições e invariantes
```

| Método | Rota | Papel | Roles |
|---|---|---|---|
| POST | `/deals` | Abre negócio a partir de lead ou avulso | salesperson+ |
| GET | `/deals` | Lista com filtro de status, vendedor, período | salesperson+ |
| GET | `/deals/:id` | Detalhe com pagamentos, troca e timeline | salesperson+ |
| PATCH | `/deals/:id` | Valores e desconto — recusado após `signed` | salesperson+ |
| POST | `/deals/:id/transition` | Muda status validando a máquina de estados | salesperson+ |
| POST | `/deals/:id/payments` | Adiciona forma de pagamento | salesperson+ |
| GET | `/deals/:id/margin` | Demonstrativo: venda − aquisição − custos | manager+ |
| POST | `/vehicles/:id/acquisition` | Registra a entrada do veículo | manager+ |
| POST | `/vehicles/:id/costs` | Lança custo de preparação | manager+ |
| GET | `/tenant/reports/inventory` | Giro de estoque em dias, por veículo | manager+ |

> **Decisão de permissão:** `/deals/:id/margin` e os endpoints de custo exigem `manager` ou acima. Custo de aquisição é informação que a maioria das lojas não mostra ao vendedor — e como o `RolesGuard` já existe e funciona, é uma linha de decorator. Confirmar com o cliente-piloto: algumas lojas remuneram o vendedor sobre a margem e precisam mostrar.

### 3.5 Alterações no que já existe

- **`Lead` ganha relação com `Deal`.** O status `won` deixa de ser o fim e passa a significar "gerou negócio". Regra: um lead só entra em `won` se existir um `Deal` ligado a ele — validado no service, não só na tela.
- **Proposta do chat vira `Deal`.** Quando o vendedor envia proposta pelo chat, cria-se um `Deal` em `proposal`. O aceite do cliente no card dispara a transição. Nenhuma tela nova para o cliente.
- **`SalesGoal` passa a medir valor.** Hoje `target Int` conta negócios fechados. Adicionar `targetValue Decimal?` mantém compatível e permite meta em reais, que é como a loja pensa. Migration aditiva.
- **`Vehicle.status` ganha vínculo com o negócio.** `reserved` quando há `Deal` ativo, `sold` quando chega em `invoiced`. Hoje é manual e desanda. Automatizar impede vender o mesmo carro duas vezes — e isso merece `@@unique` parcial no banco: no máximo um `Deal` não-terminal por veículo.
- **Comissão sai do cálculo em tela.** Hoje `/equipe` calcula comissão no front. Com `Deal`, o cálculo vem do backend, sobre margem ou sobre venda, conforme configuração do tenant.

### 3.6 Telas

Antes de criar, resolver o achado nº 9 e escolher: rotas em português (`/negocios`), que é o padrão majoritário e o que está no sidebar. As duplicatas em inglês devem ser removidas no mesmo PR, com redirect se já houver link circulando.

- `/negocios` — lista com filtro por status e vendedor, e um funil de **valor** no topo (não contagem).
- `/negocios/[id]` — o negócio inteiro: veículo, cliente, composição do pagamento, troca, timeline de transições e margem para `manager+`.
- `/veiculos/[id]` — nova aba **Custo**: aquisição, lançamentos de preparação, custo total, dias em estoque.
- `/relatorios` — dois gráficos novos: margem por período e giro médio de estoque.

Usar TanStack Query nessas telas, não `useEffect` + `api()`. O provider já está configurado e só `/dashboard` usa. Telas de dinheiro precisam de invalidação de cache consistente — é justamente onde dado velho engana.

E não repetir o padrão `catch { }` das quatro telas citadas no `CLAUDE.md`: falha de API precisa ser visualmente distinta de "sem dados", com botão de tentar de novo.

### ✅ Portão da Fase 1

- [ ] Invariante testado: soma dos `DealPayment` = `saleValue`
- [ ] Invariante testado: nenhum veículo com dois negócios ativos, garantido pelo banco
- [ ] Transições inválidas recusadas com 409, com teste para cada aresta proibida
- [ ] Margem calculada em `Decimal`, com teste de caso com centavos
- [ ] Teste de vazamento nos endpoints novos
- [ ] Fluxo manual completo: lead → negócio → pagamento composto → entregue

---

## 4. Fase 2 — Contrato

Aqui o sistema passa a emitir um documento com efeito jurídico. As decisões de arquitetura têm que refletir isso: o que foi emitido não muda, e é preciso poder provar.

### 4.1 Três garantias do desenho

1. **Template versionado por tenant.** Cada loja tem o contrato do advogado dela. Editar um template *nunca* altera contratos já emitidos — cria uma versão nova.
2. **Snapshot, não join.** O contrato guarda cópia congelada dos dados usados na emissão, em `Json`. Se o preço do veículo mudar depois, o contrato assinado não muda junto. O projeto já usa esse conceito no histórico de preço.
3. **Hash na emissão.** SHA-256 do PDF gravado no momento em que ele nasce. Prova que o arquivo não foi trocado, e é a base de qualquer integração de assinatura depois.

### 4.2 Geração do PDF

A tentação é Puppeteer, e é uma armadilha no Railway: sobe o build em centenas de megabytes, exige binário de Chromium e é a causa clássica de deploy quebrado. Recomendação: **`pdfmake`** — JavaScript puro, saída determinística (o mesmo modelo produz sempre o mesmo byte, o que torna o hash testável), sem binário externo. O template do tenant fica em estrutura de blocos, não em HTML livre.

Se o cliente-piloto exigir layout que o pdfmake não alcance, a alternativa é gerar HTML e converter num serviço externo — decisão a tomar com caso concreto na mão, não por antecipação.

### 4.3 Onde guardar

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_STORAGE_BUCKET` estão listadas no `CLAUDE.md` como variáveis órfãs, sem nenhum código que as leia. É exatamente o que falta aqui.

Contrato assinado e documento de identidade **não podem** ir para a Cloudinary com preset *unsigned*, que é como as fotos de veículo sobem hoje — qualquer um com a URL abre o arquivo. Storage privado com URL assinada de validade curta, e o upload passando pelo backend, não pelo navegador.

### 4.4 Modelagem da garantia

A cláusula "garantia só de motor e câmbio" é nula (CDC art. 26 II + art. 51 I). O modelo de dados deve tornar difícil escrevê-la:

```prisma
model DealWarranty {
  dealId        String  @id @map("deal_id") @db.Uuid

  // Legal: CDC art. 26, II. 90 dias, cobre o veículo inteiro.
  // Não é campo editável — é constante calculada a partir da entrega.
  legalDays     Int      @default(90) @map("legal_days")
  legalStartsAt DateTime? @map("legal_starts_at") @db.Timestamptz()

  // Contratual: aditiva, opcional, com escopo livre. Nunca reduz a legal.
  contractualMonths Int?    @map("contractual_months")
  contractualScope  String? @map("contractual_scope")
}
```

E o resolver do template recusa gerar contrato cuja garantia contratual seja *menor* que a legal apresentada como se fosse a garantia total. É uma validação de dez linhas que protege a loja de um processo — e é argumento de venda que nenhum concorrente faz.

### 4.5 Assinatura

Modelar o provedor como interface desde o primeiro dia, com implementação interna que só coleta aceite com trilha de evidências (IP, user-agent, timestamp, hash do documento aceito, identificação do signatário). Trocar por Clicksign, ZapSign ou D4Sign vira implementar a mesma interface. O que **não** se faz: espalhar chamadas ao SDK do provedor pelo service.

Quando entrar provedor externo, o webhook precisa de verificação de assinatura HMAC e tratamento idempotente — provedor reentrega evento, e contrato assinado duas vezes é bug visível para o cliente.

### ✅ Portão da Fase 2

- [ ] Emitir o mesmo contrato duas vezes produz o mesmo hash — teste determinístico
- [ ] Editar o template não altera contrato já emitido — teste explícito
- [ ] Contrato em `signed` é imutável: `PATCH` retorna 409
- [ ] URL de documento expira e não é pública — teste que a URL crua devolve 403
- [ ] Template padrão revisado por advogado antes de qualquer cliente real usar

---

## 5. Fases 3 a 5 — arquitetura

Aqui o plano para de descrever arquivos, porque tudo depende de contrato comercial com terceiro e vai mudar. O que não muda é a forma de encaixar.

### Fase 3 — Consultas veiculares e assinatura externa

Toda integração externa entra por uma camada de anticorrupção: uma interface no domínio, uma implementação por fornecedor, e o resto do sistema nunca vê o formato do fornecedor.

- `VehicleQueryProvider` com `query(placa | chassi, tipo)`, e a resposta crua guardada em `Json` junto ao resultado normalizado — quando o fornecedor mudar o payload, o histórico continua auditável.
- **Consulta custa dinheiro por chamada.** Cache com TTL por placa e por tipo, e nunca consultar de dentro de loop de renderização. Registrar custo por consulta é requisito, não enfeite.
- Idempotência por `(vehicleId, tipo, dia)` para não pagar duas vezes pelo mesmo clique duplo.
- Selo de procedência na página pública do veículo — o retorno comercial dessa fase.

### Fase 4 — Crédito e F&I

É a primeira integração *assíncrona de verdade*: a proposta vai para o banco e a resposta volta minutos depois, por webhook ou polling.

- **Aqui BullMQ deixa de ser variável órfã.** `bullmq` e `ioredis` já estão no `package.json` da API e `REDIS_URL` já está no `.env`, tudo sem uso. Envio de proposta, retentativa e reconciliação são exatamente o caso de uso.
- Chave de idempotência por proposta, para que retentativa não vire duas propostas no banco parceiro.
- `FinanceProposal` guarda o protocolo externo; o estado do gravame e do registro é **só leitura** — quem registra é a financeira, o CRM apenas reflete.
- Produtos F&I com aceite individual registrado e com data. Venda casada é proibida, e a evidência de aceite separado é a defesa da loja.
- Migrar o `TasksService` para fila na mesma fase resolve o problema de cron duplicado com múltiplas réplicas.

### Fase 5 — Obrigações fiscais e regulatórias

- **COAF** é a de melhor relação custo-benefício: um job que soma pagamentos em espécie por CPF em janela móvel de seis meses, um alerta ao cruzar o limite e um relatório exportável. Sem integração externa nenhuma.
- **NF-e** via emissor terceiro (Focus NFe, NFe.io, Tecnospeed). Não implementar do zero — regra estadual muda e é um produto inteiro.
- **RENAVE** por integradora credenciada, com certificado ICP-Brasil. A mais cara e a única com prazo legal. A modelagem (`renave_events` com protocolo e payload) pode entrar antes da integração, para que a fase seja só plugar.

---

## 6. Como validar

Cinco níveis. Esta seção vale mais do que o resto do plano, porque nada aqui depende de o desenho acima estar certo.

### Nível 1 — Tipos e bordas

- `strict` e `noUncheckedIndexedAccess` já estão ligados no `tsconfig.base.json`. Manter, e nunca adicionar `any` para calar erro em código de dinheiro.
- Zod em toda entrada HTTP, com enums derivados do Prisma (`z.nativeEnum`).
- **Teste de paridade de enum**, uma linha por enum, que quebra o CI no dia em que alguém adicionar valor no Prisma e esquecer do Zod:

```ts
it('schema Zod cobre todos os valores do enum do Prisma', () => {
  expect(new Set(createLeadSchema.shape.source.options))
    .toEqual(new Set(Object.values(LeadSource)));
});
```

### Nível 2 — Unitário, sem banco

Roda em milissegundos, cobre onde a lógica erra:

- Máquina de estados: toda transição válida aceita, **toda inválida recusada** — a segunda metade é a que as pessoas esquecem de escrever e é onde os bugs moram.
- Margem, comissão e composição de pagamento, com casos de centavos e de arredondamento.
- Cálculo de parcela (Price) e CET — comparar contra valores calculados à mão, em tabela de casos.
- Validação de CPF e CNPJ, incluindo casos degenerados (`111.111.111-11` passa no dígito verificador e precisa ser rejeitado à parte).
- Resolver de template: placeholder faltando deve **falhar**, nunca renderizar vazio. Contrato com campo em branco é pior que erro.

### Nível 3 — Integração, com Postgres real

Não usar SQLite nem mock do Prisma. O comportamento que precisa ser testado — RLS, constraints, transações, `Decimal` — só existe no Postgres. Docker local, serviço no CI.

**O teste mais importante do sistema.** Um por endpoint que toca dado de tenant:

```ts
it('não devolve negócio de outra concessionária', async () => {
  const { tenantA, tenantB } = await seedTwoTenants();
  const dealDeB = await createDeal(tenantB);

  const res = await request(app)
    .get(`/api/v1/deals/${dealDeB.id}`)
    .set('Authorization', `Bearer ${tokenDe(tenantA)}`);

  expect(res.status).toBe(404);        // 404, não 403 — não confirma existência
  expect(res.body).not.toHaveProperty('saleValue');
});
```

Mais três verificações de banco que valem cada uma um teste:

- Banco criado do zero por `migrate deploy` tem RLS ativo em todas as tabelas com `tenant_id` — consultar `pg_policies` e comparar com a lista de tabelas, para que uma tabela nova sem policy quebre o CI automaticamente.
- Constraint de negócio único por veículo realmente impede o segundo insert.
- Transação de fechamento é atômica: falha no meio não deixa o veículo `sold` com o negócio em `draft`.

### Nível 4 — Ponta a ponta

Playwright, um único cenário feliz cobrindo o ciclo inteiro: cliente vê veículo → manda lead → vendedor abre negócio → registra pagamento composto → emite contrato → cliente assina → entrega. Um teste caro que pega a classe de erro que nenhum unitário pega: as pontas não se conectando.

### Nível 5 — O que teste não cobre

- **Revisão jurídica do template de contrato** por advogado, antes de o primeiro cliente real emitir. Não é opcional e não tem substituto técnico.
- **Conferência contábil** do que o sistema registra como custo e receita, com o contador do cliente-piloto.
- **Teste de aceitação com um vendedor real** fechando um negócio de verdade, olhando. Metade dos ajustes de fluxo vem daí.
- **Verificação das fontes regulatórias** — prazos do RENAVE na Senatran e limites vigentes do COAF — antes de virar requisito de código.

---

## 7. Processo de trabalho

- **Uma migration por PR**, sempre por `prisma migrate dev`, revisada no diff antes do merge. O `migrate deploy` já está no pre-deploy do Railway.
- **Migrations aditivas primeiro.** Coluna nova nasce nulável, é preenchida por backfill, e só depois vira obrigatória — em três deploys, não em um. Evita o deploy que falha com a tabela já cheia.
- **Feature flag por tenant** usando `Tenant.settings Json`, que já existe. O módulo de vendas fica desligado por padrão e liga primeiro só no piloto. Rollback vira uma linha no banco, não um revert.
- **Ordem de merge:** Fase 0 inteira antes de qualquer schema novo. Dentro da Fase 1: schema → domínio compartilhado → service → controller → tela. Nunca começar pela tela — é assim que se descobre que o modelo estava errado depois de estilizar tudo.
- **Atualizar o `CLAUDE.md` no mesmo PR** que muda padrão. Aquele arquivo é bom e está atualizado; a única forma de continuar assim é tratá-lo como código.

### Riscos com mitigação nomeada

| Risco | Sinal de que aconteceu | Mitigação |
|---|---|---|
| RLS quebra rota pública ou admin | Catálogo vazio; painel admin sem tenants | Testes das duas rotas na Fase 0, antes do merge; policy pública explícita e Prisma separado no admin |
| Latência do fechamento | Clique demora mais de 3 s | Mover API para `sa-east`; agrupar as consultas em uma transação |
| Escopo virar ERP | Apareceu conciliação bancária no backlog | Fronteira declarada: para no DRE por veículo e comissão |
| Template jurídico incorreto | Descoberto por reclamação de cliente | Revisão por advogado no portão da Fase 2; loja pode editar o dela; termo de uso isenta o AutoConnect |
| Integração de crédito não fecha comercialmente | Fase 4 travada sem parceiro | Modelar `FinanceProposal` com preenchimento manual antes da API — o vendedor já digita no portal do banco hoje |
| Cron duplicado ao escalar | Cliente recebe lembrete em duplicata | Fila com lock na Fase 4, ou *advisory lock* no Postgres desde já |

---

## 8. Definição de pronto

Aplicável a qualquer PR deste plano. Se um item não puder ser marcado, o PR não é pronto — é rascunho.

- [ ] Migration gerada por `migrate dev`, aplicada em banco limpo sem erro, e `migrate diff` sem drift
- [ ] Tabela nova com `tenant_id` tem policy de RLS na mesma migration
- [ ] Entrada HTTP validada por Zod, com enums derivados do Prisma
- [ ] Acesso a dado de tenant passa por `withTenant` — sem exceção
- [ ] Valor monetário em `Decimal` do início ao fim, sem `Number` no meio
- [ ] Teste unitário das regras de negócio, incluindo os caminhos que devem falhar
- [ ] Teste de vazamento entre tenants para cada endpoint novo
- [ ] Erro de API distinguível de "sem dados" na tela, com ação de tentar de novo
- [ ] Sem `catch { }` silencioso introduzido
- [ ] `typecheck`, `lint` e `test` verdes no CI
- [ ] `CLAUDE.md` atualizado se algum padrão mudou
- [ ] Feature nova atrás de flag até o piloto validar

---

## 9. Por onde começar

O primeiro PR **não é** o `Deal`. É o `jest.config.js`, o `ci.yml` e um único teste que sobe a aplicação e bate no `/health`. Ele não entrega nada ao usuário e é o que torna todo o resto verificável — com CI verde, cada passo seguinte tem uma rede embaixo.

Depois dele, a migration de RLS. Só então a primeira tabela nova.
