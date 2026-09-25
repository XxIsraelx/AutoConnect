import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Todo controller declarado está montado em algum módulo.
 *
 * O `PublicInvitationsController` existiu por semanas sem estar em
 * `controllers:` do `InvitationsModule`: compilava, passava no lint, passava no
 * typecheck, e `POST /public/invitations/accept` respondia 404 para a tela que
 * o chamava. Não há erro de compilação para isso — o decorador só marca a
 * classe, quem a monta é a lista do módulo.
 *
 * É unitário de propósito: lê o código-fonte, não sobe o Nest, e roda junto do
 * resto em milissegundos. O e2e prova que a rota responde; este prova que
 * nenhuma outra ficou de fora.
 */

const SRC = join(__dirname, '..');

function arquivosTs(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosTs(caminho, acc);
    else if (nome.endsWith('.ts') && !nome.endsWith('.spec.ts')) acc.push(caminho);
  }
  return acc;
}

const arquivos = arquivosTs(SRC);

/** `@Controller(...)` seguido (com ou sem outros decoradores) de `export class X`. */
function controllersDeclarados(): { classe: string; arquivo: string }[] {
  const achados: { classe: string; arquivo: string }[] = [];
  for (const arquivo of arquivos) {
    const conteudo = readFileSync(arquivo, 'utf8');
    if (!conteudo.includes('@Controller(')) continue;
    for (const m of conteudo.matchAll(/export\s+class\s+(\w*Controller)\b/g)) {
      achados.push({ classe: m[1], arquivo: relative(SRC, arquivo) });
    }
  }
  return achados;
}

/** Tudo que aparece dentro de `controllers: [ … ]` em qualquer `*.module.ts`. */
function controllersRegistrados(): Set<string> {
  const registrados = new Set<string>();
  for (const arquivo of arquivos.filter((a) => a.endsWith('.module.ts'))) {
    const conteudo = readFileSync(arquivo, 'utf8');
    for (const bloco of conteudo.matchAll(/controllers:\s*\[([^\]]*)\]/gs)) {
      for (const nome of bloco[1].split(',')) {
        const limpo = nome.trim();
        if (limpo) registrados.add(limpo);
      }
    }
  }
  return registrados;
}

describe('controllers registrados', () => {
  it('nenhum controller fica órfão — declarado e nunca montado', () => {
    const registrados = controllersRegistrados();
    const orfaos = controllersDeclarados()
      .filter(({ classe }) => !registrados.has(classe))
      .map(({ classe, arquivo }) => `${classe} (${arquivo})`);

    expect(orfaos).toEqual([]);
  });

  it('o próprio varredor enxerga os controllers — senão o teste acima é vácuo', () => {
    const declarados = controllersDeclarados().map((c) => c.classe);
    expect(declarados).toContain('PublicInvitationsController');
    expect(declarados).toContain('InvitationsController');
    // Vários controllers moram no mesmo arquivo; a contagem baixa denunciaria
    // um regex que só pega o primeiro de cada um.
    expect(declarados.length).toBeGreaterThan(20);
  });
});
