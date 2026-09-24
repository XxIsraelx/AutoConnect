import { Injectable } from '@nestjs/common';
import type { Bloco, SnapshotContrato } from './blocos';
import { gerarPdfDoContrato, type PdfGerado } from './gerar-pdf';

export type { PdfGerado };

/**
 * Invólucro injetável da geração do contrato.
 *
 * A geração em si vive em `gerar-pdf.ts`, sem Nest, para que o gerador da loja
 * de demonstração (`packages/db/prisma/demo.ts`) use exatamente o mesmo código
 * — um contrato de demonstração com hash divergente quebraria o download.
 */
@Injectable()
export class ContractPdfService {
  gerar(
    blocos: Bloco[],
    snapshot: SnapshotContrato,
    emitidoEm: Date,
  ): Promise<PdfGerado> {
    return gerarPdfDoContrato(blocos, snapshot, emitidoEm);
  }
}
