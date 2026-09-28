'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { ROTULO_DO_GRUPO, FINANCIAL_CATEGORY_GROUPS } from '@autoconnect/shared';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import type { CategoriaFinanceira } from './dados';

const campo =
  'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 ' +
  'px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/20';

/**
 * O plano de contas da loja.
 *
 * Começa semeado com o mínimo de uma revenda e é aqui que ele deixa de ser
 * genérico: "Consórcio", "Leilão", "Despachante" são categorias que só a loja
 * sabe que precisa. O grupo existe para o DRE da Fase 4 somar por bloco em vez de
 * listar trinta linhas.
 */
export default function Categorias({
  categorias, onMudou,
}: {
  categorias: CategoriaFinanceira[];
  onMudou: () => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [direction, setDirection] = useState<'entrada' | 'saida'>('saida');
  const [group, setGroup] = useState<CategoriaFinanceira['group']>('operacao');
  const [name, setName] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSalvando(true);
    setErro('');
    try {
      await api('/financeiro/categorias', {
        method: 'POST', token, body: { direction, group, name: name.trim() },
      });
      setName('');
      onMudou();
    } catch (err) {
      setErro(textoDoErro(err));
    } finally {
      setSalvando(false);
    }
  }

  const porDirecao = (d: 'entrada' | 'saida') => categorias.filter((c) => c.direction === d);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {([['entrada', 'Entradas'], ['saida', 'Saídas']] as const).map(([dir, titulo]) => (
          <div key={dir}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <h2 className="text-sm font-semibold mb-2">{titulo}</h2>
            <ul className="space-y-1.5">
              {porDirecao(dir).map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <span className={c.active ? '' : 'text-slate-400 line-through'}>{c.name}</span>
                  <span className="text-[11px] text-slate-400">{ROTULO_DO_GRUPO[c.group]}</span>
                </li>
              ))}
              {porDirecao(dir).length === 0 && (
                <li className="text-sm text-slate-400">Nenhuma ainda.</li>
              )}
            </ul>
          </div>
        ))}
      </div>

      <form onSubmit={salvar}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <h2 className="text-sm font-semibold">Nova categoria</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="cat-dir" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
              É entrada ou saída?
            </label>
            <select id="cat-dir" value={direction} className={campo}
              onChange={(e) => setDirection(e.target.value as 'entrada' | 'saida')}>
              <option value="saida">Saída</option>
              <option value="entrada">Entrada</option>
            </select>
          </div>
          <div>
            <label htmlFor="cat-grupo" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
              Grupo
            </label>
            <select id="cat-grupo" value={group} className={campo}
              onChange={(e) => setGroup(e.target.value as CategoriaFinanceira['group'])}>
              {FINANCIAL_CATEGORY_GROUPS.map((g) => (
                <option key={g} value={g}>{ROTULO_DO_GRUPO[g]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cat-nome" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
              Nome
            </label>
            <input id="cat-nome" value={name} onChange={(e) => setName(e.target.value)}
              required maxLength={80} placeholder="Despachante" className={campo} />
          </div>
        </div>

        {erro && <p className="text-xs text-rose-600 dark:text-rose-400">{erro}</p>}

        <div className="flex justify-end">
          <button type="submit" disabled={salvando}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                       bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {salvando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Criar categoria
          </button>
        </div>
      </form>
    </div>
  );
}
