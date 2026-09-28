'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, Check, Loader2, RefreshCw } from 'lucide-react';
import { formatarBRL } from '@autoconnect/shared';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';
import {
  buscarLancamentos, cancelarLancamento, darBaixa,
  type ContaFinanceira, type Lancamento, type PaginaDeLancamentos,
} from './dados';

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

/**
 * A lista que serve às três abas: a pagar, a receber e tudo.
 *
 * Uma lista só, com `direction` por prop, porque as três fazem a mesma pergunta
 * com um filtro diferente — três componentes iguais divergiriam no primeiro
 * ajuste de coluna.
 *
 * A soma no topo é a do **filtro inteiro**, não a da página: somar o que está na
 * tela enganaria justamente quem abriu a lista para saber quanto deve.
 */
export default function ListaDeLancamentos({
  direction, contas, recarregarResumo,
}: {
  direction?: 'entrada' | 'saida';
  contas: ContaFinanceira[];
  recarregarResumo: () => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [pagina, setPagina] = useState<PaginaDeLancamentos | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);
  const [apenasAtrasados, setApenasAtrasados] = useState(false);
  const [status, setStatus] = useState<'' | 'previsto' | 'pago' | 'cancelado'>('');
  const [page, setPage] = useState(1);

  const [agindo, setAgindo] = useState<string | null>(null);
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ page: String(page), perPage: '50' });
      if (direction) params.set('direction', direction);
      if (status) params.set('status', status);
      if (apenasAtrasados) params.set('atrasados', 'true');
      setPagina(await buscarLancamentos(token, params.toString()));
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [token, direction, status, apenasAtrasados, page]);

  useEffect(() => { carregar(); }, [carregar]);

  async function baixar(l: Lancamento) {
    if (!token) return;
    const contasAtivas = contas.filter((c) => c.active);
    const contaId = l.conta?.id ?? contasAtivas[0]?.id;
    if (!contaId) {
      setErroDaAcao('Cadastre uma conta na aba Contas antes de dar baixa.');
      return;
    }

    setAgindo(l.id);
    setErroDaAcao(null);
    try {
      await darBaixa(token, l.id, { accountId: contaId });
      await carregar();
      recarregarResumo();
    } catch (e) {
      setErroDaAcao(textoDoErro(e));
    } finally {
      setAgindo(null);
    }
  }

  async function cancelar(l: Lancamento) {
    if (!token) return;
    // Cancelar deixa a linha e exige o porquê: é o que permite conferir o caixa
    // de três meses atrás e entender o que aconteceu.
    const motivo = window.prompt('Por que está cancelando este lançamento?')?.trim();
    if (!motivo) return;

    setAgindo(l.id);
    setErroDaAcao(null);
    try {
      await cancelarLancamento(token, l.id, motivo);
      await carregar();
      recarregarResumo();
    } catch (e) {
      setErroDaAcao(textoDoErro(e));
    } finally {
      setAgindo(null);
    }
  }

  if (erro) {
    return (
      <ErroAoCarregar erro={erro} onTentarNovamente={carregar} carregando={carregando}
        contexto="os lançamentos" />
    );
  }

  const itens = pagina?.itens ?? [];
  const totalPaginas = pagina ? Math.max(1, Math.ceil(pagina.total / pagina.perPage)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900
                     px-2.5 py-1.5 text-xs">
          <option value="">Todos os status</option>
          <option value="previsto">Previsto</option>
          <option value="pago">Pago</option>
          <option value="cancelado">Cancelado</option>
        </select>

        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={apenasAtrasados}
            onChange={(e) => { setApenasAtrasados(e.target.checked); setPage(1); }} />
          Só atrasados
        </label>

        <button onClick={carregar} disabled={carregando} title="Atualizar"
          className="ml-auto p-1.5 rounded-lg border border-slate-200 dark:border-slate-800
                     hover:bg-slate-50 dark:hover:bg-slate-800">
          <RefreshCw size={13} className={cn(carregando && 'animate-spin')} />
        </button>
      </div>

      {pagina && (
        <div className="flex flex-wrap gap-4 text-xs">
          {(!direction || direction === 'entrada') && (
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
              Entradas no filtro: {formatarBRL(pagina.somaEntradas)}
            </span>
          )}
          {(!direction || direction === 'saida') && (
            <span className="text-rose-600 dark:text-rose-400 font-semibold">
              Saídas no filtro: {formatarBRL(pagina.somaSaidas)}
            </span>
          )}
          <span className="text-slate-400">{pagina.total} lançamento(s)</span>
        </div>
      )}

      {erroDaAcao && (
        <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10
                      border border-rose-200 dark:border-rose-500/20 rounded-lg px-3 py-2">
          {erroDaAcao}
        </p>
      )}

      {carregando && !pagina ? (
        <p className="text-sm text-slate-400 py-6 text-center">Carregando…</p>
      ) : itens.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">
          Nenhum lançamento com esse filtro.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-400 text-left">
                <th className="px-3 py-2 font-semibold">Vencimento</th>
                <th className="px-3 py-2 font-semibold">Descrição</th>
                <th className="px-3 py-2 font-semibold">Categoria</th>
                <th className="px-3 py-2 font-semibold text-right">Valor</th>
                <th className="px-3 py-2 font-semibold">Situação</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {itens.map((l) => (
                <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className={cn('px-3 py-2.5 whitespace-nowrap',
                    l.atrasado && 'text-rose-600 dark:text-rose-400 font-semibold')}>
                    {data(l.dueDate)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="block">{l.description}</span>
                    {l.supplierName && (
                      <span className="block text-[11px] text-slate-400">{l.supplierName}</span>
                    )}
                    {l.origem && (
                      /* Nasceu de um negócio ou de um veículo: o financeiro
                         aponta para a origem em vez de copiar o valor dela. */
                      <span className="block text-[11px] text-blue-500">Gerado pelo sistema</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{l.categoria?.name ?? '—'}</td>
                  <td className={cn('px-3 py-2.5 text-right whitespace-nowrap font-semibold',
                    l.direction === 'entrada'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400')}>
                    {l.direction === 'entrada' ? '' : '−'}{formatarBRL(l.value)}
                  </td>
                  <td className="px-3 py-2.5">
                    {l.status === 'pago' ? (
                      <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        {l.direction === 'entrada' ? 'Recebido' : 'Pago'} {l.paidAt ? `em ${data(l.paidAt)}` : ''}
                      </span>
                    ) : l.status === 'cancelado' ? (
                      <span className="text-[11px] text-slate-400" title={l.cancelReason ?? undefined}>
                        Cancelado
                      </span>
                    ) : l.atrasado ? (
                      <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                        Atrasado
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500">Previsto</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {l.status === 'previsto' && (
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => void baixar(l)} disabled={agindo === l.id}
                          title={l.direction === 'entrada' ? 'Marcar como recebido' : 'Marcar como pago'}
                          className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50
                                     dark:hover:bg-emerald-500/10 disabled:opacity-40">
                          {agindo === l.id
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Check size={14} />}
                        </button>
                        <button onClick={() => void cancelar(l)} disabled={agindo === l.id}
                          title="Cancelar lançamento"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100
                                     dark:hover:bg-slate-800 disabled:opacity-40">
                          <Ban size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPaginas > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 disabled:opacity-40">
            Anterior
          </button>
          <span>Página {page} de {totalPaginas}</span>
          <button onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))} disabled={page >= totalPaginas}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 disabled:opacity-40">
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
