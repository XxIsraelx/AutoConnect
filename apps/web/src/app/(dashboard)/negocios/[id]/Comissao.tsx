'use client';

/**
 * A comissão deste negócio, onde o vendedor pergunta por ela.
 *
 * Até aqui a comissão só existia agregada em `/equipe` e `/relatorios` — e com
 * **duas bases diferentes**, o que dava dois valores para a mesma pessoa no
 * mesmo mês. Agora é uma conta só (`calcularComissao`, no shared): percentual
 * do perfil sobre o **valor de venda** dos negócios faturados.
 *
 * O cartão sempre diz a base. Um número de dinheiro sem a frase que o define é
 * exatamente como duas telas passam a discordar sem ninguém notar.
 */

import { DollarSign } from 'lucide-react';
import { BASE_DA_COMISSAO, formatarBRL } from '@autoconnect/shared';
import type { DealResumo } from '../dados';

export default function Comissao({ negocio }: { negocio: DealResumo }) {
  const c = negocio.comissao;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <DollarSign size={12} /> Comissão
      </p>

      {!c ? (
        <p className="text-sm text-slate-500">
          {negocio.salesperson
            ? 'A comissão do colega é visível para a gerência.'
            : 'Sem vendedor atribuído — defina o responsável para calcular a comissão.'}
        </p>
      ) : c.percentual === null ? (
        <p className="text-sm text-slate-500">
          Percentual de comissão não configurado no perfil de{' '}
          {negocio.salesperson?.fullName ?? 'quem vendeu'}. A administração
          define em Equipe.
        </p>
      ) : (
        <>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatarBRL(c.valor ?? '0.00')}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {Number(c.percentual).toLocaleString('pt-BR')}% sobre {formatarBRL(c.base)} —
            {' '}{BASE_DA_COMISSAO}.
          </p>
          {!c.faturada && (
            // A diferença importa na conversa sobre pagamento: negócio não
            // faturado ainda pode mudar de valor e ainda pode ser cancelado, e
            // é esse mesmo recorte que `/equipe` e `/relatorios` somam.
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">
              Estimativa: entra no total do mês quando o negócio for faturado.
            </p>
          )}
        </>
      )}
    </div>
  );
}
