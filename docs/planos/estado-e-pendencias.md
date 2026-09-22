# Estado, pendências e próximos passos

> Extraído do [CLAUDE.md](../../CLAUDE.md) em 22/09/2026. Lá fica a regra curta; aqui, o porquê.

## Estado atual de cada módulo

| Módulo | Backend | Frontend | Observações |
|---|---|---|---|
| Auth | ✅ completo | ✅ completo | JWT + Google OAuth + reset senha + verificação email |
| Tenants/Filiais | ✅ completo | ✅ configurações | CRUD completo |
| Usuários/Perfil | ✅ completo | ✅ completo | perfil completo implementado |
| Equipe | ✅ completo | ✅ completo | convites por email com token |
| Veículos | ✅ completo | ✅ completo | CRUD + upload imagens + busca |
| Catálogo (marcas/modelos) | ✅ completo | ✅ público | página pública do veículo |
| Leads | ✅ completo | ✅ completo | kanban, timeline, interações, stats |
| Agendamentos | ✅ completo | ✅ completo | **última página trabalhada** |
| Chat | ✅ completo | ✅ completo | Socket.IO tempo real |
| Mapa | ✅ completo | ✅ completo | dark theme, pins animados, sidebar |
| Dashboard | ✅ completo | ✅ completo | KPIs, GalaxyMap |
| Admin | ✅ completo | ✅ completo | impersonation, announcements |
| Página pública concessionária | ✅ | ✅ | `/c/[slug]` com chat iniciado pelo cliente |
| **Negócios (`Deal`)** | ✅ completo | ✅ completo | máquina de estados, pagamento composto, margem em `Decimal` |
| **Custo do veículo** | ✅ completo | ✅ completo | aquisição + preparação; base da margem |
| **Contrato** | ✅ completo | ✅ completo | PDF determinístico, hash, assinatura interna |
| **Consulta veicular** | ✅ estrutura | ✅ completo | cache, idempotência e custo; **falta fornecedor real** |

## Pendências conhecidas

Auditadas em 04/09/2026, contra o repositório.

**Bloqueiam uso real**
- ⚠ **Template de contrato não revisado por advogado.** O sistema emite
  documento com efeito jurídico a partir de um template declarado no código
  como ponto de partida.
- ⚠ **Sem fornecedor de consulta veicular.** Depende de contrato comercial. A
  estrutura está pronta e a API recusa em voz alta enquanto não houver.

**Da definição de pronto do plano, um item nunca foi cumprido**
- **Feature flag.** O plano pede "feature nova atrás de flag até o piloto
  validar". Nada foi entregue atrás de flag — negócios, contrato e consulta
  entraram direto. Não há infraestrutura de flag no projeto.

**Dívidas de infraestrutura**
- **Crons in-process** (`@nestjs/schedule`): com duas réplicas no Railway, todo
  lembrete sai **duas vezes**. Passa hoje porque roda uma instância só.
- **API e banco em regiões diferentes** (`us-east4` ↔ `sa-east-1`), ~0,6s por
  consulta.
- **`SUPABASE_SERVICE_ROLE_KEY` no Railway**: definida, mas a validade da chave
  nunca foi verificada de forma independente — chave errada só falha no upload.

**Menores**
- **Google OAuth em produção**: falta registrar o redirect URI e publicar o app
  no Console.
- **Um `catch` silencioso deliberado** em `SeloProcedencia`: falha no selo não
  pode virar erro na tela de venda. Está comentado no código.
- **`/relatorios`, `/agendamentos` e `/equipe`** ainda não revisados para telas
  pequenas.
- **Relatórios vazios**: seed é de maio/junho, filtro padrão de 30 dias, e os
  gráficos de margem e giro dependem de negócio faturado que o seed não cria.
- **CVEs do Next** só têm correção na linha 15.x (breaking changes).

## Onde o plano de vendas está

`docs/planos/plano-implementacao-vendas.md` governa o trabalho. Estado em 03/09/2026:

| Fase | Estado |
|---|---|
| 0 — Fundação (RLS, testes, CI) | ✅ portão fechado |
| 1 — Negócio (`Deal`) | ✅ portão fechado |
| 2 — Contrato | ✅ 4 de 5 (falta a revisão por advogado) |
| 3 — Consultas veiculares e assinatura externa | ⬜ |
| 4 — Crédito e F&I | ⬜ |
| 5 — Obrigações fiscais | ⬜ |

Duas correções ao plano já registradas **dentro dele**:

- O achado nº 9 estava errado: `login`/`entrar` e `signup`/`cadastrar` não são
  duplicatas, são quatro fluxos para dois públicos. Só `settings` e `team` eram
  resíduo (diretórios vazios, removidos).
- O portão da Fase 2 pede que a URL crua devolva 403; ela devolve **404 "Bucket
  not found"**, que é negação mais forte.

---

## Próximos passos sugeridos

1. **Revisão jurídica do template de contrato** — bloqueia uso real
2. **Concluir o Google OAuth** no Console
3. **Fase 3** do plano: consultas veiculares (placa/chassi) com cache por
   custo de chamada, e assinatura externa atrás da interface que já existe
4. **Revisar responsividade** de `/relatorios`, `/agendamentos` e `/equipe`
5. **Seed com negócio faturado**, para os gráficos de margem e giro terem dado
