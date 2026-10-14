/* eslint-disable no-console */
import { PrismaClient } from '@autoconnect/db';
import { cifrar, decifrar, lerChavesMestras, type ChavesMestras } from '../common/cofre/cifra';

/**
 * # Troca da chave-mestra do cofre de credenciais
 *
 * Decisão: `docs/decisoes/2026-10-14 cofre de credenciais por loja.md`.
 *
 * Como trocar, sem tirar a chave de nenhuma loja do ar:
 *
 * 1. Gere a nova: `openssl rand -base64 32`.
 * 2. No Railway, `COFRE_CHAVES_MESTRAS="1:<antiga>,2:<nova>"` e redeploy. A
 *    partir daí, tudo o que for cadastrado é cifrado com a v2, e a API ainda
 *    abre o que está na v1.
 * 3. Rode este comando com as mesmas variáveis:
 *    ```bash
 *    DIRECT_URL="postgresql://..." COFRE_CHAVES_MESTRAS="1:<antiga>,2:<nova>" \
 *      node apps/api/dist/scripts/recifrar-cofre.js
 *    ```
 * 4. Quando ele disser "0 restantes", tire a v1 da variável e redeploy.
 *
 * Usa a `DIRECT_URL` (dona das tabelas, ignora RLS), como o comando do super
 * admin: ele atravessa todas as lojas. Não carrega `.env`, de propósito — quem
 * mexe em chave de cofre diz contra qual banco.
 */

export type ClienteDoCofre = Pick<PrismaClient, 'credencialDeIntegracao'>;

export async function recifrarCofre(db: ClienteDoCofre, chaves: ChavesMestras): Promise<{ recifradas: number; restantes: number }> {
  const antigas = await db.credencialDeIntegracao.findMany({
    where: { versaoDaChave: { lt: chaves.atual }, substituidaEm: null, revogadaEm: null },
    select: { id: true, tenantId: true, fornecedor: true, cifra: true, vetor: true, etiqueta: true, versaoDaChave: true },
  });

  let recifradas = 0;
  for (const l of antigas) {
    const antiga = chaves.porVersao.get(l.versaoDaChave);
    if (!antiga || !l.cifra || !l.vetor || !l.etiqueta) continue;
    const texto = decifrar(
      { cifra: Buffer.from(l.cifra), vetor: Buffer.from(l.vetor), etiqueta: Buffer.from(l.etiqueta) },
      antiga,
      `${l.tenantId}:${l.fornecedor}:v${l.versaoDaChave}`,
    );
    const nova = cifrar(texto, chaves.porVersao.get(chaves.atual)!, `${l.tenantId}:${l.fornecedor}:v${chaves.atual}`);
    await db.credencialDeIntegracao.update({
      where: { id: l.id },
      data: { cifra: nova.cifra, vetor: nova.vetor, etiqueta: nova.etiqueta, versaoDaChave: chaves.atual },
    });
    recifradas++;
  }

  const restantes = await db.credencialDeIntegracao.count({
    where: { versaoDaChave: { lt: chaves.atual }, substituidaEm: null, revogadaEm: null },
  });
  return { recifradas, restantes };
}

async function main(): Promise<number> {
  const chaves = lerChavesMestras(process.env.COFRE_CHAVES_MESTRAS);
  if ('erro' in chaves) { console.error(chaves.erro); return 2; }

  const url = process.env.DIRECT_URL;
  if (!url) { console.error('DIRECT_URL não está definida.'); return 2; }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const r = await recifrarCofre(prisma, chaves);
    console.log(`${r.recifradas} recifradas para a v${chaves.atual}; ${r.restantes} restantes.`);
    return r.restantes === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then(
    (codigo) => { process.exitCode = codigo; },
    (err: unknown) => { console.error(err); process.exitCode = 1; },
  );
}
