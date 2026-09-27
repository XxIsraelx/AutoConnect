-- Preço travado por tabela e ciclo de cobrança.
--
-- Decisão de 27/09/2026 (`docs/decisoes/2026-09-27 plano de precos.md`):
--
--   price_table   — a tabela de preço em que a loja contratou (nome de uma
--                   entrada de `TABELAS_DE_PRECO`, no shared). Gravada na
--                   primeira contratação e mantida para sempre: a loja paga
--                   por ela mesmo depois que a tabela vigente subir, em
--                   qualquer plano. Nula até a primeira contratação.
--   billing_cycle — `mensal` ou `anual` (12 meses pelo preço de 10).
--
-- Nenhuma loja contratou ainda (não há conta na Asaas em produção), então não
-- há o que preencher: quem já tem assinatura segue mensal e sem trava até
-- contratar. Nenhuma tabela nova, nenhuma policy nova.

ALTER TABLE "tenant_subscriptions"
  ADD COLUMN "price_table" TEXT,
  ADD COLUMN "billing_cycle" TEXT NOT NULL DEFAULT 'mensal';
