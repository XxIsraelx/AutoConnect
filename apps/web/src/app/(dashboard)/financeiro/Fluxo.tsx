'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { formatarBRL } from '@autoconnect/shared';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';
import { buscarFluxo, type FluxoDeCaixa } from './dados';

const dia = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

/**
 * O caixa dia a dia, daqui para frente.
 *
 * Existe para responder **uma** pergunta, que é a que o dono faz toda semana e
 * que nenhuma outra tela responde: *em que dia o caixa fica negativo*. Por isso
 * o primeiro elemento da tela é a resposta dela, e não o gráfico.
 *
 * Os dias sem movimento são escondidos: uma lista de 30 linhas em que 22 são
 * "R$ 0,00" esconde as 8 que importam.
 */
export default function Fluxo() {
  const token = useAuthStore((s) => s.token);
  const [dias, setDias] = useState(30);
  const [fluxo, setFluxo] = useState<FluxoDeCaixa | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      setFluxo(await buscarFluxo(token, dias));
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [token, dias]);

  useEffect(() => { carregar(); }, [carregar]);

  if (erro) {
    return <ErroAoCarregar erro={erro} onTentarNovamente={carregar} carregando={carregando}
      contexto="o fluxo de caixa" />;
  }
  if (!fluxo) return <p className="text-sm text-slate-400 py-6 text-center">Carregando…</p>;

  const comMovimento = fluxo.serie.filter(
    (d) => Number(d.entradas) > 0 || Number(d.saidas) > 0,
  );
  const menorSaldo = fluxo.serie.reduce(
    (m, d) => (Number(d.saldo) < Number(m.saldo) ? d : m),
    fluxo.serie[0]!,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          {[15, 30, 60, 90].map((d) => (
            <button key={d} onClick={() => setDias(d)}
              className={cn('px-3 py-1.5 text-xs font-medium rounded-md transition',
                dias === d ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-500')}>
              {d} dias
            </button>
          ))}
        </div>
        <button onClick={carregar} disabled={carregando} title="Atualizar"
          className="ml-auto p-1.5 rounded-lg border border-slate-200 dark:border-slate-800
                     hover:bg-slate-50 dark:hover:bg-slate-800">
          <RefreshCw size={13} className={cn(carregando && 'animate-spin')} />
        </button>
      </div>

      {/* A resposta primeiro, o detalhe depois. */}
      {fluxo.primeiroDiaNegativo ? (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-500/30
                        bg-rose-50 dark:bg-rose-500/10 p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-rose-600 dark:text-rose-400" />
            <span className="text-sm font-bold text-rose-900 dark:text-rose-100">
              O caixa fica negativo em {dia(fluxo.primeiroDiaNegativo)}
            </span>
          </div>
          <p className="text-sm text-rose-900/90 dark:text-rose-100/90 mt-1">
            Menor saldo previsto na janela: <strong>{formatarBRL(menorSaldo.saldo)}</strong> em{' '}
            {dia(menorSaldo.dia)}. Contas vencidas e ainda não pagas entram no primeiro dia —
            quem não pagou ainda deve.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-500/30
                        bg-emerald-50 dark:bg-emerald-500/10 p-5">
          <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
            O caixa não fica negativo nos próximos {dias} dias
          </p>
          <p className="text-sm text-emerald-900/90 dark:text-emerald-100/90 mt-1">
            Menor saldo previsto: {formatarBRL(menorSaldo.saldo)} em {dia(menorSaldo.dia)}.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800
                      bg-white dark:bg-slate-900 p-4">
        <div className="flex items-center justify-between text-sm mb-3">
          <span className="text-slate-500">Saldo hoje</span>
          <span className="font-bold tabular-nums">{formatarBRL(fluxo.saldoHoje)}</span>
        </div>

        {comMovimento.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nada a vencer nos próximos {dias} dias.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-400 text-left">
                  <th className="px-3 py-2 font-semibold">Dia</th>
                  <th className="px-3 py-2 font-semibold text-right">Entra</th>
                  <th className="px-3 py-2 font-semibold text-right">Sai</th>
                  <th className="px-3 py-2 font-semibold text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {comMovimento.map((d) => (
                  <tr key={d.dia} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2">{dia(d.dia)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {Number(d.entradas) > 0 ? formatarBRL(d.entradas) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-rose-600 dark:text-rose-400 tabular-nums">
                      {Number(d.saidas) > 0 ? formatarBRL(d.saidas) : '—'}
                    </td>
                    <td className={cn('px-3 py-2 text-right font-semibold tabular-nums',
                      Number(d.saldo) < 0 && 'text-rose-600 dark:text-rose-400')}>
                      {formatarBRL(d.saldo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-slate-400 mt-3">
          Só os dias com movimento aparecem. O previsto é pelo vencimento; o saldo de hoje conta
          só o que já foi pago.
        </p>
      </div>
    </div>
  );
}
