import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import PdfPrinter = require('pdfmake');
import { paraConteudo, blocoDeValores, type Bloco, type SnapshotContrato } from './blocos';

/**
 * Fontes embutidas no pdfkit — nenhum arquivo de fonte é enviado no deploy.
 *
 * O plano descarta Puppeteer por causa do peso no Railway; usar as fontes
 * padrão mantém a mesma disciplina: sem binário, sem asset externo, sem
 * download em tempo de execução (que também tornaria a saída não determinística).
 */
const FONTES = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

export interface PdfGerado {
  pdf: Buffer;
  /** SHA-256 do arquivo, calculado no momento em que ele nasce. */
  hash: string;
}

@Injectable()
export class ContractPdfService {
  private readonly printer = new PdfPrinter(FONTES);

  /**
   * Gera o PDF do contrato.
   *
   * `emitidoEm` entra como data de criação do documento porque, sem fixá-la,
   * o pdfmake carimba o relógio e **o mesmo contrato produz bytes diferentes a
   * cada geração** — medido, não suposto. Com ela fixa, regerar o mesmo
   * contrato devolve byte a byte o mesmo arquivo, que é o que dá sentido ao
   * hash.
   */
  async gerar(
    blocos: Bloco[],
    snapshot: SnapshotContrato,
    emitidoEm: Date,
  ): Promise<PdfGerado> {
    const conteudo = paraConteudo(blocos, snapshot);

    // O quadro de pagamento entra logo após a cláusula de preço.
    const iPreco = blocos.findIndex(
      (b) => b.tipo === 'clausula' && /PREÇO/i.test(b.titulo),
    );
    if (iPreco >= 0) {
      // Cada cláusula rende dois itens no conteúdo (título + lista).
      const pos = blocos.slice(0, iPreco + 1).reduce(
        (acc, b) => acc + (b.tipo === 'clausula' ? 2 : 1),
        0,
      );
      conteudo.splice(pos, 0, blocoDeValores(snapshot));
    }

    const doc = this.printer.createPdfKitDocument({
      content: conteudo,
      defaultStyle: { font: 'Helvetica', fontSize: 10, lineHeight: 1.3 },
      styles: {
        titulo: { fontSize: 14, bold: true, alignment: 'center' },
        clausula: { fontSize: 11, bold: true },
        corpo: { fontSize: 10 },
      },
      pageMargins: [50, 50, 50, 50],
      info: {
        title: 'Contrato de compra e venda',
        author: snapshot.loja.nome,
        creationDate: emitidoEm,
      },
    });

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const partes: Buffer[] = [];
      doc.on('data', (d: Buffer) => partes.push(d));
      doc.on('end', () => resolve(Buffer.concat(partes)));
      doc.on('error', reject);
      doc.end();
    });

    return { pdf, hash: createHash('sha256').update(pdf).digest('hex') };
  }
}
