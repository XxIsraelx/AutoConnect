-- Loja de demonstração.
--
-- Em produção existe uma loja fictícia, slug `demo` ("Aurora Seminovos"), com
-- estoque publicado — e ela aparecia na busca e no mapa para comprador de
-- verdade, que podia mandar lead ou agendar test drive com uma loja que não
-- existe (pendência de 27/09/2026, `docs/planos/estado-e-pendencias.md`).
--
-- Decisão de 27/09/2026: ela fica, como vitrine de demonstração que a landing
-- linka para o lojista em prospecção ver o produto funcionando. `is_demo` tira
-- a loja da busca global, do mapa, das buscas salvas e dos alertas, e a
-- vitrine passa a mostrar o aviso. A vitrine dela (`/c/demo`) continua no ar.
--
-- Nenhuma tabela nova, nenhuma policy nova: a coluna entra em `tenants`.

ALTER TABLE "tenants" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;

-- Só a loja `demo`. Num banco sem ela (desenvolvimento, testes) não faz nada.
UPDATE "tenants" SET "is_demo" = true WHERE "slug" = 'demo';
