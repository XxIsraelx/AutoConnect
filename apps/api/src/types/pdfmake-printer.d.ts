/**
 * O pacote `@types/pdfmake` descreve a build do **navegador** (`createPdf`),
 * não o printer do servidor, que é o que usamos. Esta declaração cobre só a
 * superfície que o `ContractPdfService` toca.
 */
declare module 'pdfmake' {
  import type { Readable } from 'node:stream';

  class PdfPrinter {
    constructor(fontDescriptors: Record<string, Record<string, string>>);
    createPdfKitDocument(docDefinition: object, options?: object): Readable & { end(): void };
  }

  export = PdfPrinter;
}
