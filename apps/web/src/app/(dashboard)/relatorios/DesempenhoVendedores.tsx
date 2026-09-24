'use client';

/**
 * Desempenho por vendedor.
 *
 * Junta duas fontes de propósito: `/tenant/reports/salespeople` traz leads,
 * agenda e venda; `/leads/sla-stats` traz o tempo de primeira resposta, que é
 * calculado uma vez só, no módulo de leads. Repetir o cálculo do SLA aqui
 * criaria dois números com o mesmo nome — e a loja acabaria com dois
 * relatórios seus discordando.
 *
 * O SLA é opcional: se a rota não existe ainda (ou falha), a seção continua
 * inteira e as duas colunas do prazo mostram "—". Um relatório que some porque
 * um pedaço dele faltou é pior do que um relatório com uma coluna vazia.
 *
 * Dinheiro só aparece para quem a API deixa ver: ela devolve `veDinheiro` e os
 * campos vêm nulos para o vendedor. A tela não decide isso — só obedece.
 */

import { useCallback, useEffect, useState } from 'react';
import { Users, Download, RefreshCw, Loader2 } from 'lucide-react';
import { formatarBRL } from '@autoconnect/shared';
import { api, baixarArquivo } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';

interface LinhaDeDesempenho {
  userId: string;
  nome: string;
  papel: string;
  leadsRecebidos: number;
  leadsAtendidos: number;
  agendamentos: number;
  comparecimentos: number;
  faltas: number;
  taxaComparecimento: number | null;
  negociosGanhos: number;
  faturamento: string | null;
  margem: string | null;
  comissaoPct: string | null;
  comissaoEstimada: string | null;
}

interface Desempenho {
  periodo: { days: number };
  veDinheiro: boolean;
  vendedores: LinhaDeDesempenho[];
}

/** Formato combinado com o módulo de leads (item 7 da Onda 1). */
interface LinhaDeSla {
  userId: string;
  nome: string;
  leads: number;
  respondidos: number;
  tempoMedioSegundos: number | null;
  estourados: number;
}

const PAPEL: Record<string, string> = {
  salesperson: 'Vendedor',
  manager: 'Gerente',
  tenant_admin: 'Administrador',
};

/** "1h 12min", "8min", "45s" — minuto cheio é o que a loja discute. */
function duracao(segundos: number | null): string {
  if (segundos === null || !Number.isFinite(segundos)) return '—';
  if (segundos < 60) return `${Math.round(segundos)}s`;
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}min`;
}

export default function DesempenhoVendedores({ days }: { days: number }) {
  const token = useAuthStore((s) => s.token);
  const [dados, setDados] = useState<Desempenho | null>(null);
  const [sla, setSla] = useState<LinhaDeSla[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erroDownload, setErroDownload] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      setDados(await api<Desempenho>(`/tenant/reports/salespeople?days=${days}`, { token }));
    } catch (e) {
      setErro(e);
      setDados(null);
    } finally {
      setCarregando(false);
    }

    // Em separado e depois: o SLA é um extra. Se ele falhar, o resto da seção
    // já está na tela. O `catch` aqui é o único do arquivo que engole o erro,
    // e engole porque a ausência tem representação visível ("—" na coluna).
    try {
      setSla(await api<LinhaDeSla[]>(`/leads/sla-stats?days=${days}`, { token }));
    } catch {
      setSla(null);
    }
  }, [token, days]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function baixar(rota: string, arquivo: string, chave: string) {
    setBaixando(chave);
    setErroDownload(null);
    try {
      await baixarArquivo(rota, arquivo, token ?? undefined);
    } catch (e) {
      setErroDownload(textoDoErro(e));
    } finally {
      setBaixando(null);
    }
  }

  const slaDe = (userId: string) => sla?.find((s) => s.userId === userId) ?? null;
  const temDinheiro = dados?.veDinheiro ?? false;

  const exportacoes: { chave: string; rotulo: string; rota: string; arquivo: string }[] = [
    {
      chave: 'desempenho',
      rotulo: 'Desempenho',
      rota: `/tenant/reports/salespeople.csv?days=${days}`,
      arquivo: `desempenho-vendedores-${days}d.csv`,
    },
    {
      chave: 'negocios',
      rotulo: 'Negócios',
      rota: `/tenant/reports/deals.csv?days=${days}`,
      arquivo: `negocios-${days}d.csv`,
    },
    {
      chave: 'estoque',
      rotulo: 'Estoque',
      rota: '/tenant/reports/inventory.csv',
      arquivo: 'estoque.csv',
    },
  ];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Users size={15} className="text-blue-500" />
          <h2 className="text-sm font-semibold">Desempenho por vendedor</h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {exportacoes.map((e) => (
            <button
              key={e.chave}
              onClick={() => baixar(e.rota, e.arquivo, e.chave)}
              disabled={baixando !== null}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg
                         border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400
                         hover:border-blue-400 hover:text-blue-600 disabled:opacity-40 transition"
            >
              {baixando === e.chave ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Download size={13} />
              )}
              {e.rotulo}
            </button>
          ))}
          <button
            onClick={carregar}
            disabled={carregando}
            title="Atualizar"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            <RefreshCw size={13} className={cn(carregando && 'animate-spin')} />
          </button>
        </div>
      </div>

      {erroDownload && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2 mb-3">
          Não foi possível baixar o arquivo: {erroDownload}
        </p>
      )}

      {carregando && !dados ? (
        <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" />
          Carregando desempenho…
        </div>
      ) : erro ? (
        <ErroAoCarregar
          erro={erro}
          onTentarNovamente={carregar}
          carregando={carregando}
          contexto="o desempenho da equipe"
        />
      ) : dados && dados.vendedores.length > 0 ? (
        <>
          {/* Muitas colunas: no celular a tabela rola em vez de espremer. */}
          <div className="overflow-x-auto -mx-4 sm:-mx-5 px-4 sm:px-5">
            <table className="w-full text-sm min-w-[46rem]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-xs text-slate-500">
                  <th className="text-left py-2 pr-3 font-medium">Vendedor</th>
                  <th className="text-right py-2 px-2 font-medium" title="Leads atribuídos no período">Leads</th>
                  <th className="text-right py-2 px-2 font-medium" title="Leads que saíram de “Novo”">Atendidos</th>
                  <th className="text-right py-2 px-2 font-medium" title="Tempo médio até a primeira resposta ao lead">1ª resposta</th>
                  <th className="text-right py-2 px-2 font-medium" title="Leads que estouraram o prazo de primeiro contato">Fora do prazo</th>
                  <th className="text-right py-2 px-2 font-medium">Agend.</th>
                  <th className="text-right py-2 px-2 font-medium" title="Comparecimentos sobre comparecimentos + faltas">Compar.</th>
                  <th className="text-right py-2 px-2 font-medium">Ganhos</th>
                  {temDinheiro && (
                    <>
                      <th className="text-right py-2 px-2 font-medium">Faturamento</th>
                      <th className="text-right py-2 px-2 font-medium">Margem</th>
                      <th className="text-right py-2 pl-2 font-medium" title="Margem × percentual de comissão do perfil">Comissão</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {dados.vendedores.map((v) => {
                  const s = slaDe(v.userId);
                  return (
                    <tr
                      key={v.userId}
                      className="border-b border-slate-50 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition"
                    >
                      <td className="py-2.5 pr-3">
                        <p className="font-medium truncate max-w-[12rem]">{v.nome}</p>
                        <p className="text-[11px] text-slate-400">{PAPEL[v.papel] ?? v.papel}</p>
                      </td>
                      <td className="text-right py-2.5 px-2 tabular-nums">{v.leadsRecebidos}</td>
                      <td className="text-right py-2.5 px-2 tabular-nums">{v.leadsAtendidos}</td>
                      <td className="text-right py-2.5 px-2 tabular-nums text-slate-600 dark:text-slate-400">
                        {sla === null ? '—' : duracao(s?.tempoMedioSegundos ?? null)}
                      </td>
                      <td
                        className={cn(
                          'text-right py-2.5 px-2 tabular-nums',
                          (s?.estourados ?? 0) > 0
                            ? 'text-rose-600 dark:text-rose-400 font-medium'
                            : 'text-slate-500',
                        )}
                      >
                        {sla === null ? '—' : (s?.estourados ?? 0)}
                      </td>
                      <td className="text-right py-2.5 px-2 tabular-nums">{v.agendamentos}</td>
                      <td className="text-right py-2.5 px-2 tabular-nums">
                        {v.taxaComparecimento === null ? '—' : `${v.taxaComparecimento}%`}
                        {v.faltas > 0 && (
                          <span className="text-[11px] text-slate-400 ml-1">({v.faltas} falta{v.faltas > 1 ? 's' : ''})</span>
                        )}
                      </td>
                      <td className="text-right py-2.5 px-2 tabular-nums font-medium">{v.negociosGanhos}</td>
                      {temDinheiro && (
                        <>
                          <td className="text-right py-2.5 px-2 tabular-nums">
                            {v.faturamento ? formatarBRL(v.faturamento) : '—'}
                          </td>
                          <td className="text-right py-2.5 px-2 tabular-nums text-emerald-600 dark:text-emerald-400">
                            {v.margem ? formatarBRL(v.margem) : '—'}
                          </td>
                          <td className="text-right py-2.5 pl-2 tabular-nums">
                            {v.comissaoEstimada ? (
                              <>
                                {formatarBRL(v.comissaoEstimada)}
                                {v.comissaoPct && (
                                  <span className="text-[11px] text-slate-400 ml-1">
                                    ({Number(v.comissaoPct)}%)
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-400" title="Percentual de comissão não configurado no perfil">
                                —
                              </span>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-slate-400 mt-3">
            {sla === null
              ? 'Tempo de primeira resposta indisponível no momento.'
              : 'Tempo de primeira resposta medido da chegada do lead até o primeiro contato de saída.'}
            {!temDinheiro && ' Faturamento, margem e comissão são visíveis para gerência.'}
          </p>
        </>
      ) : (
        <p className="text-sm text-slate-500 py-8 text-center">
          Nenhum vendedor com movimento no período.
        </p>
      )}
    </div>
  );
}
