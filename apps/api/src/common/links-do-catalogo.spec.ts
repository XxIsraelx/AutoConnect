import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { PARAMS_ACEITOS, veiculoDaBusca } from '@autoconnect/shared';

/**
 * # O link que uma tela monta é o link que a outra lê
 *
 * B14 do piloto do primeiro dia: a vitrine da loja (`c/[slug]`) linkava para
 * `/catalogo/<loja>?vehicleId=<id>` e o catálogo lia **`?v=`**. Clicar no carro
 * na vitrine abria a lista, não o carro. O `/buscar`, que usava `?v=`,
 * funcionava — então nem o compilador nem o olho de quem revisa notavam.
 *
 * É estático de propósito, como `servicos-externos-do-web.spec.ts`: o `apps/web`
 * não tem runner de teste, e a regra que importa aqui é sobre **onde o
 * conhecimento do nome do parâmetro mora**. Ele mora num módulo do shared, com
 * teste próprio (`link-de-catalogo.spec.ts`); este arquivo é o que impede uma
 * tela nova de inventar o terceiro nome.
 */

const WEB = join(__dirname, '..', '..', '..', 'web', 'src');

/** O único arquivo autorizado a montar o link — o resto usa a função dele. */
const MONTADOR = 'linkDoVeiculoNoCatalogo';

function arquivosDoWeb(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosDoWeb(caminho, acc);
    else if (/\.tsx?$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

const arquivos = arquivosDoWeb(WEB).map((caminho) => ({
  relativo: relative(WEB, caminho).split('\\').join('/'),
  conteudo: readFileSync(caminho, 'utf8'),
}));

/** `/catalogo/${x}?vehicleId=${y}` → o nome do parâmetro usado. */
const LINK_COM_QUERY = /\/catalogo\/[^`'"\s]*\?([A-Za-z_][A-Za-z0-9_]*)=/g;

describe('link do veículo no catálogo', () => {
  it('a varredura enxerga o apps/web — senão o resto é vácuo', () => {
    expect(arquivos.length).toBeGreaterThan(30);
    expect(arquivos.map((a) => a.relativo)).toContain('app/catalogo/[id]/CatalogoContent.tsx');
  });

  it('nenhuma tela monta o link à mão: o parâmetro tem um dono só', () => {
    const culpados: string[] = [];

    for (const arquivo of arquivos) {
      for (const achado of arquivo.conteudo.matchAll(LINK_COM_QUERY)) {
        culpados.push(`${arquivo.relativo}: ?${achado[1]}=`);
      }
    }

    // Antes desta correção, a lista continha
    // `app/c/[slug]/PublicDealerClient.tsx: ?vehicleId=` — o link que não abria
    // o carro — e `app/buscar/Sidebar.tsx: ?v=`, que abria. Dois nomes para a
    // mesma coisa, e nada que os obrigasse a concordar.
    expect(culpados).toEqual([]);
  });

  it('quem precisa do link usa o montador do shared', () => {
    const usam = arquivos.filter((a) => a.conteudo.includes(MONTADOR)).map((a) => a.relativo);

    // As duas telas que levam o visitante ao catálogo: a vitrine da loja e o mapa.
    expect(usam).toContain('app/c/[slug]/PublicDealerClient.tsx');
    expect(usam).toContain('app/buscar/Sidebar.tsx');
  });

  it('o catálogo lê pelo leitor do shared, que aceita o parâmetro antigo', () => {
    const catalogo = arquivos.find((a) => a.relativo === 'app/catalogo/[id]/CatalogoContent.tsx');
    expect(catalogo!.conteudo).toContain('veiculoDaBusca');

    // O link de ontem, compartilhado no WhatsApp, continua abrindo o carro.
    expect(PARAMS_ACEITOS).toContain('vehicleId');
    expect(veiculoDaBusca('?vehicleId=abc')).toBe('abc');
  });
});
