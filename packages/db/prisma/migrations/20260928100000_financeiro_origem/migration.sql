-- Financeiro — Fase 3: o lançamento que nasce do que a loja já fez.
--
-- Plano: docs/planos/plano-financeiro.md
--
-- Duas mudanças, as duas sobre **encontrar** em vez de copiar:
--
--  * `financial_categories.origin_key` — a chave estável das categorias que a
--    geração automática procura. A busca é por ela e nunca pelo nome: a loja
--    renomeia "Compra de veículo" para "Aquisição" no primeiro dia, e uma
--    geração que procura por nome pararia de achar **em silêncio** — o pior dos
--    casos, porque o dinheiro simplesmente não apareceria no caixa.
--  * `vehicle_acquisition_id` e `vehicle_cost_id` no lançamento, únicos. São FKs
--    explícitas, e não um par `origem_tabela`/`origem_id` genérico, porque é a
--    unicidade da coluna que torna a geração idempotente **por construção**:
--    rodar duas vezes não cria a segunda conta a pagar.

-- AlterTable
ALTER TABLE "financial_categories" ADD COLUMN     "origin_key" TEXT;

-- AlterTable
ALTER TABLE "financial_entries" ADD COLUMN     "vehicle_acquisition_id" UUID,
ADD COLUMN     "vehicle_cost_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "financial_categories_tenant_id_origin_key_key" ON "financial_categories"("tenant_id", "origin_key");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entries_vehicle_acquisition_id_key" ON "financial_entries"("vehicle_acquisition_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entries_vehicle_cost_id_key" ON "financial_entries"("vehicle_cost_id");

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_vehicle_acquisition_id_fkey" FOREIGN KEY ("vehicle_acquisition_id") REFERENCES "vehicle_acquisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_vehicle_cost_id_fkey" FOREIGN KEY ("vehicle_cost_id") REFERENCES "vehicle_costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: as lojas que já semearam o plano de contas recebem a chave nas
-- quatro categorias pelo nome que o próprio sistema criou. Feito uma vez, aqui,
-- e não em código: depois deste ponto a chave nasce com a categoria.
UPDATE "financial_categories" SET origin_key = 'venda_de_veiculo'
  WHERE direction = 'entrada' AND name = 'Venda de veículo' AND origin_key IS NULL;
UPDATE "financial_categories" SET origin_key = 'compra_de_veiculo'
  WHERE direction = 'saida' AND name = 'Compra de veículo' AND origin_key IS NULL;
UPDATE "financial_categories" SET origin_key = 'preparacao'
  WHERE direction = 'saida' AND name = 'Preparação e funilaria' AND origin_key IS NULL;
UPDATE "financial_categories" SET origin_key = 'comissao'
  WHERE direction = 'saida' AND name = 'Comissão de vendedor' AND origin_key IS NULL;
