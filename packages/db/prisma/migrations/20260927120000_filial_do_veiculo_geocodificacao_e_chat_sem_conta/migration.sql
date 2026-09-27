-- Três achados do piloto do primeiro dia, na mesma migration porque os três
-- são sobre **dado que nunca foi gravado**:
--
--   B7 — o veículo nascia sem `branch_id` (o assistente não pergunta), e o
--        cartão do mapa conta veículo *da filial*: toda loja anunciava
--        "0 veíc." com o estoque publicado;
--   B8 — não havia como dizer onde a loja fica. A coordenada era geocodificada
--        pelo município e persistida, então o pino ficava na praça central para
--        sempre — e duas lojas da mesma cidade no mesmo ponto;
--   B11 — `conversations.customer_user_id` era NOT NULL, e o lead da Onda 0
--        nasce sem conta por definição: o chat que o produto anuncia não
--        existia justamente para o lead que ele mesmo captura.
--
-- Nenhuma tabela nova: nenhuma policy nova é necessária. As colunas entram em
-- `conversations` e `dealership_branches`, que já têm `tenant_isolation`
-- (`conversations` tem também `acesso_cliente`, que compara
-- `customer_user_id` com `app.user_id` — com a coluna nula a comparação é
-- falsa, que é exatamente o desejado: conversa sem conta não pertence a
-- cliente nenhum).

-- ─────────────────────────────────────────────────────────
-- 1. B7 — o veículo que já existe ganha a filial da loja
-- ─────────────────────────────────────────────────────────
-- Backfill conservador: só quando **não há ambiguidade**, isto é, quando a
-- loja tem uma matriz (o caso de 100% das lojas no dia zero) ou uma filial
-- ativa só. Loja com várias filiais e nenhuma matriz fica como está — e a
-- contagem do mapa passa a somar o que está sem filial na matriz, então
-- nenhuma loja volta a anunciar zero por causa de coluna vazia.
UPDATE vehicles v
SET branch_id = escolhida.id
FROM (
  SELECT DISTINCT ON (tenant_id) tenant_id, id
  FROM dealership_branches
  WHERE is_active
  ORDER BY tenant_id, is_headquarters DESC, created_at ASC
) escolhida
WHERE v.branch_id IS NULL
  AND v.tenant_id = escolhida.tenant_id
  AND (
    -- matriz declarada, ou filial única
    EXISTS (
      SELECT 1 FROM dealership_branches b
      WHERE b.id = escolhida.id AND b.is_headquarters
    )
    OR (
      SELECT count(*) FROM dealership_branches b
      WHERE b.tenant_id = v.tenant_id AND b.is_active
    ) = 1
  );

-- ─────────────────────────────────────────────────────────
-- 2. B8 — de onde vieram as coordenadas da filial
-- ─────────────────────────────────────────────────────────
CREATE TYPE "GeocodePrecision" AS ENUM ('manual', 'address', 'city');

ALTER TABLE dealership_branches
  ADD COLUMN geocode_precision "GeocodePrecision",
  ADD COLUMN geocoded_at TIMESTAMPTZ;

-- Toda coordenada que existe hoje veio do geocodificador de **município** do
-- `map.service.ts`: não havia campo de latitude em lugar nenhum da interface.
-- Marcá-las como `city` é o que as torna provisórias — a próxima leitura do
-- mapa tenta subir para `address` assim que a filial tiver rua e número.
UPDATE dealership_branches
SET geocode_precision = 'city'
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ─────────────────────────────────────────────────────────
-- 3. B11 — conversa de lead sem conta
-- ─────────────────────────────────────────────────────────
-- O contato é **copiado**, como em `appointments`: a conversa precisa dizer com
-- quem é mesmo depois de o lead ser apagado (a relação é opcional e viraria
-- nula). `guest_token_hash` é sha256 do link do visitante, o mesmo esquema de
-- `user_invitations.token_hash` — o valor cru nunca é guardado.
ALTER TABLE conversations
  ALTER COLUMN customer_user_id DROP NOT NULL,
  ADD COLUMN contact_name text,
  ADD COLUMN contact_phone text,
  ADD COLUMN contact_email citext,
  ADD COLUMN guest_token_hash text;

CREATE UNIQUE INDEX conversations_guest_token_hash_key
  ON conversations (guest_token_hash);

-- A invariante que impede a loja de escrever para ninguém: ou há uma conta do
-- outro lado, ou há um nome **e** um link por onde a pessoa entra. Conversa sem
-- conta e sem token seria uma caixa de saída sem destinatário.
ALTER TABLE conversations
  ADD CONSTRAINT conversations_tem_quem_responde CHECK (
    customer_user_id IS NOT NULL
    OR (contact_name IS NOT NULL AND guest_token_hash IS NOT NULL)
  );
