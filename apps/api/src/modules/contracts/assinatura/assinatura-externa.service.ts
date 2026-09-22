import {
  BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException,
  ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type ContractSignatureRequest } from '@autoconnect/db';
import {
  aplicarEventoDeAssinatura, ASSINATURA_EXTERNA_VIVAS,
  type AssinaturaExternaStatus, type CabecalhosHttp, type EventoDeAssinatura,
  type ProvedorDeAssinatura, type SignatarioDoEnvelope, type SignatarioRegistrado,
  type SignerRoleValue,
} from '@autoconnect/shared';
import { PrismaService, type ScopedClient } from '../../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../../common/prisma/privileged-prisma.service';
import { DocumentosStorage } from '../../../common/armazenamento/documentos.storage';
import { ehGlobal, type Escopo } from '../../../common/escopo';
import { ContractsService } from '../contracts.service';
import { PROVEDOR_DE_ASSINATURA } from './provedor';
import { ProvedorSimulado, type AcaoSimulada } from './provedor-simulado';
import { sha256Hex } from './hmac';

/** Envio `pending` mais velho que isto foi interrompido (queda entre o provedor e o banco). */
const PENDENTE_ABANDONADO_MS = 10 * 60_000;

export interface ResultadoDoWebhook {
  recebido: true;
  aplicado: boolean;
  motivo?: 'ignorado' | 'envelope-desconhecido' | 'duplicado' | 'sem-efeito';
}

/** O que a tela e a API mostram de uma solicitação. Nada do provedor além dos ids. */
function paraResposta(r: ContractSignatureRequest) {
  return {
    id: r.id,
    status: r.status,
    provider: r.provider,
    signatarios: r.signers as unknown as SignatarioRegistrado[],
    expiresAt: r.expiresAt,
    sentAt: r.sentAt,
    completedAt: r.completedAt,
    canceledAt: r.canceledAt,
    cancelReason: r.cancelReason,
    errorMessage: r.errorMessage,
    signedHash: r.signedHash,
    arquivado: Boolean(r.signedStorageKey),
  };
}

/**
 * Assinatura eletrônica por provedor externo.
 *
 * O fluxo tem três pontas, e em nenhuma delas a ida à rede acontece dentro de
 * transação — pelo mesmo motivo da consulta veicular: o rollback desfaria o
 * registro do que o provedor já fez, e a transação seguraria conexão do pool
 * pelo tempo do provedor.
 *
 *  1. `enviar`: reserva (transação) → cria o envelope (rede) → grava (transação).
 *  2. `receberWebhook`: confere o HMAC → acha a loja → baixa o PDF assinado se
 *     for a conclusão (rede) → aplica o evento (transação).
 *  3. `cancelar`: provedor primeiro, depois o banco — se o provedor falhar,
 *     nada muda aqui e o pedido pode ser repetido.
 */
@Injectable()
export class AssinaturaExternaService {
  private readonly logger = new Logger(AssinaturaExternaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly contratos: ContractsService,
    private readonly storage: DocumentosStorage,
    private readonly config: ConfigService,
    @Inject(PROVEDOR_DE_ASSINATURA)
    private readonly provedor: ProvedorDeAssinatura,
  ) {}

  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new BadRequestException('Selecione uma concessionária para operar a assinatura do contrato.');
    }
    return escopo.tenantId;
  }

  private exigirProvedor(): void {
    if (!this.provedor.disponivel) {
      throw new ServiceUnavailableException(
        'Nenhum provedor de assinatura eletrônica está configurado. ' +
          'Use a assinatura registrada no sistema.',
      );
    }
  }

  get simulado(): boolean {
    return this.provedor instanceof ProvedorSimulado &&
      this.config.get<string>('NODE_ENV') !== 'production';
  }

  /** Capacidade, para a tela decidir se mostra a opção. */
  capacidade() {
    return {
      disponivel: this.provedor.disponivel,
      provedor: this.provedor.disponivel ? this.provedor.nome : null,
      simulado: this.simulado,
    };
  }

  async status(escopo: Escopo, contratoId: string) {
    const tenantId = this.tenantDe(escopo);

    const solicitacoes = await this.prisma.withTenant(tenantId, async (tx) => {
      const contrato = await tx.dealContract.findFirst({
        where: { id: contratoId, tenantId }, select: { id: true },
      });
      if (!contrato) throw new NotFoundException('Contrato não encontrado');

      return tx.contractSignatureRequest.findMany({
        where: { contractId: contratoId, tenantId },
        orderBy: { createdAt: 'desc' },
      });
    });

    return {
      ...this.capacidade(),
      solicitacao: solicitacoes[0] ? paraResposta(solicitacoes[0]) : null,
      historico: solicitacoes.slice(1).map(paraResposta),
    };
  }

  /* ── 1. Envio ──────────────────────────────────────────────── */

  async enviar(escopo: Escopo, contratoId: string, atorId: string, prazoDias: number) {
    const tenantId = this.tenantDe(escopo);
    this.exigirProvedor();

    // O PDF exato da emissão: regerado do snapshot e conferido contra o hash.
    // Não bate, não sai — nem para o provedor.
    const { pdf, contrato } = await this.contratos.baixar(escopo, contratoId);
    const prazo = new Date(Date.now() + prazoDias * 86_400_000);

    // ── Transação 1: validar e reservar ─────────────────────────────
    const reserva = await this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.dealContract.findFirst({
        where: { id: contratoId, tenantId },
        include: {
          _count: { select: { signatures: true } },
          deal: {
            select: {
              status: true,
              buyer: true,
              customer: { select: { email: true } },
              tenant: {
                select: { legalRepName: true, legalRepCpf: true, legalRepEmail: true },
              },
            },
          },
        },
      });
      if (!c) throw new NotFoundException('Contrato não encontrado');

      if (c.status === 'draft') throw new ConflictException('Emita o contrato antes de enviá-lo para assinatura.');
      if (c.status === 'voided') throw new ConflictException('Contrato anulado não pode ser enviado para assinatura.');
      if (c.status === 'signed') throw new ConflictException('Este contrato já está assinado.');
      if (c.deal.status === 'canceled' || c.deal.status === 'rescinded') {
        throw new ConflictException(`Negócio em "${c.deal.status}" não envia contrato para assinatura.`);
      }
      if (c._count.signatures > 0) {
        throw new ConflictException(
          'Este contrato já tem assinatura registrada no sistema. Assinaturas internas ' +
            'e eletrônicas não se misturam — conclua pelo sistema ou emita um novo contrato.',
        );
      }

      const signatarios = this.signatariosDe(c.deal);

      // Envio interrompido entre o provedor e o banco (queda do processo)
      // ficaria `pending` para sempre e travaria o contrato pelo índice único.
      await tx.contractSignatureRequest.updateMany({
        where: {
          contractId: contratoId, tenantId, status: 'pending',
          createdAt: { lt: new Date(Date.now() - PENDENTE_ABANDONADO_MS) },
        },
        data: { status: 'failed', errorMessage: 'Envio interrompido antes da confirmação do provedor.' },
      });

      const viva = await tx.contractSignatureRequest.findFirst({
        where: { contractId: contratoId, tenantId, status: { in: [...ASSINATURA_EXTERNA_VIVAS] } },
        select: { id: true },
      });
      if (viva) {
        throw new ConflictException('Já existe um envio para assinatura em andamento para este contrato.');
      }

      const registrados: SignatarioRegistrado[] = signatarios.map((s) => ({
        ...s, documento: s.documento ?? null, idExterno: null, status: 'enviado',
      }));

      const solicitacao = await tx.contractSignatureRequest.create({
        data: {
          tenantId,
          contractId: contratoId,
          provider: this.provedor.nome,
          status: 'pending',
          contentHash: contrato.contentHash,
          signers: registrados as unknown as Prisma.InputJsonValue,
          expiresAt: prazo,
        },
      });

      return { solicitacao, signatarios, registrados, dealStatus: c.deal.status, dealId: c.dealId };
    }).catch((e: unknown) => {
      // Dois cliques simultâneos passam os dois pela checagem acima; o índice
      // único parcial é quem segura o segundo.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Já existe um envio para assinatura em andamento para este contrato.');
      }
      throw e;
    });

    // ── Fora de transação: o provedor ──────────────────────────────
    let envelope;
    try {
      envelope = await this.provedor.criarEnvelope({
        documento: pdf,
        nomeArquivo: `contrato-${contratoId.slice(0, 8)}.pdf`,
        hash: contrato.contentHash,
        signatarios: reserva.signatarios,
        prazo,
      });
    } catch (e) {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.contractSignatureRequest.update({
          where: { id: reserva.solicitacao.id },
          data: { status: 'failed', errorMessage: (e as Error).message.slice(0, 500) },
        }),
      );
      throw e;
    }

    // ── Transação 2: gravar o que o provedor devolveu ─────────────
    const comIds = reserva.registrados.map((s) => {
      const doProvedor = envelope.signatarios.find((p) => p.papel === s.papel);
      return { ...s, idExterno: doProvedor?.idExterno ?? null, urlAssinatura: doProvedor?.urlAssinatura ?? null };
    });

    try {
      const gravada = await this.prisma.withTenant(tenantId, async (tx) => {
        const r = await tx.contractSignatureRequest.update({
          where: { id: reserva.solicitacao.id },
          data: {
            status: 'sent',
            externalId: envelope.idExterno,
            sentAt: new Date(),
            signers: comIds as unknown as Prisma.InputJsonValue,
          },
        });
        await this.registrarNaLinhaDoTempo(
          tx, tenantId, reserva.dealId, reserva.dealStatus, atorId,
          `Contrato enviado para assinatura eletrônica (${this.provedor.nome})`,
        );
        return r;
      });
      return paraResposta(gravada);
    } catch (e) {
      // O envelope existe no provedor, mas não aqui: cancela lá para não
      // deixar o cliente assinando algo que o sistema não acompanha.
      this.logger.error(`Falha ao gravar envelope ${envelope.idExterno}: ${(e as Error).message}`);
      await this.provedor.cancelar(envelope.idExterno).catch((c: Error) =>
        this.logger.error(`E falhou ao cancelá-lo no provedor: ${c.message}`),
      );
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.contractSignatureRequest.update({
          where: { id: reserva.solicitacao.id },
          data: { status: 'failed', errorMessage: 'Falha ao gravar a resposta do provedor.' },
        }),
      ).catch(() => undefined);
      throw e;
    }
  }

  /**
   * Quem assina, com e-mail. Recusa com 422 nomeando o campo que falta: o
   * pedido está bem formado (não é 400) e o estado não conflita (não é 409) —
   * falta um dado que a pessoa consegue preencher.
   */
  private signatariosDe(deal: {
    buyer: { fullName: string; cpf: string; email: string | null } | null;
    customer: { email: string } | null;
    tenant: { legalRepName: string | null; legalRepCpf: string | null; legalRepEmail: string | null };
  }): SignatarioDoEnvelope[] {
    if (!deal.buyer) {
      throw new UnprocessableEntityException(
        'Preencha a qualificação do comprador antes de enviar para assinatura.',
      );
    }
    // O e-mail da qualificação vence o da conta: quem assina é a parte do
    // contrato, que pode não ser o titular da conta vinculada.
    const emailComprador = deal.buyer.email ?? deal.customer?.email;
    if (!emailComprador) {
      throw new UnprocessableEntityException(
        'Falta o e-mail do comprador: informe-o na qualificação do comprador ' +
          '(é para ele que o convite de assinatura é enviado).',
      );
    }
    if (!deal.tenant.legalRepName) {
      throw new UnprocessableEntityException(
        'Falta o representante legal da concessionária: informe-o em Configurações.',
      );
    }
    if (!deal.tenant.legalRepEmail) {
      throw new UnprocessableEntityException(
        'Falta o e-mail do representante legal: informe-o em Configurações ' +
          '(é quem assina pela loja).',
      );
    }

    return [
      {
        papel: 'dealer',
        nome: deal.tenant.legalRepName,
        email: deal.tenant.legalRepEmail,
        documento: deal.tenant.legalRepCpf ?? undefined,
      },
      {
        papel: 'customer',
        nome: deal.buyer.fullName,
        email: emailComprador,
        documento: deal.buyer.cpf,
      },
    ];
  }

  /* ── 2. Webhook ────────────────────────────────────────────── */

  async receberWebhook(cabecalhos: CabecalhosHttp, corpo: Buffer): Promise<ResultadoDoWebhook> {
    // Lança 401 se o HMAC não conferir — antes de qualquer acesso ao banco.
    const evento = this.provedor.interpretarWebhook(cabecalhos, corpo);
    if (evento.tipo === 'ignorado') return { recebido: true, aplicado: false, motivo: 'ignorado' };

    // ── A única leitura sem contexto de tenant ──────────────────────
    //
    // O webhook chega sem usuário e sem loja: tudo o que ele traz é o id do
    // envelope, cuja autenticidade o HMAC acabou de provar. Descobrir de qual
    // loja é o envelope exige atravessar concessionárias — é o mesmo caso do
    // convite por token, e por isso usa a conexão privilegiada.
    //
    // A travessia é mínima de propósito: devolve só `id` e `tenantId`, por
    // chave única. Tudo o que vem depois — ler, aplicar, fechar o contrato —
    // roda em `withTenant` da loja dona do envelope, sob RLS.
    const alvo = await this.privilegiado.contractSignatureRequest.findUnique({
      where: { provider_externalId: { provider: this.provedor.nome, externalId: evento.idExterno } },
      select: { id: true, tenantId: true },
    });

    if (!alvo) {
      // 2xx e não 404: a entrega é autêntica, então o envelope foi criado com
      // este segredo por outra instalação (ex.: homologação na mesma conta do
      // provedor). Repetir não vai fazê-lo aparecer, e 4xx faria o provedor
      // insistir. O aviso no log é o que torna o caso visível.
      this.logger.warn(`Webhook de assinatura para envelope desconhecido: ${evento.idExterno}`);
      return { recebido: true, aplicado: false, motivo: 'envelope-desconhecido' };
    }

    // ── Fora de transação: baixar o PDF assinado ────────────────────
    let assinado: { hash: string; chave: string | null } | undefined;
    if (evento.tipo === 'concluido') {
      const atual = await this.prisma.withTenant(alvo.tenantId, (tx) =>
        tx.contractSignatureRequest.findFirst({
          where: { id: alvo.id, tenantId: alvo.tenantId }, select: { status: true },
        }),
      );
      // Só baixa se ainda há o que concluir: a repetição da conclusão não
      // paga outra ida ao provedor nem sobe outro arquivo.
      if (atual?.status === 'sent') {
        assinado = await this.guardarAssinado(alvo.tenantId, evento.idExterno);
      }
    }

    const chave = evento.idEvento ?? sha256Hex(corpo);

    return this.prisma.withTenant(alvo.tenantId, (tx) =>
      this.aplicar(tx, alvo.id, alvo.tenantId, chave, evento, corpo, assinado),
    );
  }

  /**
   * O PDF assinado vai para o bucket privado quando há armazenamento; sem ele,
   * fica só o hash — o arquivo continua no provedor e o download o busca lá,
   * conferindo contra este hash.
   */
  private async guardarAssinado(tenantId: string, idExterno: string) {
    // Falha aqui propaga como 5xx: o provedor reentrega a conclusão depois.
    const pdf = Buffer.from(await this.provedor.baixarAssinado(idExterno));
    const hash = sha256Hex(pdf);
    const guardado = await this.storage.guardar(tenantId, `contratos/assinados/${hash}.pdf`, pdf);
    return { hash, chave: guardado?.chave ?? null };
  }

  private async aplicar(
    tx: ScopedClient,
    requestId: string,
    tenantId: string,
    chave: string,
    evento: EventoDeAssinatura,
    corpo: Buffer,
    assinado: { hash: string; chave: string | null } | undefined,
  ): Promise<ResultadoDoWebhook> {
    // Serializa os webhooks do mesmo envelope: dois eventos concorrentes
    // (o último `sign` e o `auto_close` chegam juntos) leriam o mesmo estado e
    // um sobrescreveria o outro.
    await tx.$queryRaw`SELECT id FROM contract_signature_requests WHERE id = ${requestId}::uuid FOR UPDATE`;

    // Idempotência: com o lock, conferir e depois inserir é seguro. Depender
    // da violação de unicidade abortaria a transação inteira no Postgres.
    const repetido = await tx.contractSignatureEvent.findUnique({
      where: { requestId_eventKey: { requestId, eventKey: chave } },
      select: { id: true },
    });
    if (repetido) return { recebido: true, aplicado: false, motivo: 'duplicado' };

    const solicitacao = await tx.contractSignatureRequest.findFirst({
      where: { id: requestId, tenantId },
    });
    if (!solicitacao) throw new NotFoundException('Solicitação de assinatura não encontrada');

    const r = aplicarEventoDeAssinatura(
      {
        status: solicitacao.status as AssinaturaExternaStatus,
        signatarios: solicitacao.signers as unknown as SignatarioRegistrado[],
      },
      evento,
    );

    if (r.concluir && !assinado) {
      // Só acontece se a conclusão chegou em corrida com outra: devolve 503
      // para o provedor reentregar, e na próxima o PDF é baixado.
      throw new ServiceUnavailableException('Conclusão concorrente; reentregue o evento.');
    }

    await tx.contractSignatureEvent.create({
      data: {
        tenantId,
        requestId,
        eventKey: chave,
        kind: evento.tipo,
        applied: r.mudou,
        normalized: {
          ...evento,
          ocorridoEm: evento.ocorridoEm.toISOString(),
        } as unknown as Prisma.InputJsonValue,
        rawBody: corpo.toString('utf8'),
      },
    });

    if (!r.mudou) return { recebido: true, aplicado: false, motivo: 'sem-efeito' };

    const agora = new Date();
    await tx.contractSignatureRequest.update({
      where: { id: requestId },
      data: {
        status: r.estado.status,
        signers: r.estado.signatarios as unknown as Prisma.InputJsonValue,
        ...(r.concluir && assinado
          ? { completedAt: agora, signedHash: assinado.hash, signedStorageKey: assinado.chave }
          : {}),
        ...(r.estado.status === 'canceled'
          ? { canceledAt: agora, cancelReason: 'Cancelado no provedor' }
          : {}),
      },
    });

    const contrato = await tx.dealContract.findFirst({
      where: { id: solicitacao.contractId, tenantId },
      include: { deal: { select: { status: true } }, signatures: { select: { role: true } } },
    });
    if (!contrato) return { recebido: true, aplicado: true };

    if (r.concluir) {
      // Contrato que saiu de `issued` enquanto o envelope rodava (anulado
      // aqui) não é reaberto pela conclusão de lá.
      if (contrato.status === 'issued') {
        const jaAssinados = new Set<SignerRoleValue>(contrato.signatures.map((s) => s.role));
        await this.contratos.gravarAssinaturas(
          tx,
          contrato,
          r.estado.signatarios
            .filter((s) => !jaAssinados.has(s.papel))
            .map((s) => ({
              role: s.papel,
              signerName: s.nome,
              signerDocument: s.documento ?? null,
              requestId,
              externalSignerId: s.idExterno,
              signedAt: s.ocorridoEm ? new Date(s.ocorridoEm) : agora,
            })),
        );
      }
    }

    const frase: Partial<Record<AssinaturaExternaStatus, string>> = {
      completed: `Contrato assinado eletronicamente (${solicitacao.provider})`,
      refused: 'Assinatura eletrônica recusada por um dos signatários',
      expired: 'Prazo da assinatura eletrônica expirou',
      canceled: 'Assinatura eletrônica cancelada no provedor',
    };
    const razao = r.estado.status !== solicitacao.status ? frase[r.estado.status] : undefined;
    if (razao) {
      await this.registrarNaLinhaDoTempo(tx, tenantId, contrato.dealId, contrato.deal.status, null, razao);
    }

    return { recebido: true, aplicado: true };
  }

  /* ── 3. Cancelamento ───────────────────────────────────────── */

  async cancelar(escopo: Escopo, contratoId: string, atorId: string, motivo?: string) {
    const tenantId = this.tenantDe(escopo);

    const viva = await this.prisma.withTenant(tenantId, async (tx) => {
      const contrato = await tx.dealContract.findFirst({
        where: { id: contratoId, tenantId }, select: { id: true },
      });
      if (!contrato) throw new NotFoundException('Contrato não encontrado');

      return tx.contractSignatureRequest.findFirst({
        where: { contractId: contratoId, tenantId, status: { in: [...ASSINATURA_EXTERNA_VIVAS] } },
      });
    });
    if (!viva) throw new ConflictException('Não há envio para assinatura em andamento neste contrato.');

    // Provedor primeiro: se ele falhar, nada muda aqui e o pedido pode ser
    // repetido. O contrário deixaria o envelope aberto lá com o sistema
    // dizendo "cancelado".
    if (viva.externalId) await this.provedor.cancelar(viva.externalId);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const { count } = await tx.contractSignatureRequest.updateMany({
        where: { id: viva.id, status: { in: [...ASSINATURA_EXTERNA_VIVAS] } },
        data: {
          status: 'canceled',
          canceledAt: new Date(),
          cancelReason: motivo ?? 'Cancelado pela concessionária',
        },
      });
      if (count === 0) {
        // Um webhook fechou a solicitação entre a leitura e aqui.
        throw new ConflictException('O envio foi encerrado pelo provedor antes do cancelamento.');
      }

      const contrato = await tx.dealContract.findFirst({
        where: { id: contratoId, tenantId }, include: { deal: { select: { status: true } } },
      });
      if (contrato) {
        await this.registrarNaLinhaDoTempo(
          tx, tenantId, contrato.dealId, contrato.deal.status, atorId,
          `Envio para assinatura eletrônica cancelado${motivo ? `: ${motivo}` : ''}`,
        );
      }

      const r = await tx.contractSignatureRequest.findFirst({ where: { id: viva.id } });
      return paraResposta(r!);
    });
  }

  /* ── PDF assinado ──────────────────────────────────────────── */

  /**
   * O PDF devolvido pelo provedor, conferido contra o hash gravado na
   * conclusão — do bucket privado quando arquivado, do provedor quando não.
   * Mesma regra do contrato emitido: não bate, não sai.
   */
  async pdfAssinado(escopo: Escopo, contratoId: string) {
    const tenantId = this.tenantDe(escopo);

    const concluida = await this.prisma.withTenant(tenantId, async (tx) => {
      const contrato = await tx.dealContract.findFirst({
        where: { id: contratoId, tenantId }, select: { id: true },
      });
      if (!contrato) throw new NotFoundException('Contrato não encontrado');

      return tx.contractSignatureRequest.findFirst({
        where: { contractId: contratoId, tenantId, status: 'completed' },
        orderBy: { completedAt: 'desc' },
      });
    });
    if (!concluida?.signedHash || !concluida.externalId) {
      throw new NotFoundException('Este contrato não tem PDF assinado eletronicamente.');
    }

    let pdf = concluida.signedStorageKey
      ? await this.storage.baixar(concluida.signedStorageKey)
      : null;
    if (!pdf) {
      if (concluida.provider !== this.provedor.nome) {
        throw new ServiceUnavailableException(
          `O PDF assinado não foi arquivado e o provedor "${concluida.provider}" não está configurado.`,
        );
      }
      pdf = Buffer.from(await this.provedor.baixarAssinado(concluida.externalId));
    }

    if (sha256Hex(pdf) !== concluida.signedHash) {
      throw new ConflictException(
        'O PDF assinado não confere com o hash registrado na conclusão — não será entregue.',
      );
    }
    return { pdf, solicitacao: concluida };
  }

  /* ── Simulação (só fora de produção) ───────────────────────── */

  /**
   * Faz o que o signatário faria no provedor simulado e entrega os webhooks
   * resultantes pelo **mesmo** caminho da entrega real — HMAC, lookup,
   * idempotência e conclusão. Não há atalho que pule a conferência.
   */
  async simular(escopo: Escopo, contratoId: string, acao: AcaoSimulada, papel?: SignerRoleValue) {
    const provedor = this.provedor;
    if (!(provedor instanceof ProvedorSimulado) || !this.simulado) {
      // 404, e não 403: fora do modo simulado a rota não existe.
      throw new NotFoundException();
    }
    const tenantId = this.tenantDe(escopo);

    const viva = await this.prisma.withTenant(tenantId, (tx) =>
      tx.contractSignatureRequest.findFirst({
        where: { contractId: contratoId, tenantId, status: 'sent' },
        select: { externalId: true },
      }),
    );
    if (!viva?.externalId) throw new ConflictException('Não há envio aguardando assinatura neste contrato.');

    for (const entrega of provedor.simular(viva.externalId, acao, papel)) {
      await this.receberWebhook(entrega.cabecalhos, entrega.corpo);
    }
    return this.status(escopo, contratoId);
  }

  private registrarNaLinhaDoTempo(
    tx: ScopedClient,
    tenantId: string,
    dealId: string,
    status: Prisma.DealStatusEventCreateManyInput['fromStatus'],
    atorId: string | null,
    razao: string,
  ) {
    // Mesmo formato da emissão: o status não muda, o evento fica na timeline.
    return tx.dealStatusEvent.create({
      data: { tenantId, dealId, fromStatus: status, toStatus: status, actorUserId: atorId, reason: razao },
    });
  }
}
