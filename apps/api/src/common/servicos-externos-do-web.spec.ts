import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Serviço externo que o **navegador** chama passa por um módulo só, e esse
 * módulo confere a configuração antes de tentar.
 *
 * O envio de foto montava a URL da Cloudinary em dois arquivos de página, com
 * `process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? ''` e nenhuma checagem: num
 * ambiente sem a variável a URL virava
 * `https://api.cloudinary.com/v1_1//image/upload`, toda foto falhava com "Falha
 * ao enviar uma das imagens" e — porque publicar exige pelo menos uma foto —
 * **nenhum carro chegava ao catálogo público**. O lojista tentava cinco vezes e
 * concluía que o produto estava quebrado.
 *
 * A API já dá o exemplo certo: `DocumentosStorage` avisa no boot quando o
 * Supabase Storage não está configurado. Este teste é o que impede a chamada
 * direta de voltar para dentro de uma página, onde a checagem se perde de novo.
 *
 * É estático de propósito: o `apps/web` não tem runner de teste, e a regra que
 * importa aqui é sobre onde o código mora.
 */

const WEB = join(__dirname, '..', '..', '..', 'web', 'src');

/**
 * Serviço externo chamado pelo navegador → o único arquivo autorizado a
 * conhecê-lo. Uma entrada nova aqui é uma decisão, não um detalhe.
 */
const PORTEIROS = new Map<string, string>([
  ['api.cloudinary.com', 'lib/uploadDeFotos.ts'],
]);

/** Variáveis cuja ausência precisa ser visível — no boot e na tela. */
const VARIAVEIS_DO_PORTEIRO: Record<string, string[]> = {
  'lib/uploadDeFotos.ts': [
    'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME',
    'NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET',
  ],
};

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

describe('serviços externos chamados pelo navegador', () => {
  it('a varredura enxerga o apps/web — senão o resto é vácuo', () => {
    expect(arquivos.length).toBeGreaterThan(30);
    expect(arquivos.map((a) => a.relativo)).toContain('lib/uploadDeFotos.ts');
  });

  it.each([...PORTEIROS])('%s só é chamado por %s', (host, porteiro) => {
    const fora = arquivos
      .filter((a) => a.relativo !== porteiro && a.conteudo.includes(host))
      .map((a) => a.relativo);

    expect(fora).toEqual([]);
  });

  it('o porteiro confere a configuração antes de chamar', () => {
    for (const [porteiro, variaveis] of Object.entries(VARIAVEIS_DO_PORTEIRO)) {
      const arquivo = arquivos.find((a) => a.relativo === porteiro);
      expect(arquivo).toBeDefined();

      for (const variavel of variaveis) {
        expect(arquivo!.conteudo).toContain(variavel);
      }
      // Sem um caminho de "não configurado" a mensagem volta a ser a mesma para
      // ambiente sem integração e para foto recusada.
      expect(arquivo!.conteudo).toMatch(/ENVIO_DE_FOTOS_CONFIGURADO/);
      expect(arquivo!.conteudo).toMatch(/NaoConfigurado|indispon[íi]vel/i);
    }
  });

  it('a ausência é avisada na subida do web, como o DocumentosStorage faz na API', () => {
    const config = readFileSync(join(WEB, '..', 'next.config.mjs'), 'utf8');

    for (const variavel of VARIAVEIS_DO_PORTEIRO['lib/uploadDeFotos.ts']) {
      expect(config).toContain(variavel);
    }
    expect(config).toMatch(/console\.warn/);
  });

  it('e também na tela, antes de a pessoa tentar', () => {
    const aviso = arquivos.find((a) => a.relativo === 'components/AvisoDeEnvioDeFotos.tsx');
    expect(aviso).toBeDefined();

    // As duas telas que enviam foto mostram a faixa.
    const telasDeFoto = [
      'app/(dashboard)/veiculos/novo/page.tsx',
      'app/(dashboard)/veiculos/[id]/page.tsx',
    ];
    for (const tela of telasDeFoto) {
      const arquivo = arquivos.find((a) => a.relativo === tela);
      expect(arquivo).toBeDefined();
      expect(arquivo!.conteudo).toContain('AvisoDeEnvioDeFotos');
    }
  });
});
