import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { ehGlobal, type Escopo } from '../../common/escopo';
import { lerOfx, sugerirConciliacao, type CandidatoParaConciliar } from '@autoconnect/shared';

/**
 * Conciliação bancária: o extrato do banco encontra os lançamentos da loja.
 *
 * É a fase que dá **confiança no número**. Antes dela, o caixa do sistema é o
 * que a loja digitou; depois, é o que o banco confirma — e o que sobra dos dois
 * lados fica visível em vez de virar diferença que ninguém explica.
 *
 * Três decisões moldam este arquivo:
 *
 *  1. **Importar duas vezes não duplica.** A unicidade é `(conta, fitid)`, no
 *     banco. O caso comum não é reimportar o mesmo arquivo: é o arquivo seguinte
 *     se sobrepor ao anterior em alguns dias.
 *  2. **A sugestão nunca concilia sozinha.** Ela é uma proposta; quem confirma é
 *     a pessoa. Conciliação automática silenciosa é como uma diferença de R$ 0,10
 *     vira três meses de extrato errado.
 *  3. **Conciliar dá baixa.** A linha do extrato é a prova de que o dinheiro se
 *     moveu — se o lançamento ainda estava previsto, ele passa a pago, na conta
 *     do extrato.
 */
@Injectable()
export class ConciliacaoService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantDe(escopo: Escopo): string {
    if (ehGlobal(escopo)) {
      throw new BadRequestException('Selecione uma concessionária para conciliar o extrato dela.');
    }
    return escopo.tenantId;
  }

  /**
   * Importa um OFX para a conta.
   *
   * O que o parser não conseguiu ler volta como `ignoradas` — contado, nunca
   * escondido: transação sumida em conciliação é diferença que ninguém acha.
   */
  async importarOfx(escopo: Escopo, accountId: string, conteudo: string) {
    const tenantId = this.tenantDe(escopo);
    const { transacoes, ignoradas } = lerOfx(conteudo);

    if (transacoes.length === 0) {
      throw new BadRequestException(
        ignoradas > 0
          ? `Nenhuma transação legível no arquivo (${ignoradas} linha(s) não puderam ser lidas).`
          : 'Nenhuma transação encontrada no arquivo. Confira se é o extrato em OFX.',
      );
    }

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const conta = await tx.financialAccount.findFirst({
        where: { id: accountId, tenantId },
        select: { id: true, name: true },
      });
      if (!conta) throw new NotFoundException('Conta não encontrada');

      const { count } = await tx.bankTransaction.createMany({
        data: transacoes.map((t) => ({
          tenantId,
          accountId: conta.id,
          fitid: t.fitid,
          postedAt: t.data,
          amount: new Prisma.Decimal(t.valor),
          direction: t.direction,
          memo: t.descricao || null,
        })),
        // `(conta, fitid)` é único: o que já estava lá fica como está.
        skipDuplicates: true,
      });

      return {
        conta: conta.name,
        lidas: transacoes.length,
        importadas: count,
        jaExistiam: transacoes.length - count,
        ignoradas,
      };
    });
  }

  /**
   * O que sobra dos dois lados, com as sugestões de par.
   *
   * A sugestão sai de `sugerirConciliacao`, pura e no shared: valor **igual**
   * (nunca aproximado) e data dentro da janela. É a regra que mais erra em
   * silêncio se não tiver teste, e por isso ela não mora aqui.
   */
  async pendencias(escopo: Escopo, accountId: string) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      // 404 quando a conta não é desta loja, em vez de duas listas vazias: sob
      // RLS a consulta voltaria vazia de qualquer jeito, e "vazio" esconderia
      // tanto o id errado quanto a conta da loja vizinha.
      const conta = await tx.financialAccount.findFirst({
        where: { id: accountId, tenantId }, select: { id: true },
      });
      if (!conta) throw new NotFoundException('Conta não encontrada');

      const [extrato, lancamentos] = await Promise.all([
        tx.bankTransaction.findMany({
          where: { tenantId, accountId, entryId: null, ignoredAt: null },
          orderBy: { postedAt: 'asc' },
        }),
        tx.financialEntry.findMany({
          where: {
            tenantId,
            status: { in: ['previsto', 'pago'] },
            bankTransaction: { is: null },
            OR: [{ accountId }, { accountId: null }],
          },
          select: {
            id: true, direction: true, value: true, dueDate: true, paidAt: true,
            description: true, status: true,
          },
          orderBy: { dueDate: 'asc' },
          take: 500,
        }),
      ]);

      const candidatos: CandidatoParaConciliar[] = lancamentos.map((l) => ({
        id: l.id,
        direction: l.direction,
        valor: l.value.toFixed(2),
        // Pago compara pela baixa; previsto, pelo vencimento — é a data que a
        // pessoa teria em mente ao olhar as duas listas lado a lado.
        data: l.paidAt ?? l.dueDate,
      }));

      const sugestoes = sugerirConciliacao(
        extrato.map((e) => ({
          fitid: e.fitid,
          data: e.postedAt,
          valor: e.amount.toFixed(2),
          direction: e.direction,
          descricao: e.memo ?? '',
        })),
        candidatos,
      );

      const porFitid = new Map(sugestoes.map((s) => [s.fitid, s]));

      return {
        transacoes: extrato.map((e) => {
          const sugestao = porFitid.get(e.fitid);
          const lancamento = sugestao
            ? lancamentos.find((l) => l.id === sugestao.lancamentoId)
            : undefined;

          return {
            id: e.id,
            fitid: e.fitid,
            postedAt: e.postedAt.toISOString(),
            amount: e.amount.toFixed(2),
            direction: e.direction,
            memo: e.memo,
            sugestao: sugestao && lancamento
              ? {
                lancamentoId: lancamento.id,
                descricao: lancamento.description,
                valor: lancamento.value.toFixed(2),
                status: lancamento.status,
                distanciaEmDias: sugestao.distanciaEmDias,
                confianca: sugestao.confianca,
              }
              : null,
          };
        }),
        lancamentosSemExtrato: lancamentos
          .filter((l) => !sugestoes.some((s) => s.lancamentoId === l.id))
          .slice(0, 100)
          .map((l) => ({
            id: l.id,
            descricao: l.description,
            valor: l.value.toFixed(2),
            direction: l.direction,
            status: l.status,
            dueDate: l.dueDate.toISOString(),
          })),
      };
    });
  }

  /**
   * Confirma o par — e dá baixa, quando o lançamento ainda era promessa.
   *
   * A linha do extrato é a prova de que o dinheiro se moveu: deixar o lançamento
   * como "previsto" depois de conciliá-lo seria manter no caixa uma promessa que
   * o banco já cumpriu.
   */
  async conciliar(escopo: Escopo, transacaoId: string, entryId: string) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const transacao = await tx.bankTransaction.findFirst({
        where: { id: transacaoId, tenantId },
      });
      if (!transacao) throw new NotFoundException('Transação não encontrada');
      if (transacao.entryId) {
        throw new BadRequestException('Esta linha do extrato já está conciliada.');
      }

      const lancamento = await tx.financialEntry.findFirst({
        where: { id: entryId, tenantId },
        include: { bankTransaction: { select: { id: true } } },
      });
      if (!lancamento) throw new NotFoundException('Lançamento não encontrado');
      if (lancamento.bankTransaction) {
        throw new BadRequestException('Este lançamento já foi conciliado com outra linha.');
      }
      if (lancamento.status === 'cancelado') {
        throw new BadRequestException('Lançamento cancelado não concilia — crie outro no lugar.');
      }
      if (lancamento.direction !== transacao.direction) {
        throw new BadRequestException(
          'Entrada não concilia com saída: confira se escolheu o lançamento certo.',
        );
      }
      if (!lancamento.value.equals(transacao.amount)) {
        // Conciliar valores diferentes é o começo de um caixa que não fecha.
        // Quem precisa disso lança a diferença (tarifa, juros) e concilia as duas.
        throw new BadRequestException(
          `Os valores não batem: extrato ${transacao.amount.toFixed(2)}, ` +
            `lançamento ${lancamento.value.toFixed(2)}.`,
        );
      }

      await tx.bankTransaction.update({
        where: { id: transacao.id },
        data: { entryId: lancamento.id },
      });

      if (lancamento.status === 'previsto') {
        await tx.financialEntry.update({
          where: { id: lancamento.id },
          data: {
            status: 'pago',
            paidAt: transacao.postedAt,
            accountId: transacao.accountId,
          },
        });
      }

      return { conciliado: true, deuBaixa: lancamento.status === 'previsto' };
    });
  }

  /** "Não é da loja": tarifa já lançada, transferência interna, engano do banco. */
  async ignorar(escopo: Escopo, transacaoId: string) {
    const tenantId = this.tenantDe(escopo);

    return this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const { count } = await tx.bankTransaction.updateMany({
        where: { id: transacaoId, tenantId, entryId: null },
        data: { ignoredAt: new Date() },
      });
      if (count === 0) throw new NotFoundException('Transação não encontrada ou já conciliada');
      return { ignorada: true };
    });
  }
}
