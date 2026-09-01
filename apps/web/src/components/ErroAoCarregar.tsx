'use client';

import Link from 'next/link';
import { AlertCircle, RefreshCw, Lock, LogIn } from 'lucide-react';
import { ApiError } from '@/lib/api';

const SUPORTE = 'contato@autoconnect.app';

/**
 * Estado de erro no carregamento de uma tela.
 *
 * Existe porque antes uma falha de API caía num `catch { /* ignora *\/ }` e a
 * tela renderizava o mesmo vazio de "não há dados" — o usuário concluía que
 * não tinha registro nenhum e ia embora.
 *
 * Cada causa pede uma ação diferente, e é por isso que o componente recebe o
 * erro em vez de só um texto:
 *
 *  - 403: está logado, mas o cargo não dá acesso. Tentar de novo ou refazer o
 *    login não muda nada — quem resolve é o administrador da concessionária.
 *  - 401: a sessão caiu. Entrar de novo resolve, mas com um clique consciente;
 *    redirecionar sozinho parece que o app "expulsou" a pessoa sem explicação.
 *  - demais: pode ser transitório. Vale tentar de novo, e só então acionar o
 *    suporte do AutoConnect.
 */
export function ErroAoCarregar({
  erro,
  onTentarNovamente,
  carregando = false,
  contexto,
}: {
  erro: unknown;
  onTentarNovamente: () => void;
  carregando?: boolean;
  /** Ex.: "a equipe" — entra na frase "Não foi possível carregar a equipe". */
  contexto?: string;
}) {
  const status = erro instanceof ApiError ? erro.status : undefined;
  const semPermissao = status === 403;
  const sessaoExpirada = status === 401;

  const titulo = semPermissao
    ? 'Acesso não permitido'
    : sessaoExpirada
      ? 'Sua sessão expirou'
      : `Não foi possível carregar${contexto ? ` ${contexto}` : ''}`;

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
      <div className={`w-11 h-11 rounded-full flex items-center justify-center ${
        semPermissao
          ? 'bg-amber-100 dark:bg-amber-500/15'
          : 'bg-rose-100 dark:bg-rose-500/15'
      }`}>
        {semPermissao
          ? <Lock size={20} className="text-amber-600 dark:text-amber-400" />
          : <AlertCircle size={20} className="text-rose-600 dark:text-rose-400" />}
      </div>

      <div className="max-w-sm">
        <p className="text-sm font-medium">{titulo}</p>
        <p className="text-xs text-slate-500 mt-1">{textoDoErro(erro)}</p>
      </div>

      {semPermissao ? null : sessaoExpirada ? (
        <Link
          href="/login"
          className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm
                     font-medium bg-blue-600 text-white hover:bg-blue-700 transition"
        >
          <LogIn size={14} />
          Entrar novamente
        </Link>
      ) : (
        <>
          <button
            onClick={onTentarNovamente}
            disabled={carregando}
            className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm
                       font-medium bg-blue-600 text-white hover:bg-blue-700
                       disabled:opacity-50 transition"
          >
            <RefreshCw size={14} className={carregando ? 'animate-spin' : undefined} />
            Tentar novamente
          </button>
          <p className="text-xs text-slate-400">
            Se o problema continuar,{' '}
            <a href={`mailto:${SUPORTE}`} className="text-blue-500 hover:underline">
              fale com a equipe do AutoConnect
            </a>
            .
          </p>
        </>
      )}
    </div>
  );
}

/** Explica a causa em português, e para 403 diz a quem recorrer. */
export function textoDoErro(err: unknown): string {
  const status = err instanceof ApiError ? err.status : undefined;

  if (status === 403) {
    return 'Seu usuário não tem permissão para ver esta área. Peça ao administrador da sua concessionária para revisar seu cargo.';
  }
  if (status === 401) return 'Entre novamente para continuar de onde parou.';
  if (status === 404) return 'O recurso não foi encontrado no servidor.';
  if (status && status >= 500) return 'O servidor falhou ao responder.';
  if (err instanceof TypeError) return 'Não conseguimos falar com o servidor. Verifique sua conexão.';
  return (err as Error)?.message || 'Erro inesperado ao buscar os dados.';
}
