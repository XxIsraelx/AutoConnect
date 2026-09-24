-- Rascunho de anúncio (Onda 1, item 11).
--
-- Até aqui, cadastrar um veículo era publicá-lo: `status = 'available'` bastava
-- para ele aparecer no catálogo, na busca e no mapa. Não havia um momento em
-- que a loja dissesse "pode ir ao ar" — o carro estreava sem foto, com o preço
-- que o vendedor ainda ia conferir.
--
-- O estado do ANÚNCIO passa a ser separado do estado do ESTOQUE:
--   VehicleStatus  → a loja ainda tem este carro?  (available, sold, …)
--   ListingStatus  → este carro está na vitrine?   (draft, published, unpublished)
--
-- Por que um enum e não `published_at IS NULL`: o nulo não distingue "nunca foi
-- ao ar" de "foi tirado do ar", e despublicar teria de apagar a data da estreia
-- — que é justamente o que a lista de estoque usa para contar dias de giro.

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('draft', 'published', 'unpublished');

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "listing_status" "ListingStatus" NOT NULL DEFAULT 'draft';

-- CreateIndex
CREATE INDEX "vehicles_tenant_id_listing_status_idx" ON "vehicles"("tenant_id", "listing_status");

-- ─────────────────────────────────────────────────────────
-- Compatibilidade: o que já estava no ar continua no ar
-- ─────────────────────────────────────────────────────────
-- O DEFAULT acima vale para linha nova. Sem este UPDATE, toda loja em uso
-- perderia o catálogo inteiro no deploy — o estoque continuaria lá, mas a
-- vitrine ficaria vazia, e ninguém entenderia por quê.
--
-- O critério é exatamente o que decidia a visibilidade antes desta migration:
-- `status = 'available'`. Nada mais, nada menos.
UPDATE "vehicles"
   SET "listing_status" = 'published',
       -- Só preenche quando falta: o seed já grava `published_at`, e
       -- sobrescrever zeraria o giro de estoque de quem tem a data real.
       "published_at"   = COALESCE("published_at", "created_at")
 WHERE "status" = 'available';

-- ─────────────────────────────────────────────────────────
-- RLS: a vitrine pública passa a exigir anúncio publicado
-- ─────────────────────────────────────────────────────────
-- A policy `leitura_publica` de 20260902120000 liberava `status = 'available'`
-- porque era assim que a aplicação consultava. Agora a aplicação exige as duas
-- condições, e a policy acompanha — se ficasse só no `where` do service, um
-- caminho público novo que esquecesse o filtro voltaria a expor rascunho.
--
-- O `USING` continua mais permissivo que restritivo por construção: policies
-- permissivas somam (OR), então a loja dona segue vendo o próprio rascunho
-- pela policy `tenant_isolation`.

DROP POLICY "leitura_publica" ON "vehicles";
CREATE POLICY "leitura_publica" ON "vehicles"
  FOR SELECT USING (status = 'available' AND listing_status = 'published');

DROP POLICY "leitura_publica" ON "vehicle_images";
CREATE POLICY "leitura_publica" ON "vehicle_images"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicles v
       WHERE v.id = vehicle_images.vehicle_id
         AND v.status = 'available'
         AND v.listing_status = 'published'
    )
  );
