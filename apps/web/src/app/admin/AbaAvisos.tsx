'use client';

import { useState } from 'react';
import { Megaphone, Loader2, X, Info, AlertTriangle, OctagonAlert } from 'lucide-react';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import {
  Carregando, Vazio, cartaoCls, fmtDateTime, inputCls, mensagemDaAcao, useCarga, type PropsDaAba,
} from './comum';
import type { AnnRow } from './tipos';

export function AbaAvisos({ chamar, avisar, sinal }: PropsDaAba) {
  const { dados, setDados, erro, carregando, recarregar } =
    useCarga(() => chamar<AnnRow[]>('/admin/announcements'), sinal);

  const [msg, setMsg] = useState('');
  const [tipo, setTipo] = useState('info');
  const [expira, setExpira] = useState('');
  const [publicando, setPublicando] = useState(false);

  async function publicar() {
    if (!msg.trim()) return;
    setPublicando(true);
    try {
      const ann = await chamar<AnnRow>('/admin/announcements', {
        method: 'POST',
        // `datetime-local` não tem fuso: converte no navegador, que sabe qual é.
        body: { message: msg, type: tipo, expiresAt: expira ? new Date(expira).toISOString() : null },
      });
      // A API desativa os avisos anteriores ao publicar um novo.
      setDados((p) => [ann, ...(p ?? []).map((a) => ({ ...a, isActive: false }))]);
      setMsg(''); setTipo('info'); setExpira('');
      avisar('Aviso publicado!');
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao publicar aviso'), 'error');
    } finally {
      setPublicando(false);
    }
  }

  async function desativar(id: string) {
    try {
      await chamar(`/admin/announcements/${id}/deactivate`, { method: 'PATCH' });
      setDados((p) => (p ?? []).map((a) => a.id === id ? { ...a, isActive: false } : a));
      avisar('Aviso desativado');
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao desativar aviso'), 'error');
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className={`${cartaoCls} p-4 sm:p-5 space-y-4`}>
        <h3 className="font-semibold text-sm">Publicar aviso global</h3>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Mensagem</label>
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500}
            placeholder="Manutenção programada para domingo às 22h…"
            className={`${inputCls} resize-none`} rows={3} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
              <option value="info">Informativo</option>
              <option value="warning">Atenção</option>
              <option value="critical">Crítico</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Expira em (opcional)</label>
            <input type="datetime-local" value={expira} onChange={(e) => setExpira(e.target.value)} className={inputCls} />
          </div>
        </div>
        <button onClick={publicar} disabled={publicando || !msg.trim()}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition disabled:opacity-50 text-center">
          {publicando ? <Loader2 size={14} className="animate-spin shrink-0" /> : <Megaphone size={14} className="shrink-0" />}
          Publicar para todas as concessionárias
        </button>
      </div>

      {erro ? (
        <div className={cartaoCls}>
          <ErroAoCarregar erro={erro} onTentarNovamente={recarregar} carregando={carregando} contexto="os avisos" />
        </div>
      ) : !dados ? (
        <Carregando />
      ) : dados.length === 0 ? (
        <Vazio>Nenhum aviso publicado</Vazio>
      ) : (
        <div className="space-y-2">
          {dados.map((a) => {
            const Icon = a.type === 'critical' ? OctagonAlert : a.type === 'warning' ? AlertTriangle : Info;
            const cor = a.type === 'critical' ? 'text-red-600' : a.type === 'warning' ? 'text-amber-600' : 'text-blue-600';
            return (
              <div key={a.id} className={`flex items-start gap-3 p-4 rounded-2xl border ${a.isActive ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800' : 'bg-slate-50 dark:bg-slate-800/30 border-transparent opacity-60'}`}>
                <Icon size={16} className={`shrink-0 mt-0.5 ${cor}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm break-words">{a.message}</p>
                  <p className="text-xs text-slate-400 mt-1">{fmtDateTime(a.createdAt)}{a.expiresAt ? ` · expira ${fmtDateTime(a.expiresAt)}` : ''}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {a.isActive && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600">Ativo</span>}
                  {a.isActive && (
                    <button onClick={() => desativar(a.id)} title="Desativar" aria-label="Desativar aviso" className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-400 hover:text-rose-500">
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
