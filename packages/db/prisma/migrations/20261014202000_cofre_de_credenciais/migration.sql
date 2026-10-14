-- Cofre de credenciais por loja (R3 do plano fiscal).
--
-- Decisão: docs/decisoes/2026-10-14 cofre de credenciais por loja.md
--
-- A loja contrata e paga a integradora RENAVE, então a chave de API é dela. A
-- tabela guarda a chave **cifrada** pela API (AES-256-GCM, chave-mestra no
-- `.env`); o banco nunca vê o texto. O que este arquivo garante além dela:
--
--  * uma credencial ativa por loja e fornecedor (índice único parcial);
--  * linha ativa tem cifra; linha substituída ou revogada **não tem** — a
--    trilha fica, a chave não;
--  * RLS por loja, como toda tabela com `tenant_id`.

-- CreateTable
CREATE TABLE "credenciais_de_integracao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "fornecedor" TEXT NOT NULL,
    "cifra" BYTEA,
    "vetor" BYTEA,
    "etiqueta" BYTEA,
    "versao_da_chave" INTEGER NOT NULL,
    "ultimos_4" TEXT NOT NULL,
    "cadastrada_por" UUID,
    "cadastrada_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "substituida_em" TIMESTAMPTZ,
    "revogada_em" TIMESTAMPTZ,
    "revogada_por" UUID,

    CONSTRAINT "credenciais_de_integracao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credenciais_de_integracao_tenant_id_fornecedor_idx" ON "credenciais_de_integracao"("tenant_id", "fornecedor");

-- AddForeignKey
ALTER TABLE "credenciais_de_integracao" ADD CONSTRAINT "credenciais_de_integracao_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uma chave viva por loja e serviço: trocar é substituir, nunca acumular.
CREATE UNIQUE INDEX "credenciais_de_integracao_ativa_idx"
  ON "credenciais_de_integracao"("tenant_id", "fornecedor")
  WHERE substituida_em IS NULL AND revogada_em IS NULL;

-- Ativa tem as três partes da cifra; inativa não tem nenhuma. Uma chave
-- substituída que continuasse cifrada aqui seria uma chave a mais para vazar.
ALTER TABLE "credenciais_de_integracao"
  ADD CONSTRAINT credencial_ativa_tem_cifra_inativa_nao CHECK (
    CASE
      WHEN substituida_em IS NULL AND revogada_em IS NULL
        THEN cifra IS NOT NULL AND vetor IS NOT NULL AND etiqueta IS NOT NULL
      ELSE cifra IS NULL AND vetor IS NULL AND etiqueta IS NULL
    END
  );

ALTER TABLE "credenciais_de_integracao"
  ADD CONSTRAINT credencial_versao_positiva CHECK (versao_da_chave > 0);

-- RLS
ALTER TABLE "credenciais_de_integracao" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "credenciais_de_integracao"
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
