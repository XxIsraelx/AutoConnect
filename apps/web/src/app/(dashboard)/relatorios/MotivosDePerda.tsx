'use client';

import { useCallback, useEffect, useState } from 'react';
import { TrendingDown, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import { formatarBRL } from '@autoconnect/shared';
import { cn } from '@/lib/utils';

interface MotivoDePerdaDaApi {
  codigo: string | null;
  rotulo: string;
  quantidade: number;
  /** `null` para quem não vê dinheiro — o filtro é da consulta, não da tela. */
  valorDeTabela: string | null;
}

interface Resposta {
  periodo: { days: number };
  veDinheiro: boolean;
  total: number;
  motivos: MotivoDePerdaDaApi[];
}

/**
 * Por que a loja perdeu.
 *
 * O negócio grava o motivo do cancelamento desde 23/09/2026 e nenhuma tela
 * agrupava por ele: dava para ver o motivo de um negócio, não o padrão de
 * trinta. O consolidado vem do servidor porque o funil de `/negocios` é montado
 * com a página carregada — contar ali daria o total da página.
 */
export default function MotivosDePerda({ days }: { days: number }) {
  const { token } = useAuthStore();
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      setDados(await api<Resposta>(`/tenant/reports/lost-reasons?days=${days}`, { token }));
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [token, days]);

  useEffect(() => { carregar(); }, [carregar]);

  const maior = dados?.motivos[0]?.quantidade ?? 1;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <TrendingDown size={15} className="text-rose-500" />
          <h2 className="text-sm font-semibold">Por que perdemos</h2>
          {dados && dados.total > 0 && (
            <span className="text-xs text-slate-500">
              {dados.total} {dados.total === 1 ? 'negócio' : 'negócios'} nos últimos {days} dias
            </span>
          )}
        </div>
        <button
          onClick={carregar}
          disabled={carregando}
          title="Atualizar"
          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800
                     hover:bg-slate-50 dark:hover:bg-slate-800 transition"
        >
          <RefreshCw size={13} className={cn(carregando && 'animate-spin')} />
        </button>
      </div>

      {erro ? (
        <ErroAoCarregar
          erro={erro}
          onTentarNovamente={carregar}
          carregando={carregando}
          contexto="os motivos de perda"
        />
      ) : !dados ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : dados.total === 0 ? (
        <p className="text-sm text-slate-500">
          Nenhum negócio cancelado ou distratado nos últimos {days} dias.
        </p>
      ) : (
        <div className="space-y-2.5">
          {dados.motivos.map((m) => (
            <div key={m.codigo ?? 'sem-motivo'} className="flex items-center gap-2 sm:gap-3">
              <span className="w-28 sm:w-44 text-xs text-slate-500 text-right shrink-0 truncate"
                    title={m.rotulo}>
                {m.rotulo}
              </span>
              <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-lg h-7 overflow-hidden">
                <div
                  className="h-full rounded-lg bg-rose-500 flex items-center px-2.5
                             transition-all duration-700 min-w-[2rem]"
                  style={{ width: `${Math.max(Math.round((m.quantidade / maior) * 100), 6)}%` }}
                >
                  <span className="text-[11px] font-bold text-white">{m.quantidade}</span>
                </div>
              </div>
              {m.valorDeTabela !== null && (
                <span className="w-24 sm:w-28 text-[11px] text-slate-400 shrink-0 text-right">
                  {formatarBRL(m.valorDeTabela)}
                </span>
              )}
            </div>
          ))}

          {dados.veDinheiro && (
            <p className="text-[11px] text-slate-400 pt-1">
              O valor é o preço de tabela dos negócios perdidos: quem morre antes da negociação
              não tem valor de venda, e somar só o negociado faria o total parecer menor do que foi.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
