'use client';

import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { usePush } from '@/lib/push';

/**
 * O cartão de notificações em Canais: é por aqui que o vendedor liga o aviso
 * de lead novo e de mensagem do cliente no próprio celular.
 */
export function NotificacoesDoAparelho({ token }: { token: string }) {
  const { estado, ocupado, erro, ativar, desativar, testar } = usePush(token);

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="flex items-center gap-2.5 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <div className="w-7 h-7 rounded-lg bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center">
          <BellRing size={14} className="text-violet-600 dark:text-violet-400" />
        </div>
        <h2 className="font-semibold txt-forte text-sm">Notificações neste aparelho</h2>
      </div>
      <div className="p-6 space-y-3 text-sm txt-medio">
        <p>
          O lead novo do rodízio e a mensagem do cliente chegam como notificação, mesmo com o
          AutoConnect fechado — no pátio, no test drive ou fora da loja. Ative em cada aparelho que você usa.
        </p>

        {estado === 'carregando' && <Loader2 size={18} className="animate-spin text-slate-400" />}

        {estado === 'indisponivel' && (
          <p className="txt-fraco">As notificações ainda não estão ligadas neste servidor.</p>
        )}

        {estado === 'sem-suporte' && (
          <p className="txt-fraco">Este navegador não recebe notificações. No celular, use o Chrome (Android) ou o app na tela inicial (iPhone).</p>
        )}

        {estado === 'iphone-sem-app' && (
          <div className="rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-800">
            <p className="font-medium txt-forte">No iPhone, a notificação só chega com o AutoConnect na tela inicial.</p>
            <p className="text-xs txt-fraco mt-1">
              No Safari, toque em Compartilhar › Adicionar à Tela de Início, abra o AutoConnect por lá e volte
              aqui para ativar. Funciona a partir do iOS 16.4.
            </p>
          </div>
        )}

        {estado === 'bloqueado' && (
          <p className="rounded-xl px-3 py-2 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            As notificações estão bloqueadas para este site. Libere nas configurações do navegador (o cadeado ao
            lado do endereço) e recarregue a página.
          </p>
        )}

        {estado === 'desativado' && (
          <button onClick={ativar} disabled={ocupado}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition">
            {ocupado ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />} Ativar neste aparelho
          </button>
        )}

        {estado === 'ativado' && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
              <BellRing size={14} /> Ativas neste aparelho
            </span>
            <button onClick={testar} disabled={ocupado} className="text-xs font-semibold text-violet-600 dark:text-violet-400 hover:underline disabled:opacity-50">
              Enviar um teste
            </button>
            <button onClick={desativar} disabled={ocupado} className="inline-flex items-center gap-1 text-xs txt-fraco hover:text-rose-600 disabled:opacity-50">
              <BellOff size={12} /> Desativar
            </button>
          </div>
        )}

        {erro && <p role="alert" className="text-rose-600 dark:text-rose-400">{erro}</p>}
      </div>
    </section>
  );
}
