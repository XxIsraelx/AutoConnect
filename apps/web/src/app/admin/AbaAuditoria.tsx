'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import {
  Carregando, Vazio, botaoPrimarioCls, cartaoCls, fmtDateTime, inputCls, useCarga, type PropsDaAba,
} from './comum';
import type { AuditPage } from './tipos';

export function AbaAuditoria({ chamar, sinal }: PropsDaAba) {
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState({ action: '', page: 1 });

  const { dados, erro, carregando, recarregar } = useCarga(() => {
    const params = new URLSearchParams({ page: String(filtro.page) });
    if (filtro.action) params.set('action', filtro.action);
    return chamar<AuditPage>(`/admin/audit?${params}`);
  }, sinal, `${filtro.action}|${filtro.page}`);

  function filtrar() {
    const action = texto.trim();
    if (action === filtro.action && filtro.page === 1) void recarregar();
    else setFiltro({ action, page: 1 });
  }

  const irPara = (page: number) => setFiltro((f) => ({ ...f, page }));

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap gap-2 sm:gap-3">
        <input value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && filtrar()}
          placeholder="Filtrar por ação (ex.: plan_changed, impersonation)…"
          className={`${inputCls} flex-1 basis-full sm:basis-auto`} />
        <button onClick={filtrar} className={`${botaoPrimarioCls} flex-1 sm:flex-none`}>Filtrar</button>
      </div>

      <div className={`${cartaoCls} overflow-hidden`}>
        {erro ? (
          <ErroAoCarregar erro={erro} onTentarNovamente={recarregar} carregando={carregando} contexto="a auditoria" />
        ) : !dados || carregando ? (
          <Carregando />
        ) : dados.entries.length === 0 ? (
          <Vazio>Nenhum registro</Vazio>
        ) : dados.entries.map((e, i) => (
          <div key={e.id} className={`p-4 ${i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : ''}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded max-w-full break-all ${
                e.action.includes('rejected') ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-600' :
                  e.action.includes('deactivated') || e.action.includes('suspended') ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600' :
                    'bg-slate-100 dark:bg-slate-800 text-slate-500'
              }`}>
                {e.action}
              </span>
              <p className="text-xs text-slate-400 whitespace-nowrap">{fmtDateTime(e.createdAt)}</p>
            </div>
            <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap gap-x-2">
              <span className="font-medium">{e.entityType}</span>
              {e.entityId && <span className="font-mono opacity-60">{e.entityId.slice(0, 8)}…</span>}
              {e.actor && <span>por {e.actor.fullName}</span>}
            </div>
            {Object.keys(e.diff ?? {}).length > 0 && (
              <p className="text-xs text-slate-400 mt-0.5 font-mono truncate">{JSON.stringify(e.diff)}</p>
            )}
          </div>
        ))}
      </div>

      {dados && dados.pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button onClick={() => irPara(filtro.page - 1)} disabled={filtro.page <= 1 || carregando}
            aria-label="Página anterior"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
            <ChevronLeft size={14} />
          </button>
          <span className="text-slate-500">Página {filtro.page} de {dados.pages} · {dados.total} registros</span>
          <button onClick={() => irPara(filtro.page + 1)} disabled={filtro.page >= dados.pages || carregando}
            aria-label="Próxima página"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
