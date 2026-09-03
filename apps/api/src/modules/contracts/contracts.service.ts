import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import {
  validarGarantia, GARANTIA_LEGAL_DIAS, formatarCpf, qualificarComprador,
} from '@autoconnect/shared';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { ContractPdfService } from './contract-pdf.service';
import { DocumentosStorage } from '../../common/armazenamento/documentos.storage';
import { TEMPLATE_PADRAO, type Bloco, type SnapshotContrato } from './blocos';

const brl = (d: Prisma.Decimal) =>
  d.toNumber().toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly pdf: ContractPdfService,
    private readonly storage: DocumentosStorage,
  ) {}

  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new BadRequestException('Selecione uma concessionária para emitir contrato.');
    }
    return escopo.tenantId;
  }

  /** Template ativo do tenant; cria o padrão na primeira emissão. */
  private async templateAtivo(tx: ScopedClient, tenantId: string) {
    const existente = await tx.contractTemplate.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (existente) return existente;

    return tx.contractTemplate.create({
      data: {
        tenantId,
        name: 'Compra e venda',
        version: 1,
        blocks: TEMPLATE_PADRAO as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Emite o contrato do negócio.
   *
   * Cada emissão é um documento novo, com hash próprio: reemitir não sobrescreve
   * o anterior. Um contrato já emitido é anulado, não editado — é o que permite
   * responder "qual documento essa pessoa assinou?" meses depois.
   */
  async emitir(escopo: Escopo, dealId: string, atorId: string) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const negocio = await tx.deal.findFirst({
        where: { id: dealId, tenantId },
        include: {
          vehicle: { include: { brand: true, model: true } },
          customer: { select: { fullName: true, email: true } },
          payments: { where: { status: { in: ['pending', 'confirmed'] } }, orderBy: { createdAt: 'asc' } },
          tenant: { select: { tradeName: true, taxId: true } },
          warranty: true,
          buyer: true,
        },
      });
      if (!negocio) throw new NotFoundException('Negócio não encontrado');

      if (negocio.status === 'canceled' || negocio.status === 'rescinded') {
        throw new ConflictException(`Negócio em "${negocio.status}" não emite contrato.`);
      }

      // Sem identificar o comprador, o contrato diria "portador(a) do documento
      // ____" e não identificaria a parte — parece documento e não serve como
      // um. Melhor recusar e dizer onde preencher.
      if (!negocio.buyer) {
        throw new ConflictException(
          'Preencha a qualificação do comprador (nome, CPF e endereço) antes de ' +
            'emitir o contrato — sem ela o documento não identifica a parte.',
        );
      }

      const garantia = {
        legalDays: negocio.warranty?.legalDays ?? GARANTIA_LEGAL_DIAS,
        contractualMonths: negocio.warranty?.contractualMonths ?? null,
        contractualScope: negocio.warranty?.contractualScope ?? null,
      };

      // Dez linhas que evitam um processo: o contrato não sai se a garantia
      // contratual estiver disfarçando redução da legal.
      const veredito = validarGarantia(garantia);
      if (!veredito.ok) throw new ConflictException(veredito.motivo);

      const template = await this.templateAtivo(tx, tenantId);
      const emitidoEm = new Date();

      const filial = await tx.dealershipBranch.findFirst({
        where: { tenantId, isActive: true },
        select: { addressLine: true, addressNumber: true, city: true, state: true },
      });

      const snapshot: SnapshotContrato = {
        emitidoEm: emitidoEm.toLocaleDateString('pt-BR'),
        loja: {
          nome: negocio.tenant.tradeName,
          documento: negocio.tenant.taxId,
          endereco: filial
            ? [
                [filial.addressLine, filial.addressNumber].filter(Boolean).join(', '),
                filial.city,
                filial.state,
              ].filter(Boolean).join(' — ')
            : null,
        },
        cliente: {
          nome: negocio.buyer.fullName,
          documento: formatarCpf(negocio.buyer.cpf),
          email: negocio.customer?.email ?? null,
          // Frase pronta com nacionalidade, estado civil, profissão, CPF, RG e
          // endereço, na ordem da praxe. Montada no domínio para que o
          // template não precise saber quais campos existem.
          qualificacao: qualificarComprador(negocio.buyer),
        },
        veiculo: {
          descricao: `${negocio.vehicle.brand.name} ${negocio.vehicle.model.name} ${negocio.vehicle.versionName ?? ''}`.trim(),
          anoModelo: negocio.vehicle.yearModel,
          anoFabricacao: negocio.vehicle.yearMake,
          placa: negocio.vehicle.licensePlate,
          chassi: negocio.vehicle.vin,
          km: negocio.vehicle.mileageKm,
        },
        valores: {
          tabela: brl(negocio.listPrice),
          desconto: brl(negocio.discount),
          venda: brl(negocio.saleValue),
        },
        pagamentos: negocio.payments.map((p) => ({
          forma: p.kind,
          valor: brl(p.value),
          detalhe: [p.institution, p.installments ? `${p.installments}x` : null]
            .filter(Boolean).join(' · ') || null,
        })),
        garantia,
      };

      const { pdf, hash } = await this.pdf.gerar(
        template.blocks as unknown as Bloco[],
        snapshot,
        emitidoEm,
      );

      // Arquiva no bucket privado quando configurado. Falhar aqui não impede a
      // emissão: o contrato continua reproduzível a partir do snapshot, e um
      // documento não emitido é pior do que um documento não arquivado.
      const guardado = await this.storage.guardar(
        tenantId, `contratos/${hash}.pdf`, pdf,
      );

      const contrato = await tx.dealContract.create({
        data: {
          tenantId,
          dealId,
          templateId: template.id,
          status: 'issued',
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          contentHash: hash,
          storageKey: guardado?.chave,
          issuedAt: emitidoEm,
        },
      });

      await tx.dealStatusEvent.create({
        data: {
          tenantId, dealId,
          fromStatus: negocio.status, toStatus: negocio.status,
          actorUserId: atorId,
          reason: `Contrato emitido (${hash.slice(0, 12)}…)`,
        },
      });

      return contrato;
    });
  }

  async doNegocio(escopo: Escopo, dealId: string) {
    const ler = (tx: ScopedClient) =>
      tx.dealContract.findMany({
        where: { dealId, ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }) },
        include: { signatures: true, template: { select: { name: true, version: true } } },
        orderBy: { issuedAt: 'desc' },
      });

    if (ehGlobal(escopo)) return ler(this.privilegiado);
    return this.prisma.withTenant(escopo.tenantId, ler);
  }

  /**
   * Regenera o PDF a partir do snapshot e do template versionado e confere o
   * hash. Como a geração é determinística, bater o hash prova que o documento
   * entregue é exatamente o que foi emitido — sem depender de armazenamento.
   */
  async baixar(escopo: Escopo, id: string) {
    const ler = async (tx: ScopedClient) => {
      const contrato = await tx.dealContract.findFirst({
        where: { id, ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }) },
        include: { template: true },
      });
      if (!contrato) throw new NotFoundException('Contrato não encontrado');

      const { pdf, hash } = await this.pdf.gerar(
        contrato.template.blocks as unknown as Bloco[],
        contrato.snapshot as unknown as SnapshotContrato,
        contrato.issuedAt,
      );

      if (hash !== contrato.contentHash) {
        // Não é hipótese remota: é o que acontece se alguém alterar o template
        // sem versionar, ou mexer no snapshot por fora da aplicação.
        throw new ConflictException(
          'O contrato regerado não confere com o hash da emissão. ' +
            'O documento pode ter sido alterado — não será entregue.',
        );
      }

      return { pdf, contrato };
    };

    if (ehGlobal(escopo)) return ler(this.privilegiado);
    return this.prisma.withTenant(escopo.tenantId, ler);
  }

  /**
   * Link temporário para o documento arquivado.
   *
   * Só existe quando há storage configurado — sem ele o download passa pelo
   * backend, que é mais lento porém igualmente seguro.
   */
  async linkTemporario(escopo: Escopo, id: string): Promise<{ url: string; expiraEmMinutos: number }> {
    const ler = async (tx: ScopedClient) => {
      const contrato = await tx.dealContract.findFirst({
        where: { id, ...(ehGlobal(escopo) ? {} : { tenantId: escopo.tenantId }) },
        select: { storageKey: true },
      });
      if (!contrato) throw new NotFoundException('Contrato não encontrado');
      if (!contrato.storageKey) {
        throw new ConflictException(
          'Este contrato não está arquivado. Baixe pelo endpoint de PDF.',
        );
      }
      return contrato.storageKey;
    };

    const chave = ehGlobal(escopo)
      ? await ler(this.privilegiado)
      : await this.prisma.withTenant(escopo.tenantId, ler);

    return { url: await this.storage.urlAssinada(chave), expiraEmMinutos: 10 };
  }

  /** Registra o aceite com a trilha de evidências. */
  async assinar(
    escopo: Escopo,
    id: string,
    dados: {
      role: 'customer' | 'dealer';
      signerName: string;
      signerDocument?: string;
      signerUserId?: string;
      ip?: string;
      userAgent?: string;
    },
  ) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const contrato = await tx.dealContract.findFirst({ where: { id, tenantId } });
      if (!contrato) throw new NotFoundException('Contrato não encontrado');

      if (contrato.status === 'voided') {
        throw new ConflictException('Contrato anulado não pode ser assinado.');
      }
      if (contrato.status === 'draft') {
        throw new ConflictException('Emita o contrato antes de assiná-lo.');
      }

      try {
        await tx.contractSignature.create({
          data: {
            tenantId,
            contractId: id,
            role: dados.role,
            signerUserId: dados.signerUserId,
            signerName: dados.signerName,
            signerDocument: dados.signerDocument,
            ip: dados.ip,
            userAgent: dados.userAgent,
            // O hash do documento aceito. Se o contrato for reemitido, esta
            // assinatura deixa de casar — que é o comportamento correto.
            acceptedHash: contrato.contentHash,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException(`Este contrato já tem assinatura de "${dados.role}".`);
        }
        throw e;
      }

      const assinaturas = await tx.contractSignature.count({ where: { contractId: id } });
      if (assinaturas >= 2 && contrato.status !== 'signed') {
        await tx.dealContract.update({
          where: { id },
          data: { status: 'signed', signedAt: new Date() },
        });
      }

      return tx.dealContract.findFirst({ where: { id }, include: { signatures: true } });
    });
  }

  async anular(escopo: Escopo, id: string, motivo: string) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const contrato = await tx.dealContract.findFirst({ where: { id, tenantId } });
      if (!contrato) throw new NotFoundException('Contrato não encontrado');
      if (contrato.status === 'voided') {
        throw new ConflictException('Contrato já está anulado.');
      }

      return tx.dealContract.update({
        where: { id },
        data: { status: 'voided', voidedAt: new Date(), voidReason: motivo },
      });
    });
  }
}
