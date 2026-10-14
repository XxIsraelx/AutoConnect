'use client';

import { useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import {
  PAPEIS_DA_CHAVE, erroDaAcao, useCredencialDaIntegradora, useGuardarCredencial, useRevogarCredencial,
} from './dados';

const dataCurta = (d: string) => new Date(d).toLocaleDateString('pt-BR');

/**
 * A chave de API da loja na integradora RENAVE, em Configurações.
 *
 * A loja contrata e paga a integradora (decisão de 14/10/2026), então o envio
 * sai com a chave **dela**. A chave entra aqui, é conferida na integradora,
 * guardada cifrada, e não volta para a tela — nem para o dono: depois de salva,
 * só os 4 últimos caracteres ([decisão do cofre](docs/decisoes/2026-10-14 cofre
 * de credenciais por loja.md)).
 *
 * Some da tela quando não há integradora que exija chave da loja — que é o
 * estado da produção enquanto o adaptador real (R3) não existe.
 */
export default function CredencialDaIntegradora() {
  const papel = useAuthStore((s) => s.user?.role) ?? '';
  const podeAlterar = PAPEIS_DA_CHAVE.includes(papel);
  const { data, isLoading, error, refetch, isFetching } = useCredencialDaIntegradora();
  const guardar = useGuardarCredencial();
  const revogar = useRevogarCredencial();
  const [chave, setChave] = useState('');
  const [trocando, setTrocando] = useState(false);

  if (isLoading) return null;
  if (error) {
    return (
      <ErroAoCarregar erro={error} onTentarNovamente={() => void refetch()} carregando={isFetching}
        contexto="a chave da integradora" />
    );
  }
  if (!data?.exigida) return null;

  const c = data.credencial;
  const campo =
    'flex-1 min-w-0 text-sm bg-transparent border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 font-mono';
  const botao = 'text-sm px-3 py-2 rounded-lg font-medium transition disabled:opacity-50 inline-flex items-center gap-1.5';

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="flex items-center gap-2.5 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
          <KeyRound size={14} className="text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="font-semibold text-slate-900 dark:text-white text-sm">Integradora RENAVE</h2>
      </div>
      <div className="p-6 space-y-3 text-sm">
        <p className="text-slate-600 dark:text-slate-300">
          Para o AutoConnect enviar entradas e saídas ao RENAVE em nome da loja, cole aqui a chave de API
          que a sua integradora ({data.fornecedor}) gerou. Cada envio é cobrado pela integradora na conta da loja.
        </p>

        {c && !trocando ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
            <span>
              Chave cadastrada: <span className="font-mono">••••{c.ultimos4}</span>
              <span className="text-xs text-slate-400"> · em {dataCurta(c.cadastradaEm)}</span>
            </span>
            {podeAlterar && (
              <span className="flex gap-3">
                <button type="button" className="text-xs text-brand-accent hover:underline" onClick={() => setTrocando(true)}>
                  trocar
                </button>
                <button
                  type="button" className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
                  disabled={revogar.isPending} onClick={() => revogar.mutate()}
                >
                  revogar
                </button>
              </span>
            )}
          </div>
        ) : podeAlterar ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={chave} onChange={(e) => setChave(e.target.value)} type="password" autoComplete="off"
              placeholder="Chave de API da integradora" className={campo}
            />
            <button
              type="button" disabled={guardar.isPending || chave.trim().length < 8}
              onClick={() => guardar.mutate(chave.trim(), {
                // A chave sai do estado da tela assim que vai para a API.
                onSettled: () => setChave(''),
                onSuccess: () => setTrocando(false),
              })}
              className={`${botao} bg-brand-accent text-white hover:bg-blue-600`}
            >
              {guardar.isPending && <Loader2 size={14} className="animate-spin" />}
              Conferir e salvar
            </button>
            {trocando && (
              <button type="button" onClick={() => setTrocando(false)} className={`${botao} text-slate-500`}>Cancelar</button>
            )}
          </div>
        ) : (
          <p className="text-amber-700 dark:text-amber-400">
            Nenhuma chave cadastrada. Só o administrador da loja pode cadastrar.
          </p>
        )}

        <p className="text-xs text-slate-400 flex items-start gap-1.5">
          <ShieldCheck size={12} className="shrink-0 mt-0.5" />
          A chave é conferida na integradora e guardada cifrada. Depois de salva, ninguém a vê de novo — nem o administrador.
        </p>
        {data.cofre === false && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            O cofre de credenciais não está configurado nesta instalação. Fale com o suporte do AutoConnect.
          </p>
        )}
        {(guardar.error || revogar.error) && (
          <p className="text-sm text-rose-600 dark:text-rose-400">{erroDaAcao(guardar.error ?? revogar.error)}</p>
        )}
      </div>
    </section>
  );
}
