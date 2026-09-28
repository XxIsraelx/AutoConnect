'use client';

import { useState } from 'react';
import { Landmark, Loader2, Plus, Wallet } from 'lucide-react';
import { formatarBRL } from '@autoconnect/shared';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { useAuthStore } from '@/store/auth';
import { paraApi } from '@/lib/dinheiro';
import { criarConta, type ContaFinanceira } from './dados';

const campo =
  'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 ' +
  'px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/20';

const ROTULO_DO_TIPO: Record<ContaFinanceira['kind'], string> = {
  caixa: 'Caixa',
  banco: 'Banco',
  adquirente: 'Maquininha',
  outro: 'Outra',
};

/**
 * Onde o dinheiro está.
 *
 * O **saldo inicial** é o campo que parece burocracia e não é: a loja começa a
 * usar o sistema no meio da vida dela, e sem ele o primeiro mês mostraria um
 * caixa que nunca existiu. O saldo exibido é sempre derivado — inicial mais o
 * que entrou, menos o que saiu, contando só o que foi pago.
 */
export default function Contas({
  contas, onMudou,
}: {
  contas: ContaFinanceira[];
  onMudou: () => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [abrindo, setAbrindo] = useState(false);
  const [kind, setKind] = useState<ContaFinanceira['kind']>('banco');
  const [name, setName] = useState('');
  const [saldo, setSaldo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    const openingBalance = saldo.trim() ? paraApi(saldo) : '0';
    if (!openingBalance) {
      setErro('Informe um saldo como 1.234,56 — ou deixe em branco para zero.');
      return;
    }

    setSalvando(true);
    setErro('');
    try {
      await criarConta(token, { kind, name: name.trim(), openingBalance });
      setName('');
      setSaldo('');
      setAbrindo(false);
      onMudou();
    } catch (err) {
      setErro(textoDoErro(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {contas.map((c) => (
          <div key={c.id}
            className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900">
            <div className="flex items-center gap-2 text-slate-500">
              {c.kind === 'caixa' ? <Wallet size={14} /> : <Landmark size={14} />}
              <span className="text-[11px] uppercase tracking-wide font-semibold">
                {ROTULO_DO_TIPO[c.kind]}
              </span>
              {!c.active && <span className="text-[11px] text-slate-400">· inativa</span>}
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{c.name}</p>
            <p className="mt-2 text-lg font-bold tabular-nums">
              {formatarBRL(c.saldo ?? c.openingBalance)}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Saldo inicial {formatarBRL(c.openingBalance)}
            </p>
          </div>
        ))}

        {contas.length === 0 && (
          <p className="text-sm text-slate-500 sm:col-span-2 lg:col-span-3">
            Nenhuma conta ainda. Cadastre o caixa da loja e cada banco: é por conta que o saldo
            fecha com o extrato.
          </p>
        )}
      </div>

      {abrindo ? (
        <form onSubmit={salvar}
          className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3
                     bg-white dark:bg-slate-900">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="c-tipo" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                Tipo
              </label>
              <select id="c-tipo" value={kind} className={campo}
                onChange={(e) => setKind(e.target.value as ContaFinanceira['kind'])}>
                {(Object.keys(ROTULO_DO_TIPO) as ContaFinanceira['kind'][]).map((k) => (
                  <option key={k} value={k}>{ROTULO_DO_TIPO[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="c-nome" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                Nome
              </label>
              <input id="c-nome" value={name} onChange={(e) => setName(e.target.value)}
                required maxLength={80} placeholder="Banco do Brasil" className={campo} />
            </div>
            <div>
              <label htmlFor="c-saldo" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                Saldo hoje
              </label>
              <input id="c-saldo" value={saldo} onChange={(e) => setSaldo(e.target.value)}
                inputMode="decimal" placeholder="0,00" className={campo} />
            </div>
          </div>

          {erro && <p className="text-xs text-rose-600 dark:text-rose-400">{erro}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setAbrindo(false); setErro(''); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300
                         hover:bg-slate-100 dark:hover:bg-slate-800">
              Cancelar
            </button>
            <button type="submit" disabled={salvando}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                         bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {salvando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Salvar conta
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setAbrindo(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                     border border-slate-200 dark:border-slate-700 hover:border-blue-400
                     hover:text-blue-600 transition">
          <Plus size={13} /> Nova conta
        </button>
      )}
    </div>
  );
}
