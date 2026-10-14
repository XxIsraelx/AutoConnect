import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import {
  cfopValido, DEFINICAO_DAS_OPERACOES, montarNota, OPERACOES_FISCAIS, ROTULO_DA_DIRECAO,
  operacaoDeSaidaDoNegocio, situacaoTributariaValida, usaCsosn,
  type ConfirmacaoDoContadorInput, type DadosFiscaisDoVeiculoInput, type EnderecoFiscal,
  type OperacaoFiscal, type PerfilDeOperacaoInput, type PerfilFiscalInput,
} from '@autoconnect/shared';

/** Quem mexe no fiscal. O vendedor vê o estado da nota, não o perfil da loja. */
export const PAPEIS_DO_FISCAL = ['manager', 'tenant_admin', 'super_admin'];

interface QuemPede { id: string }

/**
 * Perfil fiscal da loja e a prévia da nota — fase N1 do plano fiscal.
 *
 * O que este serviço **não** faz: emitir. A emissão é N2, atrás de um provedor.
 * Aqui a loja diz como fatura, e o sistema diz, para um negócio, o que falta
 * para a nota sair — com a mesma regra pura (`montarNota`) que a emissão vai
 * usar, para a prévia e a nota nunca discordarem.
 *
 * **A confirmação do contador é apagada a cada mudança no perfil.** Ele
 * confirmou o regime e as operações que viu; um CFOP trocado depois é um perfil
 * que ninguém conferiu, e produção só emite com perfil conferido.
 */
@Injectable()
export class PerfilFiscalService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new ForbiddenException('Selecione uma concessionária para ver o perfil fiscal dela.');
    }
    return escopo.tenantId;
  }

  private operacaoDaRota(bruta: string): OperacaoFiscal {
    if (!(OPERACOES_FISCAIS as readonly string[]).includes(bruta)) {
      throw new NotFoundException(`Operação fiscal desconhecida: ${bruta}.`);
    }
    return bruta as OperacaoFiscal;
  }

  /** Apaga a confirmação, se houver, e deixa o porquê na auditoria. */
  private async desconfirmar(tx: ScopedClient, tenantId: string, quem: QuemPede, motivo: string) {
    const { count } = await tx.fiscalSettings.updateMany({
      where: { tenantId, contadorConfirmouEm: { not: null } },
      data: { contadorConfirmouEm: null, contadorConfirmouPor: null, contadorNome: null, contadorCrc: null },
    });
    if (count > 0) {
      await tx.auditLog.create({
        data: {
          tenantId, actorUserId: quem.id, action: 'fiscal_confirmacao_apagada',
          entityType: 'fiscal_settings', entityId: tenantId, diff: { motivo },
        },
      });
    }
  }

  /* ── Perfil ─────────────────────────────────────────────── */

  async obter(escopo: Escopo) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const [cfg, perfis, loja, matriz] = await Promise.all([
        tx.fiscalSettings.findUnique({ where: { tenantId } }),
        tx.fiscalOperationProfile.findMany({ where: { tenantId } }),
        tx.tenant.findUnique({
          where: { id: tenantId },
          select: { taxId: true, stateRegistration: true, legalName: true },
        }),
        tx.dealershipBranch.findFirst({
          where: { tenantId, isHeadquarters: true },
          select: { state: true },
        }),
      ]);

      return {
        configuracao: cfg && {
          regime: cfg.regime,
          serie: cfg.serie,
          ambiente: cfg.ambiente,
          usaCsosn: usaCsosn(cfg.regime),
          contadorConfirmouEm: cfg.contadorConfirmouEm?.toISOString() ?? null,
          contadorNome: cfg.contadorNome,
          contadorCrc: cfg.contadorCrc,
        },
        loja: {
          cnpj: loja?.taxId ?? null,
          inscricaoEstadual: loja?.stateRegistration ?? null,
          razaoSocial: loja?.legalName ?? null,
          ufDaMatriz: matriz?.state ?? null,
        },
        operacoes: OPERACOES_FISCAIS.map((operacao) => {
          const def = DEFINICAO_DAS_OPERACOES[operacao];
          const p = perfis.find((x) => x.operation === operacao);
          return {
            operacao,
            rotulo: def.rotulo,
            direcao: def.direcao,
            quando: def.quando,
            sugestao: {
              natureza: def.naturezaSugerida,
              cfopInterno: def.cfopInternoSugerido,
              cfopInterestadual: def.cfopInterestadualSugerido,
            },
            perfil: p
              ? {
                natureza: p.natureza,
                cfopInterno: p.cfopInterno,
                cfopInterestadual: p.cfopInterestadual,
                situacaoTributaria: p.situacaoTributaria,
                informacoesComplementares: p.informacoesComplementares,
              }
              : null,
          };
        }),
      };
    });
  }

  async salvarConfiguracao(escopo: Escopo, quem: QuemPede, dados: PerfilFiscalInput) {
    const tenantId = this.tenantDe(escopo);

    await this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const antes = await tx.fiscalSettings.findUnique({ where: { tenantId } });

      // Trocar de regime troca o tipo de situação tributária (CST × CSOSN):
      // as operações já preenchidas passam a estar erradas, e é isso que a
      // prévia vai dizer. A confirmação do contador não sobrevive à troca.
      if (antes && antes.regime !== dados.regime) {
        await this.desconfirmar(tx, tenantId, quem, `regime ${antes.regime} → ${dados.regime}`);
      }

      await tx.fiscalSettings.upsert({
        where: { tenantId },
        create: { tenantId, ...dados },
        update: dados,
      });

      await tx.auditLog.create({
        data: {
          tenantId, actorUserId: quem.id, action: 'fiscal_configuracao_salva',
          entityType: 'fiscal_settings', entityId: tenantId,
          diff: { antes: antes && { regime: antes.regime, serie: antes.serie, ambiente: antes.ambiente }, depois: dados },
        },
      });
    });

    return this.obter(escopo);
  }

  /**
   * Cria, com as sugestões, as operações que a loja ainda não tem.
   *
   * Idempotente — o lojista clica duas vezes — e **sem situação tributária**:
   * ela é do contador, e uma sugestão ali viraria padrão que ninguém confere.
   */
  async semearOperacoes(escopo: Escopo, quem: QuemPede) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const { count } = await tx.fiscalOperationProfile.createMany({
        data: OPERACOES_FISCAIS.map((operation) => {
          const def = DEFINICAO_DAS_OPERACOES[operation];
          return {
            tenantId,
            operation,
            natureza: def.naturezaSugerida,
            cfopInterno: def.cfopInternoSugerido,
            cfopInterestadual: def.cfopInterestadualSugerido,
          };
        }),
        skipDuplicates: true,
      });
      if (count > 0) {
        await this.desconfirmar(tx, tenantId, quem, `${count} operação(ões) criada(s) com as sugestões`);
      }
      return { criadas: count };
    });
  }

  async salvarOperacao(escopo: Escopo, quem: QuemPede, bruta: string, dados: PerfilDeOperacaoInput) {
    const tenantId = this.tenantDe(escopo);
    const operacao = this.operacaoDaRota(bruta);
    const def = DEFINICAO_DAS_OPERACOES[operacao];
    const direcao = ROTULO_DA_DIRECAO[def.direcao];

    // Erros de campo no formato do `ZodFilter`, para a tela marcar o campo certo.
    const erros: { field: string; message: string }[] = [];
    if (!cfopValido(dados.cfopInterno, def.direcao, 'interna')) {
      erros.push({
        field: 'cfopInterno',
        message: `Numa ${direcao} interna o CFOP começa com ${def.direcao === 'entrada' ? '1' : '5'}.`,
      });
    }
    if (!cfopValido(dados.cfopInterestadual, def.direcao, 'interestadual')) {
      erros.push({
        field: 'cfopInterestadual',
        message: `Numa ${direcao} interestadual o CFOP começa com ${def.direcao === 'entrada' ? '2' : '6'}.`,
      });
    }

    await this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const cfg = await tx.fiscalSettings.findUnique({ where: { tenantId }, select: { regime: true } });
      if (!cfg) {
        throw new ConflictException('Defina o regime tributário da loja antes das operações.');
      }
      if (dados.situacaoTributaria && !situacaoTributariaValida(cfg.regime, dados.situacaoTributaria)) {
        erros.push({
          field: 'situacaoTributaria',
          message: usaCsosn(cfg.regime)
            ? 'No Simples Nacional a situação tributária é um CSOSN, de 3 dígitos (ex.: 102).'
            : 'Neste regime a situação tributária é um CST, de 2 dígitos (ex.: 00).',
        });
      }
      if (erros.length > 0) {
        throw new BadRequestException({ message: 'Perfil da operação inválido', errors: erros });
      }

      const antes = await tx.fiscalOperationProfile.findUnique({
        where: { tenantId_operation: { tenantId, operation: operacao } },
      });
      const mudou = !antes
        || antes.natureza !== dados.natureza
        || antes.cfopInterno !== dados.cfopInterno
        || antes.cfopInterestadual !== dados.cfopInterestadual
        || antes.situacaoTributaria !== dados.situacaoTributaria
        || antes.informacoesComplementares !== dados.informacoesComplementares;
      if (!mudou) return;

      await tx.fiscalOperationProfile.upsert({
        where: { tenantId_operation: { tenantId, operation: operacao } },
        create: { tenantId, operation: operacao, ...dados },
        update: dados,
      });
      await this.desconfirmar(tx, tenantId, quem, `operação ${operacao} alterada`);
      await tx.auditLog.create({
        data: {
          tenantId, actorUserId: quem.id, action: 'fiscal_operacao_salva',
          entityType: 'fiscal_operation_profile', entityId: antes?.id ?? null,
          diff: {
            operacao,
            antes: antes && {
              natureza: antes.natureza, cfopInterno: antes.cfopInterno,
              cfopInterestadual: antes.cfopInterestadual, situacaoTributaria: antes.situacaoTributaria,
            },
            depois: dados,
          },
        },
      });
    });

    return this.obter(escopo);
  }

  /**
   * A loja registra que o contador conferiu o perfil.
   *
   * Recusa perfil incompleto: confirmar operação sem situação tributária seria
   * o contador "aprovando" o campo que ninguém preencheu.
   */
  async confirmarPeloContador(escopo: Escopo, quem: QuemPede, dados: ConfirmacaoDoContadorInput) {
    const tenantId = this.tenantDe(escopo);

    await this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const [cfg, perfis] = await Promise.all([
        tx.fiscalSettings.findUnique({ where: { tenantId } }),
        tx.fiscalOperationProfile.findMany({ where: { tenantId } }),
      ]);
      if (!cfg) throw new ConflictException('Defina o regime tributário da loja antes.');
      if (perfis.length === 0) {
        throw new UnprocessableEntityException('Configure ao menos uma operação antes de levar o perfil ao contador.');
      }
      const incompletas = perfis
        .filter((p) => !p.situacaoTributaria || !situacaoTributariaValida(cfg.regime, p.situacaoTributaria))
        .map((p) => DEFINICAO_DAS_OPERACOES[p.operation].rotulo);
      if (incompletas.length > 0) {
        throw new UnprocessableEntityException(
          `Falta a situação tributária (válida para o regime) em: ${incompletas.join(', ')}.`,
        );
      }

      const agora = new Date();
      await tx.fiscalSettings.update({
        where: { tenantId },
        data: {
          contadorConfirmouEm: agora,
          contadorConfirmouPor: quem.id,
          contadorNome: dados.nomeDoContador,
          contadorCrc: dados.crc || null,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId, actorUserId: quem.id, action: 'fiscal_confirmado_pelo_contador',
          entityType: 'fiscal_settings', entityId: tenantId,
          diff: {
            contador: dados.nomeDoContador, crc: dados.crc ?? null, regime: cfg.regime,
            operacoes: perfis.map((p) => ({
              operacao: p.operation, cfopInterno: p.cfopInterno,
              cfopInterestadual: p.cfopInterestadual, situacaoTributaria: p.situacaoTributaria,
            })),
          },
        },
      });
    });

    return this.obter(escopo);
  }

  /* ── Dados fiscais do veículo ───────────────────────────── */

  async dadosDoVeiculo(escopo: Escopo, vehicleId: string) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const veiculo = await tx.vehicle.findFirst({
        where: { id: vehicleId, tenantId },
        select: { id: true, fiscalDetails: true },
      });
      if (!veiculo) throw new NotFoundException('Veículo não encontrado.');
      const d = veiculo.fiscalDetails;
      return { ncm: d?.ncm ?? null, renavam: d?.renavam ?? null, origem: d?.origem ?? 0 };
    });
  }

  async salvarDadosDoVeiculo(escopo: Escopo, quem: QuemPede, vehicleId: string, dados: DadosFiscaisDoVeiculoInput) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const veiculo = await tx.vehicle.findFirst({ where: { id: vehicleId, tenantId }, select: { id: true } });
      if (!veiculo) throw new NotFoundException('Veículo não encontrado.');

      const salvo = await tx.vehicleFiscalDetails.upsert({
        where: { vehicleId },
        create: { vehicleId, tenantId, ...dados },
        update: dados,
      });
      await tx.auditLog.create({
        data: {
          tenantId, actorUserId: quem.id, action: 'fiscal_dados_do_veiculo_salvos',
          entityType: 'vehicle', entityId: vehicleId, diff: dados,
        },
      });
      return { ncm: salvo.ncm, renavam: salvo.renavam, origem: salvo.origem };
    });
  }

  /* ── Prévia da nota de um negócio ───────────────────────── */

  /**
   * A nota que o negócio geraria hoje, ou tudo o que falta para ela sair.
   *
   * Só leitura: lê o negócio, o comprador e o veículo, e não muda nenhum deles
   * — a trilha fiscal não altera o comportamento de `deals`.
   */
  async previaDoNegocio(escopo: Escopo, dealId: string, presencial: boolean) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const negocio = await tx.deal.findFirst({
        where: { id: dealId, tenantId },
        select: {
          saleValue: true,
          buyer: true,
          vehicle: {
            select: {
              vin: true, licensePlate: true, versionName: true, yearMake: true, yearModel: true,
              color: true, mileageKm: true,
              brand: { select: { name: true } },
              model: { select: { name: true } },
              acquisition: { select: { origin: true } },
              fiscalDetails: true,
            },
          },
        },
      });
      if (!negocio) throw new NotFoundException('Negócio não encontrado.');

      const operacao = operacaoDeSaidaDoNegocio(negocio.vehicle.acquisition?.origin ?? null);
      const [cfg, perfil, loja, matriz] = await Promise.all([
        tx.fiscalSettings.findUnique({ where: { tenantId } }),
        tx.fiscalOperationProfile.findUnique({ where: { tenantId_operation: { tenantId, operation: operacao } } }),
        tx.tenant.findUnique({
          where: { id: tenantId },
          select: { taxId: true, stateRegistration: true, legalName: true, tradeName: true },
        }),
        tx.dealershipBranch.findFirst({ where: { tenantId, isHeadquarters: true } }),
      ]);

      const enderecoDaMatriz: EnderecoFiscal | null = matriz && {
        logradouro: matriz.addressLine, numero: matriz.addressNumber, complemento: matriz.complement,
        bairro: matriz.neighborhood, cidade: matriz.city, uf: matriz.state, cep: matriz.postalCode,
      };
      const b = negocio.buyer;
      const v = negocio.vehicle;

      const { nota, faltas } = montarNota({
        operacao,
        configuracao: cfg && {
          regime: cfg.regime, serie: cfg.serie, ambiente: cfg.ambiente,
          contadorConfirmouEm: cfg.contadorConfirmouEm?.toISOString() ?? null,
        },
        perfil,
        emitente: {
          cnpj: loja?.taxId ?? null,
          inscricaoEstadual: loja?.stateRegistration ?? null,
          razaoSocial: loja?.legalName ?? '',
          nomeFantasia: loja?.tradeName ?? '',
          endereco: enderecoDaMatriz,
        },
        contraparte: {
          nome: b?.fullName ?? null,
          documento: b?.cpf ?? null,
          email: b?.email ?? null,
          endereco: b && {
            logradouro: b.addressLine, numero: b.addressNumber, bairro: b.neighborhood,
            cidade: b.city, uf: b.state, cep: b.postalCode,
          },
        },
        veiculo: {
          marca: v.brand.name, modelo: v.model.name, versao: v.versionName,
          anoFabricacao: v.yearMake, anoModelo: v.yearModel, cor: v.color, quilometragem: v.mileageKm,
          chassi: v.vin, placa: v.licensePlate,
          renavam: v.fiscalDetails?.renavam ?? null, ncm: v.fiscalDetails?.ncm ?? null,
          origem: v.fiscalDetails?.origem ?? 0,
        },
        valor: negocio.saleValue.toFixed(2),
        presencial,
      });

      return { operacao, rotulo: DEFINICAO_DAS_OPERACOES[operacao].rotulo, nota, faltas };
    });
  }
}
