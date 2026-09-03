import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageClient } from '@supabase/storage-js';

/**
 * Armazenamento de documentos com efeito jurídico.
 *
 * Contrato assinado e documento de identidade **não** podem seguir o caminho
 * das fotos de veículo, que sobem para a Cloudinary com preset *unsigned*:
 * ali qualquer um com a URL abre o arquivo. Aqui o bucket é privado, o upload
 * passa pelo backend e o acesso é por URL assinada de validade curta.
 *
 * Bucket separado do `vehicle-images` de propósito — misturar contrato com
 * foto pública é como uma política de bucket acaba afrouxada por engano.
 */
export interface DocumentoArmazenado {
  chave: string;
}

/** Minutos de validade da URL assinada. Curto porque o link circula por email. */
const VALIDADE_MINUTOS = 10;

@Injectable()
export class DocumentosStorage {
  private readonly logger = new Logger(DocumentosStorage.name);
  private readonly cliente: StorageClient | null;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const url = config.get<string>('SUPABASE_URL');
    const chave = config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.bucket = config.get<string>('SUPABASE_DOCUMENTS_BUCKET') ?? 'documentos';

    if (url && chave) {
      // `storage-js` e não `supabase-js`: o cliente completo inicializa o
      // Realtime, que exige WebSocket nativo (Node 22+) e quebraria esta API,
      // que roda em Node 20. Aqui só se usa Storage.
      this.cliente = new StorageClient(`${url.replace(/\/$/, '')}/storage/v1`, {
        apikey: chave,
        Authorization: `Bearer ${chave}`,
      });
    } else {
      this.cliente = null;
      // Não é erro de inicialização: sem storage o contrato continua sendo
      // regerado do snapshot e conferido pelo hash. O aviso existe para que a
      // ausência seja uma escolha visível, não uma descoberta em produção.
      this.logger.warn(
        'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: documentos não serão ' +
          'arquivados. O PDF do contrato segue sendo regerado sob demanda.',
      );
    }
  }

  get configurado(): boolean {
    return this.cliente !== null;
  }

  /**
   * Guarda o PDF. A chave inclui o tenant, o que mantém os documentos de cada
   * concessionária em prefixos distintos — útil para política de bucket e para
   * remoção em massa se uma loja sair.
   */
  async guardar(
    tenantId: string,
    nome: string,
    conteudo: Buffer,
  ): Promise<DocumentoArmazenado | null> {
    if (!this.cliente) return null;

    const chave = `${tenantId}/${nome}`;
    const { error } = await this.cliente
      .from(this.bucket)
      .upload(chave, conteudo, {
        contentType: 'application/pdf',
        // Contrato emitido não é sobrescrito: cada emissão é um arquivo novo.
        upsert: false,
      });

    if (error) {
      this.logger.error(`Falha ao arquivar ${chave}: ${error.message}`);
      return null;
    }

    return { chave };
  }

  /** URL assinada de validade curta. Nunca URL pública. */
  async urlAssinada(chave: string): Promise<string> {
    if (!this.cliente) {
      throw new ServiceUnavailableException(
        'Armazenamento de documentos não configurado nesta instalação.',
      );
    }

    const { data, error } = await this.cliente
      .from(this.bucket)
      .createSignedUrl(chave, VALIDADE_MINUTOS * 60);

    if (error || !data) {
      throw new ServiceUnavailableException(
        `Não foi possível gerar o link do documento: ${error?.message ?? 'sem retorno'}`,
      );
    }

    return data.signedUrl;
  }

  async baixar(chave: string): Promise<Buffer | null> {
    if (!this.cliente) return null;

    const { data, error } = await this.cliente.from(this.bucket).download(chave);
    if (error || !data) return null;

    return Buffer.from(await data.arrayBuffer());
  }
}
