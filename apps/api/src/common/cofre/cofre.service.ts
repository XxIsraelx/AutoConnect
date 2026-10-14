import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ScopedClient } from '../prisma/prisma.service';
import { cifrar, decifrar, lerChavesMestras, ultimos4, type ChavesMestras } from './cifra';

export interface SituacaoDaCredencial {
  ultimos4: string;
  cadastradaEm: Date;
  cadastradaPor: string | null;
}

const INDISPONIVEL =
  'O cofre de credenciais não está configurado nesta instalação (COFRE_CHAVES_MESTRAS).';

/**
 * Cofre de credenciais por loja.
 *
 * Decisão: `docs/decisoes/2026-10-14 cofre de credenciais por loja.md`. Regras
 * que este arquivo materializa:
 *
 *  - a chave entra, é cifrada e **não sai** por rota nenhuma — `abrir` é só
 *    para quem vai chamar o serviço externo, na hora da chamada;
 *  - trocar e revogar apagam a cifra e marcam a data (um CHECK no banco exige);
 *  - toda operação recebe a transação de quem chama, já sob `withTenant` da
 *    loja: o cofre não escolhe loja nenhuma sozinho.
 *
 * Sem `COFRE_CHAVES_MESTRAS`, o cofre fica desligado (malformada, com erro no
 * log) — o boot não cai, e quem precisa dele recebe 503.
 */
@Injectable()
export class CofreService {
  private readonly logger = new Logger('Cofre');
  private readonly chaves: ChavesMestras | null;

  constructor(config: ConfigService) {
    const bruta = config.get<string>('COFRE_CHAVES_MESTRAS');
    const lidas = lerChavesMestras(bruta);
    if ('erro' in lidas) {
      // Vazia é o estado normal enquanto nenhuma integradora exige chave da
      // loja — como `RENAVE_FORNECEDOR` vazio. Malformada é erro de quem
      // configurou, e precisa aparecer.
      if (bruta?.trim()) this.logger.error(`${lidas.erro}: cofre de credenciais desligado.`);
      else this.logger.log('COFRE_CHAVES_MESTRAS vazia: cofre de credenciais desligado.');
      this.chaves = null;
    } else {
      this.chaves = lidas;
    }
  }

  get disponivel(): boolean {
    return this.chaves !== null;
  }

  private exigir(): ChavesMestras {
    if (!this.chaves) throw new ServiceUnavailableException(INDISPONIVEL);
    return this.chaves;
  }

  /** Amarra a cifra à loja e ao serviço: copiada para outra linha, não abre. */
  private aad(tenantId: string, fornecedor: string, versao: number): string {
    return `${tenantId}:${fornecedor}:v${versao}`;
  }

  /** Grava a chave nova e aposenta a anterior, apagando a cifra dela. */
  async guardar(
    tx: ScopedClient, tenantId: string, fornecedor: string, segredo: string, autorId: string,
  ): Promise<SituacaoDaCredencial> {
    const chaves = this.exigir();
    const versao = chaves.atual;
    const c = cifrar(segredo, chaves.porVersao.get(versao)!, this.aad(tenantId, fornecedor, versao));

    await tx.credencialDeIntegracao.updateMany({
      where: { tenantId, fornecedor, substituidaEm: null, revogadaEm: null },
      data: { substituidaEm: new Date(), cifra: null, vetor: null, etiqueta: null },
    });
    const nova = await tx.credencialDeIntegracao.create({
      data: {
        tenantId, fornecedor, cifra: c.cifra, vetor: c.vetor, etiqueta: c.etiqueta,
        versaoDaChave: versao, ultimos4: ultimos4(segredo), cadastradaPor: autorId,
      },
      select: { ultimos4: true, cadastradaEm: true, cadastradaPor: true },
    });
    return nova;
  }

  async situacao(tx: ScopedClient, tenantId: string, fornecedor: string): Promise<SituacaoDaCredencial | null> {
    return tx.credencialDeIntegracao.findFirst({
      where: { tenantId, fornecedor, substituidaEm: null, revogadaEm: null },
      select: { ultimos4: true, cadastradaEm: true, cadastradaPor: true },
    });
  }

  /**
   * A chave em texto, para a chamada ao serviço externo — e para nada mais.
   * `null` quando a loja não cadastrou. Lança se a cifra não abrir (chave-mestra
   * trocada sem recifrar, linha adulterada): é falha alta, não ausência.
   */
  async abrir(tx: ScopedClient, tenantId: string, fornecedor: string): Promise<string | null> {
    const chaves = this.exigir();
    const linha = await tx.credencialDeIntegracao.findFirst({
      where: { tenantId, fornecedor, substituidaEm: null, revogadaEm: null },
      select: { cifra: true, vetor: true, etiqueta: true, versaoDaChave: true },
    });
    if (!linha?.cifra || !linha.vetor || !linha.etiqueta) return null;

    const chave = chaves.porVersao.get(linha.versaoDaChave);
    if (!chave) {
      throw new ServiceUnavailableException(
        `A credencial foi cifrada com a chave-mestra v${linha.versaoDaChave}, que não está mais configurada.`,
      );
    }
    return decifrar(
      { cifra: Buffer.from(linha.cifra), vetor: Buffer.from(linha.vetor), etiqueta: Buffer.from(linha.etiqueta) },
      chave,
      this.aad(tenantId, fornecedor, linha.versaoDaChave),
    );
  }

  /** Revoga a chave ativa: a linha fica, sem a cifra. Devolve se havia o que revogar. */
  async revogar(tx: ScopedClient, tenantId: string, fornecedor: string, autorId: string): Promise<boolean> {
    const r = await tx.credencialDeIntegracao.updateMany({
      where: { tenantId, fornecedor, substituidaEm: null, revogadaEm: null },
      data: { revogadaEm: new Date(), revogadaPor: autorId, cifra: null, vetor: null, etiqueta: null },
    });
    return r.count > 0;
  }
}
