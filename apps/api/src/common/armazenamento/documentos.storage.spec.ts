import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { DocumentosStorage } from './documentos.storage';

const config = (vars: Record<string, string | undefined>) =>
  ({ get: (k: string) => vars[k] }) as ConfigService;

/**
 * O comportamento sem credencial importa tanto quanto o com: hoje a instalação
 * roda sem `SUPABASE_URL`, e o contrato precisa continuar sendo emitido.
 */
describe('DocumentosStorage', () => {
  describe('sem credencial', () => {
    const storage = new DocumentosStorage(config({ SUPABASE_STORAGE_BUCKET: 'x' }));

    it('não se declara configurado', () => {
      expect(storage.configurado).toBe(false);
    });

    it('guardar devolve null em vez de explodir — a emissão não pode parar', async () => {
      await expect(storage.guardar('t1', 'c/1.pdf', Buffer.from('x'))).resolves.toBeNull();
    });

    it('pedir link falha alto: link que não existe não pode virar link quebrado', async () => {
      await expect(storage.urlAssinada('t1/c/1.pdf')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('baixar devolve null', async () => {
      await expect(storage.baixar('t1/c/1.pdf')).resolves.toBeNull();
    });
  });

  describe('com credencial', () => {
    const storage = new DocumentosStorage(
      config({
        SUPABASE_URL: 'https://exemplo.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'chave-de-servico',
        SUPABASE_DOCUMENTS_BUCKET: 'contratos',
      }),
    );

    it('se declara configurado', () => {
      expect(storage.configurado).toBe(true);
    });

    it('usa bucket separado do de fotos de veículo', () => {
      // `vehicle-images` é público por natureza; contrato assinado não divide
      // bucket com foto de anúncio.
      expect((storage as unknown as { bucket: string }).bucket).toBe('contratos');
    });

    it('o bucket padrão não é o de imagens', () => {
      const semBucket = new DocumentosStorage(
        config({ SUPABASE_URL: 'https://e.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }),
      );
      expect((semBucket as unknown as { bucket: string }).bucket).toBe('documentos');
    });
  });

  it('a chave separa os documentos por concessionária', async () => {
    // Prefixo por tenant sustenta política de bucket e remoção em massa.
    const chamadas: { chave: string }[] = [];
    const storage = new DocumentosStorage(
      config({ SUPABASE_URL: 'https://e.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }),
    );
    (storage as unknown as { cliente: unknown }).cliente = {
      from: () => ({
        upload: (chave: string) => {
          chamadas.push({ chave });
          return Promise.resolve({ error: null });
        },
      }),
    };

    await storage.guardar('tenant-abc', 'contratos/hash.pdf', Buffer.from('x'));

    expect(chamadas[0].chave).toBe('tenant-abc/contratos/hash.pdf');
  });
});
