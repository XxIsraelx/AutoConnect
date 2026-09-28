'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock, LockOpen, Loader2, RefreshCw } from 'lucide-react';
import { formatarBRL, ROTULO_DO_GRUPO, type FinancialCategoryGroupValue } from '@autoconnect/shared';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';
import {
  buscarDre, buscarPeriodos, fecharMes, reabrirMes,
  type Dre as DreDaApi, type PeriodoFechado,
} from './dados';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * O resultado do mês, e o fechamento dele.
 *
 * O DRE é **gerencial e por competência da venda**: a linha do mês é a venda que
 * fechou nele, mesmo que o dinheiro entre em três parcelas. Quem quer o caixa do
 * mês olha o Fluxo, que responde outra pergunta — e a tela diz isso, porque dois
 * números diferentes para "o mês" sem explicação é como se perde a confiança nos
 * dois.
 */
export default function Dre() {
  const token = useAuthStore((s) => s.token);
  const hoje = new Date();
  const [year, setYear] = useState(hoje.getUTCFullYear());
  const [month, setMonth] = useState(hoje.getUTCMonth() + 1);

  const [dre, setDre] = useState<DreDaApi | null>(null);
  const [periodos, setPeriodos] = useState<PeriodoFechado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);
  const [agindo, setAgindo] = useState(false);
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      const [d, p] = await Promise.all([buscarDre(token, year, month), buscarPeriodos(token)]);
      setDre(d);
      setPeriodos(p);
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [token, year, month]);

  useEffect(() => { carregar(); }, [carregar]);

  const fechado = periodos.some((p) => p.year === year && p.month === month);

  async function fechar() {
    if (!token) return;
    setAgindo(true);
    setErroDaAcao(null);
    setAviso(null);
    try {
      const r = await fecharMes(token, year, month);
      // O que ficou para trás aparece: fechar o mês com conta vencida e sem
      // baixa esconde dívida, e quem fecha precisa ver isso.
      const partes = [
        r.comissoesGeradas > 0 ? `${r.comissoesGeradas} comissão(ões) lançada(s)` : null,
        r.pendentesNoMes > 0 ? `${r.pendentesNoMes} lançamento(s) do mês continuam em aberto` : null,
      ].filter(Boolean);
      setAviso(partes.length ? partes.join(' · ') : 'Mês fechado.');
      await carregar();
    } catch (e) {
      setErroDaAcao(textoDoErro(e));
    } finally {
      setAgindo(false);
    }
  }

  async function reabrir() {
    if (!token) return;
    const motivo = window.prompt('Por que está reabrindo este mês?')?.trim();
    if (!motivo) return;

    setAgindo(true);
    setErroDaAcao(null);
    try {
      await reabrirMes(token, year, month, motivo);
      setAviso('Mês reaberto. A ação ficou na auditoria.');
      await carregar();
    } catch (e) {
      setErroDaAcao(textoDoErro(e));
    } finally {
      setAgindo(false);
    }
  }

  if (erro) {
    return <ErroAoCarregar erro={erro} onTentarNovamente={carregar} carregando={carregando}
      contexto="o resultado do mês" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900
                     px-2.5 py-1.5 text-xs capitalize">
          {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900
                     px-2.5 py-1.5 text-xs">
          {[hoje.getUTCFullYear(), hoje.getUTCFullYear() - 1].map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        {fechado ? (
          <button onClick={() => void reabrir()} disabled={agindo}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                       border border-slate-200 dark:border-slate-700 hover:border-amber-400
                       hover:text-amber-600 disabled:opacity-50">
            {agindo ? <Loader2 size={13} className="animate-spin" /> : <LockOpen size={13} />}
            Reabrir mês
          </button>
        ) : (
          <button onClick={() => void fechar()} disabled={agindo}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                       bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {agindo ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
            Fechar mês
          </button>
        )}

        <button onClick={carregar} disabled={carregando} title="Atualizar"
          className="ml-auto p-1.5 rounded-lg border border-slate-200 dark:border-slate-800
                     hover:bg-slate-50 dark:hover:bg-slate-800">
          <RefreshCw size={13} className={cn(carregando && 'animate-spin')} />
        </button>
      </div>

      {fechado && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Lock size={12} /> Mês fechado: lançamento com vencimento nele não entra nem muda até
          alguém reabrir — e reabrir fica na auditoria.
        </p>
      )}
      {aviso && <p className="text-xs text-blue-600 dark:text-blue-400">{aviso}</p>}
      {erroDaAcao && (
        <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10
                      border border-rose-200 dark:border-rose-500/20 rounded-lg px-3 py-2">
          {erroDaAcao}
        </p>
      )}

      {!dre ? (
        <p className="text-sm text-slate-400 py-6 text-center">Carregando…</p>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800
                        bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-1.5">
          <Linha rotulo={`Receita de veículos (${dre.negociosFaturados} negócio(s))`}
            valor={dre.receitaDeVeiculos} />
          <Linha rotulo="Custo dos veículos vendidos" valor={dre.custoDosVeiculosVendidos} negativo />
          <Linha rotulo="Margem bruta" valor={dre.margemBruta} forte />

          {Number(dre.outrasReceitas) > 0 && (
            <Linha rotulo="Outras receitas recebidas" valor={dre.outrasReceitas} />
          )}

          <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800" />
          {dre.despesasPorGrupo.map((d) => (
            <Linha key={d.grupo}
              rotulo={ROTULO_DO_GRUPO[d.grupo as FinancialCategoryGroupValue] ?? d.grupo}
              valor={d.valor} negativo />
          ))}
          {dre.despesasPorGrupo.length === 0 && (
            <p className="text-sm text-slate-400">Nenhuma despesa de operação paga no mês.</p>
          )}

          <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800" />
          <Linha rotulo="Resultado do mês" valor={dre.resultado} forte />

          {/* A regra que impede o número de ser lido errado. */}
          <p className="text-[11px] text-slate-400 pt-3 leading-relaxed">
            Gerencial e por competência da venda: o mês é o do negócio faturado, mesmo que o
            dinheiro entre parcelado. O custo vem do que o negócio congelou ao faturar — por isso
            as contas a pagar de compra e preparação <strong>não</strong> aparecem como despesa
            aqui: elas são o caixa do mesmo carro, e somar as duas contaria o veículo duas vezes.
            Para o caixa do mês, veja o Fluxo.
          </p>
        </div>
      )}
    </div>
  );
}

function Linha({ rotulo, valor, negativo = false, forte = false }: {
  rotulo: string;
  valor: string;
  negativo?: boolean;
  forte?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 text-sm',
      forte && 'font-bold')}>
      <span className={cn('text-slate-600 dark:text-slate-300', forte && 'text-slate-900 dark:text-white')}>
        {rotulo}
      </span>
      <span className={cn('tabular-nums',
        negativo ? 'text-rose-600 dark:text-rose-400' : Number(valor) < 0 ? 'text-rose-600 dark:text-rose-400' : '')}>
        {negativo ? '−' : ''}{formatarBRL(valor)}
      </span>
    </div>
  );
}
