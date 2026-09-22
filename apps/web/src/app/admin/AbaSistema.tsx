'use client';

import { Clock } from 'lucide-react';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import { Carregando, Secao, cartaoCls, fmtDateTime, useCarga, type PropsDaAba } from './comum';
import type { StatusDoServico, SystemHealth } from './tipos';

/**
 * `off` não é falha: é serviço que ninguém ligou (sem credencial, de propósito).
 * Por isso tem cor neutra e rótulo próprio — vermelho fica só para o que está
 * configurado e não responde.
 */
const ESTILO: Record<StatusDoServico, { rotulo: string; badge: string; ponto: string }> = {
  up: { rotulo: 'Operando', badge: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', ponto: 'bg-emerald-500' },
  down: { rotulo: 'Com falha', badge: 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400', ponto: 'bg-rose-500' },
  off: { rotulo: 'Desligado', badge: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400', ponto: 'bg-slate-400' },
};

const NOME_DO_CRON: Record<string, string> = {
  'appointment-reminders': 'Lembretes de agendamento',
  'cold-leads': 'Leads frios',
};

export function AbaSistema({ chamar, sinal }: PropsDaAba) {
  const { dados, erro, carregando, recarregar } = useCarga(() => chamar<SystemHealth>('/admin/system'), sinal);

  if (erro) {
    return (
      <div className={cartaoCls}>
        <ErroAoCarregar erro={erro} onTentarNovamente={recarregar} carregando={carregando} contexto="o estado do sistema" />
      </div>
    );
  }
  if (!dados) return <Carregando />;

  const falhas = dados.services.filter((s) => s.status === 'down').length;

  return (
    <div className="space-y-8 max-w-5xl">
      <Secao
        titulo="Serviços"
        extra={<span className="text-xs text-slate-400">Verificado em {fmtDateTime(dados.checkedAt)}{carregando ? ' · atualizando…' : ''}</span>}
      >
        {falhas > 0 && (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            {falhas} serviço(s) configurado(s) sem responder.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {dados.services.map((s) => {
            const e = ESTILO[s.status];
            return (
              <div key={s.key} className={`${cartaoCls} p-4 sm:p-5 min-w-0`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{s.label}</p>
                    {s.provider && <p className="text-[11px] text-slate-400 font-mono break-all">{s.provider}</p>}
                  </div>
                  <span className={`shrink-0 flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${e.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${e.ponto}`} />
                    {e.rotulo}
                  </span>
                </div>
                {s.latencyMs !== undefined && s.status !== 'off' && (
                  <p className="text-2xl font-extrabold text-slate-900 dark:text-white">
                    {s.latencyMs}<span className="text-sm font-normal text-slate-400 ml-1">ms</span>
                  </p>
                )}
                {s.detail && <p className="text-xs text-slate-500 mt-1 break-words">{s.detail}</p>}
              </div>
            );
          })}
        </div>
      </Secao>

      <Secao titulo="Tarefas agendadas (esta réplica)">
        <div className={`${cartaoCls} overflow-hidden`}>
          {dados.cronJobs.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">Nenhuma tarefa registrada.</p>
          ) : dados.cronJobs.map((c, i) => (
            <div key={c.name} className={`flex items-start gap-3 p-4 ${i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : ''}`}>
              <Clock size={15} className="text-slate-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{NOME_DO_CRON[c.name] ?? c.name}</p>
                <div className="flex flex-wrap gap-x-3 text-xs text-slate-500 mt-0.5">
                  <span>Última: {c.lastRun ? fmtDateTime(c.lastRun) : 'ainda não rodou desde o deploy'}</span>
                  <span>Próxima: {fmtDateTime(c.nextRun)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400">
          A última execução fica na memória do processo: zera a cada deploy, e com duas réplicas só uma executa cada disparo.
        </p>
      </Secao>
    </div>
  );
}
