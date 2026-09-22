'use client';

import { useState } from 'react';
import { Plus, Copy, Trash2, Ban, Check, Loader2, Mail, StickyNote } from 'lucide-react';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import {
  Carregando, Vazio, botaoIconeCls, botaoPrimarioCls, cartaoCls, fmtDate, inputCls,
  mensagemDaAcao, useCarga, type PropsDaAba,
} from './comum';
import type { Invite } from './tipos';

/**
 * A própria origem do navegador — não uma variável de ambiente.
 *
 * Antes era `process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'`, e
 * como `NEXT_PUBLIC_*` é embutida no bundle durante o `next build`, bastava a
 * variável não existir no serviço para produção carregar `localhost:3000`
 * cravado. O painel é `'use client'`, então `window.location.origin` está
 * sempre disponível na hora do clique e acerta em qualquer ambiente.
 */
export function urlDoSite(): string {
  return typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000');
}

export function AbaConvites({ chamar, avisar, sinal }: PropsDaAba) {
  const { dados, setDados, erro, carregando, recarregar } =
    useCarga(() => chamar<Invite[]>('/admin/invites'), sinal);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [email, setEmail] = useState('');
  const [nota, setNota] = useState('');
  const [dias, setDias] = useState(7);
  const [criando, setCriando] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  async function criar() {
    setCriando(true);
    try {
      const inv = await chamar<Invite>('/admin/invites', {
        method: 'POST',
        body: { email: email || undefined, note: nota || undefined, expiresInDays: dias },
      });
      setDados((p) => [inv, ...(p ?? [])]);
      setEmail(''); setNota(''); setDias(7); setMostrarForm(false);
      avisar('Convite criado!');
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao criar convite'), 'error');
    } finally {
      setCriando(false);
    }
  }

  async function revogar(id: string) {
    try {
      await chamar(`/admin/invites/${id}/revoke`, { method: 'PATCH' });
      setDados((p) => (p ?? []).map((i) => i.id === id ? { ...i, usedAt: new Date().toISOString() } : i));
      avisar('Convite invalidado');
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao invalidar convite'), 'error');
    }
  }

  async function remover(id: string) {
    if (!confirm('Remover permanentemente?')) return;
    try {
      await chamar(`/admin/invites/${id}`, { method: 'DELETE' });
      setDados((p) => (p ?? []).filter((i) => i.id !== id));
      avisar('Convite removido');
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao remover convite'), 'error');
    }
  }

  async function copiar(token: string, id: string) {
    try {
      await navigator.clipboard.writeText(`${urlDoSite()}/signup?invite=${token}`);
      setCopiado(id);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      avisar('O navegador não permitiu copiar. Copie o link manualmente.', 'error');
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex justify-end">
        <button onClick={() => setMostrarForm((v) => !v)} className={botaoPrimarioCls}>
          <Plus size={14} /> Novo convite
        </button>
      </div>

      {mostrarForm && (
        <div className={`${cartaoCls} p-4 sm:p-5 space-y-4`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">E-mail restrito (opcional)</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="empresa@ex.com" type="email" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Validade</label>
              <select value={dias} onChange={(e) => setDias(+e.target.value)} className={inputCls}>
                {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} dia{d > 1 ? 's' : ''}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Nota interna</label>
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Para quem é este convite?" className={inputCls} />
          </div>
          <div className="flex gap-2 justify-end flex-wrap">
            <button onClick={() => setMostrarForm(false)} className="px-4 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
              Cancelar
            </button>
            <button onClick={criar} disabled={criando} className={botaoPrimarioCls}>
              {criando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Criar
            </button>
          </div>
        </div>
      )}

      <div className={`${cartaoCls} overflow-hidden`}>
        {erro ? (
          <ErroAoCarregar erro={erro} onTentarNovamente={recarregar} carregando={carregando} contexto="os convites" />
        ) : !dados ? (
          <Carregando />
        ) : dados.length === 0 ? (
          <Vazio>Nenhum convite criado</Vazio>
        ) : dados.map((inv, i) => {
          const usado = !!inv.usedAt;
          const expirado = new Date(inv.expiresAt) < new Date();
          const ativo = !usado && !expirado;
          return (
            <div key={inv.id} className={`flex items-start gap-3 p-4 ${i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : ''}`}>
              <span className={`shrink-0 mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                usado ? 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                  : expirado ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600'
                    : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${usado ? 'bg-slate-400' : expirado ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                {usado ? 'Usado' : expirado ? 'Expirado' : 'Ativo'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-slate-500 truncate">{inv.token.slice(0, 32)}…</p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-slate-400">
                  {inv.email && <span className="inline-flex items-center gap-1 min-w-0 break-all"><Mail size={11} className="shrink-0" />{inv.email}</span>}
                  {inv.note && <span className="inline-flex items-center gap-1 min-w-0 break-words"><StickyNote size={11} className="shrink-0" />{inv.note}</span>}
                  <span>Expira {fmtDate(inv.expiresAt)}</span>
                </div>
              </div>
              <div className="flex gap-0.5 shrink-0">
                {ativo && (
                  <button onClick={() => copiar(inv.token, inv.id)} title="Copiar link" aria-label="Copiar link" className={`${botaoIconeCls} hover:text-blue-600`}>
                    {copiado === inv.id ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                  </button>
                )}
                {ativo && (
                  <button onClick={() => revogar(inv.id)} title="Invalidar" aria-label="Invalidar" className={`${botaoIconeCls} hover:text-amber-600`}>
                    <Ban size={14} />
                  </button>
                )}
                <button onClick={() => remover(inv.id)} title="Remover" aria-label="Remover" className={`${botaoIconeCls} hover:text-rose-600`}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
