'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Store } from 'lucide-react';
import { limiteDeFiliais, mascararTelefoneBr } from '@autoconnect/shared';
import { api } from '@/lib/api';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { cn } from '@/lib/utils';

export interface FilialResumida {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  isHeadquarters: boolean;
}

const input =
  'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm ' +
  'outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition';

/**
 * As filiais da loja: qual está sendo editada no formulário de endereço abaixo,
 * e a criação de uma nova.
 *
 * O teto do plano (1 / 2 / 5) é mostrado aqui para o lojista não descobrir o
 * limite pelo erro — mas quem decide é a API (`POST /tenant/branch`, 422 acima
 * do teto), e a mensagem dela é a que aparece se ele tentar mesmo assim.
 */
export default function Filiais({
  filiais, selecionada, plano, token, onSelecionar, onCriada,
}: {
  /** Só as ativas: a desativada não conta no teto nem aparece para edição. */
  filiais: FilialResumida[];
  selecionada: string | null;
  plano: string;
  token: string;
  onSelecionar: (id: string) => void;
  onCriada: (id: string) => void;
}) {
  const limite = limiteDeFiliais(plano);
  const noTeto = limite !== null && filiais.length >= limite;

  const [abrindo, setAbrindo] = useState(false);
  const [nome, setNome] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const criada = await api<{ id: string }>('/tenant/branch', {
        method: 'POST',
        token,
        body: {
          name: nome.trim(),
          city: cidade.trim() || undefined,
          state: uf.trim().toUpperCase() || undefined,
          phone: telefone.trim() || undefined,
        },
      });
      setNome(''); setCidade(''); setUf(''); setTelefone('');
      setAbrindo(false);
      onCriada(criada.id);
    } catch (err) {
      setErro(textoDoErro(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-slate-500">
          {filiais.length} {filiais.length === 1 ? 'filial' : 'filiais'}
          {limite !== null && ` de ${limite} no seu plano`}
        </p>
        {!abrindo && (
          <button
            type="button"
            onClick={() => setAbrindo(true)}
            disabled={noTeto}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400
                       hover:text-blue-700 disabled:text-slate-400 disabled:cursor-not-allowed transition"
          >
            <Plus size={15} /> Nova filial
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {filiais.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelecionar(f.id)}
            aria-pressed={f.id === selecionada}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition text-left',
              f.id === selecionada
                ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-500/10 text-slate-900 dark:text-white'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300',
            )}
          >
            <Store size={14} className="shrink-0 text-slate-400" />
            <span>
              <span className="font-medium">{f.name}</span>
              {(f.city || f.state) && (
                <span className="text-xs text-slate-500"> · {[f.city, f.state].filter(Boolean).join('/')}</span>
              )}
            </span>
            {f.isHeadquarters && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">matriz</span>
            )}
          </button>
        ))}
      </div>

      {noTeto && !abrindo && (
        <p className="text-xs text-slate-500 mt-3">
          Seu plano está no limite de filiais.{' '}
          <Link href="/configuracoes/plano" className="text-blue-600 dark:text-blue-400 hover:underline">
            Veja os planos
          </Link>{' '}
          para abrir outra.
        </p>
      )}

      {abrindo && (
        <form onSubmit={criar} className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Nome da filial</span>
              <input className={input} value={nome} onChange={(e) => setNome(e.target.value)}
                     placeholder="Ex.: Loja Centro" required minLength={2} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Telefone</span>
              <input className={input} value={telefone} inputMode="tel"
                     onChange={(e) => setTelefone(mascararTelefoneBr(e.target.value))} placeholder="(19) 3333-4444" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Cidade</span>
              <input className={input} value={cidade} onChange={(e) => setCidade(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">UF</span>
              <input className={input} value={uf} maxLength={2} onChange={(e) => setUf(e.target.value)} placeholder="SP" />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Endereço completo, horário e o pino do mapa você preenche logo abaixo, depois de criar.
          </p>
          {erro && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{erro}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={salvando || nome.trim().length < 2}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white
                         hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {salvando && <Loader2 size={14} className="animate-spin" />} Criar filial
            </button>
            <button
              type="button"
              onClick={() => { setAbrindo(false); setErro(null); }}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
