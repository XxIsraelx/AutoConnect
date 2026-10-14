'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, Loader2, Scale, TriangleAlert } from 'lucide-react';
import {
  formatarBRL, formatarChaveNfe, ROTULO_DO_STATUS_DA_NOTA, ROTULO_DO_STATUS_RENAVE,
  type Divergencia, type RenaveStatusValue, type StatusDaNota,
} from '@autoconnect/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';

interface OperacaoConferida {
  tipo: 'saida' | 'entrada';
  origem: { tipo: 'negocio' | 'veiculo'; id: string };
  veiculo: string;
  data: string;
  valor: string;
  notaPropriaEsperada: boolean;
  nota: { status: StatusDaNota; chave: string | null; valorTotal: string } | null;
  renave: { status: RenaveStatusValue; chaveNfe: string | null; valor: string | null } | null;
  divergencias: Divergencia[];
}

interface Conferencia {
  resumo: { operacoes: number; batem: number; comDivergencia: number; comAviso: number };
  operacoes: OperacaoConferida[];
}

/**
 * Estoque, nota e RENAVE contando a mesma história — Fase C do plano fiscal.
 *
 * Mostra, por padrão, só o que discorda: com dezenas de operações por mês, a
 * lista inteira esconde as duas que importam. A chave da nota autorizada vem
 * pronta para copiar no RENAVE quando falta lá — é a divergência mais comum e
 * a mais fácil de resolver.
 */
export default function ConferenciaFiscal({ from, to }: { from: string; to: string }) {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const [dados, setDados] = useState<Conferencia | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);
  const [todas, setTodas] = useState(false);
  const [copiada, setCopiada] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      setDados(await api<Conferencia>(`/fiscal/conferencia?from=${from}&to=${to}`, { token }));
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [token, from, to]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function copiar(chave: string) {
    try {
      await navigator.clipboard.writeText(chave);
      setCopiada(chave);
    } catch {
      // Sem permissão de área de transferência: a chave continua na tela para copiar à mão.
      setCopiada(null);
    }
  }

  const visiveis = dados?.operacoes.filter((o) => todas || o.divergencias.length > 0) ?? [];

  return (
    <section className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Scale size={15} /> Conferência com o RENAVE
        </h3>
        {dados && dados.resumo.operacoes > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} />
            Mostrar também o que bate
          </label>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Para cada carro que saiu (negócio faturado) ou entrou (compra) no mês: a nota e o registro
        do RENAVE batem com o valor e a data? Aqui só aponta — a correção é no negócio, no veículo ou
        no RENAVE.
      </p>

      {carregando && !dados && <Loader2 size={16} className="animate-spin text-slate-400" />}
      {erro !== null && !carregando && <ErroAoCarregar erro={erro} onTentarNovamente={carregar} />}

      {dados && erro === null && (
        <>
          <p className="text-sm text-slate-700 dark:text-slate-200">
            {dados.resumo.operacoes === 0
              ? 'Nenhuma venda faturada nem compra neste mês.'
              : `${dados.resumo.operacoes} operação(ões): ${dados.resumo.batem} batem, `
                + `${dados.resumo.comDivergencia} com divergência, ${dados.resumo.comAviso} com aviso.`}
          </p>

          {dados.resumo.operacoes > 0 && visiveis.length === 0 && (
            <p className="text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 size={14} /> Estoque, notas e RENAVE contam a mesma história neste mês.
            </p>
          )}

          <ul className="space-y-2">
            {visiveis.map((o) => (
              <li key={`${o.tipo}-${o.origem.id}`} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={o.origem.tipo === 'negocio' ? `/negocios/${o.origem.id}` : `/veiculos/${o.origem.id}`}
                    className="text-sm font-medium text-brand-accent"
                  >
                    {o.tipo === 'saida' ? 'Venda' : 'Compra'} · {o.veiculo}
                  </Link>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {new Date(o.data).toLocaleDateString('pt-BR')} · {formatarBRL(o.valor)}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Nota: {!o.notaPropriaEsperada ? 'emitida pelo fornecedor' : o.nota ? ROTULO_DO_STATUS_DA_NOTA[o.nota.status] : 'nenhuma'}
                  {' · '}RENAVE: {o.renave ? ROTULO_DO_STATUS_RENAVE[o.renave.status] : 'nenhum registro'}
                </p>
                {o.divergencias.length === 0 ? (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">Tudo bate.</p>
                ) : (
                  <ul className="space-y-1">
                    {o.divergencias.map((d) => (
                      <li key={d.codigo} className={`text-xs flex flex-wrap items-center gap-x-2 ${d.gravidade === 'divergencia'
                        ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`}>
                        <TriangleAlert size={12} className="shrink-0" /> {d.mensagem}
                        {d.sugestao && (
                          <button
                            type="button" onClick={() => copiar(d.sugestao!)}
                            className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600 dark:text-slate-300 hover:underline"
                          >
                            <Copy size={11} /> {formatarChaveNfe(d.sugestao)}
                            {copiada === d.sugestao && <span className="font-sans text-emerald-600"> copiada</span>}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
