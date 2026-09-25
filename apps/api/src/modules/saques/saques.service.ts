import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@autoconnect/db';
import {
  MOTIVO, VALIDADE_PADRAO_DA_AUTORIZACAO_MIN,
  decidirSaque, deCentavos, emCentavos, expiraEm, situacaoDaAutorizacao,
  type AutorizacaoDeSaque, type CabecalhosDeCobranca, type ModoDeValor,
  type PedidoDeSaque, type TipoDeSaque, type VeredictoDeSaque,
} from '@autoconnect/shared';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { CABECALHO_TOKEN_ASAAS, sha256Hex, tokenConfere } from '../cobranca/token-webhook';
import {
  PROVEDOR_DE_SAQUE, TIPO_NAO_AUTENTICADO, aprovado, interpretarPedidoDeSaque, recusado,
  type RespostaDeValidacaoDeSaque,
} from './payload-asaas';

/** Recorte do corpo cru guardado na trilha — o mesmo teto do webhook de cobrança. */
const LIMITE_DO_CORPO = 20_000;

/** Quantas decisões o painel mostra. É trilha, não relatório. */
const DECISOES_NO_PAINEL = 50;

export interface NovaAutorizacao {
  tipo: TipoDeSaque;
  modo: ModoDeValor;
  /** String decimal, como todo dinheiro que atravessa a fronteira HTTP. */
  valor: string;
  validadeMinutos: number;
  observacao?: string;
}

/**
 * Validação de saque na conta da plataforma no gateway.
 *
 * ## O que isto é
 *
 * A Asaas passou a exigir, para liberar a chave de API de produção, que a
 * conta ative a "validação de saque via webhook": a cada transferência, conta
 * paga, Pix ou recarga solicitados, ela pergunta à nossa aplicação se pode. A
 * resposta é a última palavra — sem `APPROVED`, a operação é cancelada.
 *
 * É o freio de mão do dinheiro do dono da plataforma. Se a `ASAAS_API_KEY`
 * vazar, quem a roubou pede um saque e é aqui que ele morre.
 *
 * ## As quatro regras, e por quê
 *
 * 1. **Recusa por padrão.** Aprovar por estrutura válida do payload anularia o
 *    mecanismo: quem roubou a chave manda payload válido por definição, porque
 *    quem monta o payload é a própria Asaas. A decisão só pode vir de algo que
 *    o ladrão não tem — uma autorização criada **antes**, no nosso painel.
 * 2. **Uso único, tipo e valor casados, prazo curto.** Uma autorização que
 *    sobra é uma senha esquecida em cima da mesa.
 * 3. **Toda decisão é gravada**, com o corpo cru, antes de a resposta sair.
 *    Auditoria de dinheiro que só existe quando dá certo não é auditoria.
 * 4. **Nunca 500, nunca demorar.** Erro interno vira `REFUSED` com motivo: a
 *    Asaas cancela a operação depois de três falhas, e uma exceção vazando
 *    daqui gastaria as três sem deixar registro nenhum.
 *
 * ## Por que a conexão privilegiada
 *
 * `withdrawal_authorizations` e `withdrawal_decisions` não têm `tenant_id`: não
 * são de loja nenhuma. A policy de RLS delas nega tudo ao papel da aplicação, e
 * quem alcança é só a conexão dona das tabelas. A travessia é visível no nome
 * (`this.privilegiado.`), como manda `isolamento.spec.ts`.
 */
@Injectable()
export class SaquesService {
  private readonly logger = new Logger(SaquesService.name);
  private readonly token: string;

  constructor(
    private readonly privilegiado: PrivilegedPrismaService,
    config: ConfigService,
  ) {
    this.token = config.get<string>('ASAAS_SAQUE_TOKEN')?.trim() ?? '';

    if (!this.token) {
      // Alto e no boot: sem token, toda operação de saque da conta é recusada,
      // inclusive as do dono. É um estado seguro, mas não é um estado silencioso.
      this.logger.error(
        'ASAAS_SAQUE_TOKEN ausente: a validação de saque vai RECUSAR todas as operações. ' +
          'Cadastre o mesmo token em Asaas › Integrações › Mecanismos de segurança.',
      );
    }
  }

  /** A tela do super admin precisa saber se o mecanismo está de pé. */
  get configurado(): boolean {
    return this.token.length > 0;
  }

  /* ── 1. O webhook ──────────────────────────────────────────── */

  /**
   * Decide e responde. **Não lança**: o retorno é sempre uma das duas formas
   * que a Asaas aceita.
   */
  async validar(
    cabecalhos: CabecalhosDeCobranca,
    corpo: Buffer,
  ): Promise<RespostaDeValidacaoDeSaque> {
    try {
      return await this.decidir(cabecalhos, corpo);
    } catch (err) {
      // Banco fora, coluna nova faltando, o que for: recusa com motivo. Um 500
      // aqui contaria como uma das três falhas que cancelam a operação, e ainda
      // deixaria a resposta sem forma reconhecível.
      this.logger.error(`Falha ao validar saque — recusado por segurança: ${err}`);
      return recusado(MOTIVO.erroInterno);
    }
  }

  private async decidir(
    cabecalhos: CabecalhosDeCobranca,
    corpo: Buffer,
  ): Promise<RespostaDeValidacaoDeSaque> {
    const cru = corpo.toString('utf8').slice(0, LIMITE_DO_CORPO);
    const chaveDoCorpo = `sha256:${sha256Hex(corpo)}`;

    // ── Autenticidade, antes de qualquer leitura do corpo ────────────
    if (!this.configurado) {
      this.logger.error('Validação de saque recebida sem ASAAS_SAQUE_TOKEN configurado: recusada.');
      return this.gravarSimples({
        operationType: TIPO_NAO_AUTENTICADO, operationKey: chaveDoCorpo,
        reason: MOTIVO.semToken, tokenOk: false, rawBody: cru,
      });
    }

    if (!tokenConfere(cabecalhos, CABECALHO_TOKEN_ASAAS, this.token)) {
      this.logger.warn('Validação de saque com token que não confere: recusada.');
      return this.gravarSimples({
        operationType: TIPO_NAO_AUTENTICADO, operationKey: chaveDoCorpo,
        reason: MOTIVO.tokenInvalido, tokenOk: false, rawBody: cru,
      });
    }

    // ── O corpo ──────────────────────────────────────────────────────
    const leitura = interpretarPedidoDeSaque(corpo);
    if (!leitura.ok) {
      this.logger.warn(`Validação de saque não interpretada (${leitura.tipoBruto}): recusada.`);
      return this.gravarSimples({
        operationType: leitura.tipoBruto, operationKey: chaveDoCorpo,
        reason: leitura.motivo, tokenOk: true, rawBody: cru,
      });
    }

    return this.casarComAutorizacao(leitura.pedido, cru);
  }

  /**
   * Casa o pedido com a autorização prévia, consome e grava — **numa
   * transação só**.
   *
   * O consumo usa `updateMany` com `used_at IS NULL` no `where`: é o `UPDATE …
   * WHERE` que dois pedidos simultâneos disputam no banco, e só um vence.
   * Conferir em memória e gravar depois deixaria a janela em que os dois leem
   * "não usada" e os dois aprovam — e é justamente aqui que uma corrida custa
   * dinheiro.
   *
   * A gravação da decisão dentro da mesma transação também é o que torna a
   * reentrega idempotente: a violação do único `(provider, tipo, id da
   * operação)` desfaz o consumo junto, e a resposta passa a ser a decisão
   * **já tomada** para aquela operação. Sem isso, a segunda entrega da mesma
   * operação (a Asaas reentrega quando a nossa resposta não chega) encontraria
   * a autorização gasta e recusaria um saque que já havíamos aprovado.
   */
  private async casarComAutorizacao(
    pedido: PedidoDeSaque,
    cru: string,
  ): Promise<RespostaDeValidacaoDeSaque> {
    const agora = new Date();

    try {
      const veredicto = await this.privilegiado.$transaction(async (tx) => {
        const candidatas = await tx.withdrawalAuthorization.findMany({
          where: {
            provider: PROVEDOR_DE_SAQUE,
            operationType: pedido.tipo,
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: agora },
          },
        });

        let v: VeredictoDeSaque = decidirSaque(pedido, candidatas.map(paraDominio), agora);

        if (v.aprovado && v.autorizacaoId) {
          const consumo = await tx.withdrawalAuthorization.updateMany({
            where: { id: v.autorizacaoId, usedAt: null, revokedAt: null },
            data: { usedAt: agora },
          });
          if (consumo.count !== 1) {
            v = { aprovado: false, motivo: MOTIVO.jaConsumida, autorizacaoId: null };
          }
        }

        await tx.withdrawalDecision.create({
          data: {
            provider: PROVEDOR_DE_SAQUE,
            operationType: pedido.tipo,
            operationKey: pedido.idOperacao,
            amount: new Prisma.Decimal(deCentavos(pedido.valorCentavos)),
            decision: v.aprovado ? 'APPROVED' : 'REFUSED',
            reason: v.motivo,
            authorizationId: v.autorizacaoId,
            tokenOk: true,
            rawBody: cru,
          },
        });

        return v;
      });

      if (veredicto.aprovado) {
        this.logger.warn(
          `Saque APROVADO: ${pedido.tipo} ${pedido.idOperacao} ` +
            `(R$ ${deCentavos(pedido.valorCentavos)}) pela autorização ${veredicto.autorizacaoId}.`,
        );
        return aprovado();
      }
      this.logger.warn(`Saque RECUSADO: ${pedido.tipo} ${pedido.idOperacao} — ${veredicto.motivo}`);
      return recusado(veredicto.motivo ?? MOTIVO.semAutorizacao);
    } catch (err) {
      if (ehDuplicado(err)) {
        return this.repetirDecisao(pedido.tipo, pedido.idOperacao);
      }
      throw err;
    }
  }

  /** Grava uma recusa que não chegou a consultar autorização nenhuma. */
  private async gravarSimples(dados: {
    operationType: string;
    operationKey: string;
    reason: string;
    tokenOk: boolean;
    rawBody: string;
  }): Promise<RespostaDeValidacaoDeSaque> {
    try {
      await this.privilegiado.withdrawalDecision.create({
        data: { provider: PROVEDOR_DE_SAQUE, decision: 'REFUSED', ...dados },
      });
    } catch (err) {
      if (!ehDuplicado(err)) throw err;
      // Mesmo corpo de novo: a decisão já está registrada, e ela é a mesma.
    }
    return recusado(dados.reason);
  }

  /**
   * A decisão que já foi tomada para esta operação, repetida palavra por
   * palavra. Se a linha sumiu entre a violação e a leitura (só acontece se
   * alguém apagar trilha de auditoria à mão), recusa — nunca o contrário.
   */
  private async repetirDecisao(
    operationType: string,
    operationKey: string,
  ): Promise<RespostaDeValidacaoDeSaque> {
    const anterior = await this.privilegiado.withdrawalDecision.findUnique({
      where: {
        provider_operationType_operationKey: {
          provider: PROVEDOR_DE_SAQUE, operationType, operationKey,
        },
      },
      select: { decision: true, reason: true },
    });

    if (anterior?.decision === 'APPROVED') {
      this.logger.warn(`Saque ${operationType} ${operationKey} reentregue: repetindo APPROVED.`);
      return aprovado();
    }
    return recusado(anterior?.reason ?? MOTIVO.semAutorizacao);
  }

  /* ── 2. O painel do super admin ────────────────────────────── */

  async painel() {
    const [autorizacoes, decisoes] = await Promise.all([
      this.privilegiado.withdrawalAuthorization.findMany({
        where: { provider: PROVEDOR_DE_SAQUE },
        orderBy: { createdAt: 'desc' },
        take: DECISOES_NO_PAINEL,
      }),
      this.privilegiado.withdrawalDecision.findMany({
        where: { provider: PROVEDOR_DE_SAQUE },
        orderBy: { createdAt: 'desc' },
        take: DECISOES_NO_PAINEL,
      }),
    ]);

    const agora = new Date();

    return {
      configurado: this.configurado,
      provedor: PROVEDOR_DE_SAQUE,
      validadePadraoMinutos: VALIDADE_PADRAO_DA_AUTORIZACAO_MIN,
      autorizacoes: autorizacoes.map((a) => ({
        id: a.id,
        tipo: a.operationType,
        modo: a.amountMode,
        // `.toFixed(2)`, não `.toString()`: o Decimal normaliza e devolveria
        // "279" para R$ 279,00 — a convenção da API é sempre duas casas.
        valor: a.amount.toFixed(2),
        observacao: a.note,
        expiraEm: a.expiresAt,
        usadaEm: a.usedAt,
        revogadaEm: a.revokedAt,
        criadaPor: a.createdByEmail,
        criadaEm: a.createdAt,
        situacao: situacaoDaAutorizacao(
          { expiraEm: a.expiresAt, usadaEm: a.usedAt, revogadaEm: a.revokedAt },
          agora,
        ),
      })),
      decisoes: decisoes.map((d) => ({
        id: d.id,
        tipo: d.operationType,
        operacao: d.operationKey,
        valor: d.amount ? d.amount.toFixed(2) : null,
        decisao: d.decision,
        motivo: d.reason,
        autorizacaoId: d.authorizationId,
        tokenOk: d.tokenOk,
        quando: d.createdAt,
      })),
    };
  }

  async autorizar(nova: NovaAutorizacao, autorId: string) {
    let centavos: bigint;
    try {
      centavos = emCentavos(nova.valor);
    } catch {
      throw new BadRequestException('Valor inválido. Use o formato 1234.56.');
    }
    if (centavos <= 0n) throw new BadRequestException('O valor autorizado precisa ser maior que zero.');

    // O e-mail é **copiado** para a linha, não lido por join na hora de exibir:
    // a trilha de quem autorizou uma saída de dinheiro tem de continuar legível
    // depois de a conta ser removida. Mesmo princípio do snapshot do contrato.
    const autor = await this.privilegiado.user.findUnique({
      where: { id: autorId },
      select: { email: true },
    });

    const criada = await this.privilegiado.withdrawalAuthorization.create({
      data: {
        provider: PROVEDOR_DE_SAQUE,
        operationType: nova.tipo,
        amountMode: nova.modo,
        amount: new Prisma.Decimal(deCentavos(centavos)),
        note: nova.observacao?.trim() || null,
        expiresAt: expiraEm(nova.validadeMinutos),
        createdBy: autorId,
        createdByEmail: autor?.email ?? null,
      },
    });

    this.logger.warn(
      `Autorização de saque criada por ${autor?.email ?? autorId}: ${criada.operationType} ` +
        `${criada.amountMode} R$ ${criada.amount.toFixed(2)}, válida até ${criada.expiresAt.toISOString()}.`,
    );

    return { id: criada.id, expiraEm: criada.expiresAt };
  }

  /**
   * Revoga antes do prazo. Não apaga: a linha continua na trilha, com a hora
   * da revogação — quem autorizou e desautorizou um saque é informação que se
   * guarda, não que se limpa.
   */
  async revogar(id: string) {
    const alteradas = await this.privilegiado.withdrawalAuthorization.updateMany({
      where: { id, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (alteradas.count !== 1) {
      throw new NotFoundException('Autorização não encontrada, já usada ou já revogada.');
    }
    return { revogada: true };
  }
}

/** Linha do banco → o que a regra pura enxerga. */
function paraDominio(a: {
  id: string;
  operationType: string;
  amountMode: string;
  amount: Prisma.Decimal;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}): AutorizacaoDeSaque {
  return {
    id: a.id,
    tipo: a.operationType as TipoDeSaque,
    modo: a.amountMode as ModoDeValor,
    valorCentavos: emCentavos(a.amount.toFixed(2)),
    expiraEm: a.expiresAt,
    usadaEm: a.usedAt,
    revogadaEm: a.revokedAt,
  };
}

function ehDuplicado(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
