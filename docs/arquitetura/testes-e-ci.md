# Testes e CI — detalhes

> Extraído do [CLAUDE.md](../../CLAUDE.md) em 22/09/2026. Lá fica a regra curta; aqui, o porquê.

## Enums: Prisma e Zod

Os schemas Zod do `@autoconnect/shared` **repetem** as listas dos enums do
Prisma, em constantes exportadas (`LEAD_SOURCES`, `VEHICLE_CONDITIONS`, …).

A repetição é deliberada: `@autoconnect/db` é `export * from '@prisma/client'` e
o `@autoconnect/shared` é dependência do `apps/web` — importar um do outro
arrastaria o Prisma e seus binários nativos para o bundle do navegador.

O preço é a chance de divergirem, e `paridade-enums.spec.ts` é o que a elimina:
compara cada lista com o enum real e quebra o CI. Ao adicionar valor a um enum
no `schema.prisma`, atualize a constante correspondente no shared.

> `INVITABLE_ROLES` é a exceção: um **subconjunto** deliberado de `UserRole`,
> porque convidar `super_admin` ou `customer` pela tela da equipe seria
> escalada de privilégio. O teste dele afirma subconjunto, não igualdade.

## Onde cada teste mora

| Caminho | Tipo | Roda com |
|---|---|---|
| `apps/api/src/**/*.spec.ts` | unitário, sem banco | `jest.config.js` (project `api:unit`) |
| `apps/api/test/*.e2e-spec.ts` | integração, Postgres real | `test/jest-e2e.config.js` |
| `packages/shared/src/**/*.spec.ts` | domínio puro | `packages/shared/jest.config.js` |

Os testes de isolamento usam `test/helpers/tenant-fixture.ts`, que cria duas
concessionárias completas. O helper `comoApp()` roda a consulta com
`SET LOCAL ROLE autoconnect_app` — a conexão dona ignora RLS e passaria verde
sem provar nada.

| Arquivo | O que fixa |
|---|---|
| `rls-policies.e2e-spec.ts` | Cobertura: toda tabela com `tenant_id` tem policy. **Tabela nova sem policy quebra o CI sozinha** |
| `rls-isolation.e2e-spec.ts` | O isolamento no banco, incluindo falhar fechado sem contexto |
| `tenant-leak.e2e-spec.ts` | O contrato HTTP: **404, não 403** — 403 confirmaria que o recurso existe |
| `deals-invariantes.e2e-spec.ts` | Um veículo, um negócio vivo — índice único parcial exercido no banco |
| `deals.e2e-spec.ts` | O fluxo do negócio por HTTP, papéis e vazamento |
| `proposta-chat.e2e-spec.ts` | A proposta do chat virando negócio (falha em silêncio por desenho) |
| `chat-gateway.e2e-spec.ts` | O gateway pelo WebSocket — o evento é `conversation:send`, não `message:send` |
| `contrato-imutavel.e2e-spec.ts` | Contrato emitido não muda: trigger no banco |
| `contrato.e2e-spec.ts` | Emissão, hash, assinatura e anulação por HTTP |
| `rls-caminhos.e2e-spec.ts` | Importação em lote e gráfico de leads por dia — rodavam sem contexto e ficavam cegos sob RLS |

O `jest.config.js` da API roda os dois *projects*, para que um único `test`
cubra unitário e integração — teste fora do comando do portão não é rodado por
ninguém.

## Trava contra rodar em produção

`apps/api/test/setup-e2e.ts` **recusa** iniciar se a `DATABASE_URL` não for um
host local com banco terminado em `_test`. Sem isso, um teste que escreve
rodaria contra o Supabase de produção, que é justamente o que o `.env` da raiz
aponta. A trava não é opcional — não a remova para "testar contra dados reais".

O mesmo arquivo **zera `RESEND_API_KEY`, `GMAIL_USER` e `GMAIL_APP_PASSWORD`**:
a API lê o `.env` da raiz, e com o Gmail preenchido ali a suíte mandava e-mail
de verdade (convite, agendamento, troca) e abria SMTP a cada boot do Nest — o
portão ficou lento e vermelho.

E zera **`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`**, pelo mesmo motivo:
com a chave no `.env`, cada rodada gravava ~10 PDFs de contrato fictício no
bucket `documentos` de **produção** — 272 arquivos órfãos acumulados em pastas
de lojas que os testes criam e apagam. Regra geral: todo serviço externo com
credencial no `.env` precisa ser desligado aqui.

## CI

`.github/workflows/ci.yml` roda em todo push na `main` e em todo PR: instala,
gera o client do Prisma, aplica as migrations em banco limpo, **checa drift** e
roda o portão.

O passo de drift compara o banco recém-migrado com o `schema.prisma` e falha se
divergirem — é a rede contra o acidente do `prisma db push`, que já custou 5
colunas e 5 tabelas aqui. Usa `--from-url` e não `--from-migrations`: a segunda
forma acusa falsamente as quatro extensões (`citext`, `pg_trgm`, `pgcrypto`,
`postgis`) como ausentes.

> Os scripts `db:push` (raiz) e `push` (`packages/db`) **foram removidos**. Para
> alterar o schema, sempre `prisma migrate dev`.
