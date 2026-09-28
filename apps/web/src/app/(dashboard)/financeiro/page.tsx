'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowDownCircle, ArrowUpCircle, CalendarClock, Loader2, Plus,
  RefreshCw, Wallet,
} from 'lucide-react';
import { formatarBRL } from '@autoconnect/shared';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import { cn } from '@/lib/utils';
import Categorias from './Categorias';
import Conciliacao from './Conciliacao';
import Contas from './Contas';
import Dre from './Dre';
import Fluxo from './Fluxo';
import ListaDeLancamentos from './ListaDeLancamentos';
import NovoLancamentoModal from './NovoLancamentoModal';
import {
  buscarCategorias, buscarContas, buscarResumo, semearCategorias,
  type CategoriaFinanceira, type ContaFinanceira, type ResumoFinanceiro,
} from './dados';

type Aba = 'visao' | 'fluxo' | 'dre' | 'pagar' | 'receber' | 'todos' | 'conciliacao' | 'contas' | 'categorias';

const ABAS: { chave: Aba; rotulo: string }[] = [
  { chave: 'visao', rotulo: 'Visão' },
  { chave: 'fluxo', rotulo: 'Fluxo de caixa' },
  { chave: 'dre', rotulo: 'Resultado do mês' },
  { chave: 'pagar', rotulo: 'A pagar' },
  { chave: 'receber', rotulo: 'A receber' },
  { chave: 'todos', rotulo: 'Lançamentos' },
  { chave: 'conciliacao', rotulo: 'Conciliação' },
  { chave: 'contas', rotulo: 'Contas' },
  { chave: 'categorias', rotulo: 'Categorias' },
];

/**
 * Financeiro da loja.
 *
 * A aba **Visão** responde as quatro perguntas do dono, na ordem em que ele as
 * faz: quanto tenho, o que vence esta semana, o que ficou atrasado, e como está o
 * mês. Nenhuma delas é soma de página: vêm do `/financeiro/resumo`, que agrupa no
 * banco.
 *
 * Quem vê esta tela é gerência (`manager` para cima) — a API recusa o vendedor
 * com 403, e o menu não mostra o item para ele. As duas coisas, porque esconder
 * no menu sem fechar a API é esconder, não proteger.
 */
export default function FinanceiroPage() {
  const token = useAuthStore((s) => s.token);
  const [aba, setAba] = useState<Aba>('visao');

  const [resumo, setResumo] = useState<ResumoFinanceiro | null>(null);
  const [contas, setContas] = useState<ContaFinanceira[]>([]);
  const [categorias, setCategorias] = useState<CategoriaFinanceira[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);

  const [semeando, setSemeando] = useState(false);
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null);
  const [novo, setNovo] = useState<'entrada' | 'saida' | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      // Em paralelo, mas cada uma com a própria falha: o resumo é o que a tela
      // precisa para abrir, e ele vem primeiro no `Promise.all` por isso.
      const [r, c, cat] = await Promise.all([
        buscarResumo(token),
        buscarContas(token),
        buscarCategorias(token),
      ]);
      setResumo(r);
      setContas(c);
      setCategorias(cat);
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => { carregar(); }, [carregar]);

  async function semear() {
    if (!token) return;
    setSemeando(true);
    setErroDaAcao(null);
    try {
      await semearCategorias(token);
      await carregar();
    } catch (e) {
      setErroDaAcao(textoDoErro(e));
    } finally {
      setSemeando(false);
    }
  }

  if (carregando && !resumo) {
    return (
      <div className="p-4 sm:p-6 flex items-center gap-2 text-slate-500">
        <Loader2 size={18} className="animate-spin" /> Carregando o financeiro…
      </div>
    );
  }

  if (erro) {
    return (
      <div className="p-4 sm:p-6">
        <ErroAoCarregar erro={erro} onTentarNovamente={carregar} carregando={carregando}
          contexto="o financeiro" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Financeiro</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            O caixa da loja: o que entra, o que sai e o que está por vencer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setNovo('saida')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                       bg-blue-600 text-white hover:bg-blue-700 transition">
            <Plus size={13} /> Novo lançamento
          </button>
          <button onClick={carregar} disabled={carregando} title="Atualizar"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800
                       hover:bg-slate-50 dark:hover:bg-slate-800 transition">
            <RefreshCw size={14} className={cn(carregando && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Sem plano de contas não há lançamento: a tela oferece o caminho em vez
          de abrir vazia e esperar que alguém adivinhe. */}
      {resumo && !resumo.temCategorias && (
        <div className="rounded-2xl border border-blue-200 dark:border-blue-500/30
                        bg-blue-50 dark:bg-blue-500/10 p-5">
          <p className="text-sm font-bold text-blue-900 dark:text-blue-100">
            Comece pelo plano de contas
          </p>
          <p className="text-sm text-blue-900/90 dark:text-blue-100/90 mt-1">
            São as categorias de uma revenda — compra de veículo, preparação, aluguel, comissão.
            Você renomeia, desativa e cria as suas depois.
          </p>
          <button onClick={() => void semear()} disabled={semeando}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold
                       bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {semeando ? <><Loader2 size={14} className="animate-spin" /> Criando…</> : 'Criar plano de contas'}
          </button>
          {erroDaAcao && <p className="text-xs text-rose-600 dark:text-rose-400 mt-2">{erroDaAcao}</p>}
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
        {ABAS.map((a) => (
          <button key={a.chave} onClick={() => setAba(a.chave)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition',
              aba === a.chave ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-500',
            )}>
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === 'visao' && resumo && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Cartao titulo="Saldo hoje" icone={Wallet} valor={formatarBRL(resumo.saldoTotal)}
              detalhe={`${resumo.contas.length} conta(s)`} />
            <Cartao titulo="Vence em 7 dias" icone={CalendarClock}
              valor={formatarBRL(resumo.proximos7Dias.aPagar)}
              detalhe={`a receber ${formatarBRL(resumo.proximos7Dias.aReceber)}`} />
            <Cartao titulo="Atrasado" icone={AlertTriangle}
              valor={formatarBRL(resumo.atrasado.aPagar)}
              detalhe={`${resumo.atrasado.quantidade} lançamento(s)`}
              alerta={resumo.atrasado.quantidade > 0} />
            <Cartao titulo="Resultado do mês" icone={ArrowUpCircle}
              valor={formatarBRL(resumo.mesCorrente.resultado)}
              detalhe={`recebido ${formatarBRL(resumo.mesCorrente.recebido)} · pago ${formatarBRL(resumo.mesCorrente.pago)}`} />
          </div>

          {resumo.contas.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <h2 className="text-sm font-semibold mb-3">Saldo por conta</h2>
              <ul className="space-y-2">
                {resumo.contas.map((c) => (
                  <li key={c.contaId} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-300">{c.nome}</span>
                    <span className="font-semibold tabular-nums">{formatarBRL(c.saldo)}</span>
                  </li>
                ))}
              </ul>
              {/* O saldo é derivado dos lançamentos pagos: nenhuma coluna guarda
                  saldo, para não existir saldo errado depois de uma edição. */}
              <p className="text-[11px] text-slate-400 mt-3">
                Saldo é o inicial da conta mais o que entrou, menos o que saiu — contando só o
                que já foi pago.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={() => setNovo('saida')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                         border border-slate-200 dark:border-slate-700 hover:border-rose-400
                         hover:text-rose-600 transition">
              <ArrowDownCircle size={13} /> Lançar uma despesa
            </button>
            <button onClick={() => setNovo('entrada')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                         border border-slate-200 dark:border-slate-700 hover:border-emerald-400
                         hover:text-emerald-600 transition">
              <ArrowUpCircle size={13} /> Lançar uma receita
            </button>
          </div>
        </div>
      )}

      {aba === 'fluxo' && <Fluxo />}
      {aba === 'dre' && <Dre />}
      {aba === 'pagar' && (
        <ListaDeLancamentos direction="saida" contas={contas} recarregarResumo={carregar} />
      )}
      {aba === 'receber' && (
        <ListaDeLancamentos direction="entrada" contas={contas} recarregarResumo={carregar} />
      )}
      {aba === 'todos' && (
        <ListaDeLancamentos contas={contas} recarregarResumo={carregar} />
      )}
      {aba === 'conciliacao' && <Conciliacao contas={contas} />}
      {aba === 'contas' && <Contas contas={contas} onMudou={carregar} />}
      {aba === 'categorias' && <Categorias categorias={categorias} onMudou={carregar} />}

      {novo && (
        <NovoLancamentoModal
          contas={contas}
          categorias={categorias}
          direcaoInicial={novo}
          onFechar={() => setNovo(null)}
          onCriado={() => { setNovo(null); void carregar(); }}
        />
      )}
    </div>
  );
}

function Cartao({
  titulo, icone: Icone, valor, detalhe, alerta = false,
}: {
  titulo: string;
  icone: React.ElementType;
  valor: string;
  detalhe: string;
  alerta?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-xl border p-4 bg-white dark:bg-slate-900',
      alerta
        ? 'border-rose-200 dark:border-rose-500/30'
        : 'border-slate-200 dark:border-slate-800',
    )}>
      <div className="flex items-center gap-2 text-slate-500">
        <Icone size={14} className={alerta ? 'text-rose-500' : undefined} />
        <span className="text-[11px] uppercase tracking-wide font-semibold">{titulo}</span>
      </div>
      <p className={cn('mt-1.5 text-xl font-bold tabular-nums',
        alerta && 'text-rose-600 dark:text-rose-400')}>
        {valor}
      </p>
      <p className="text-[11px] text-slate-400 mt-0.5">{detalhe}</p>
    </div>
  );
}
