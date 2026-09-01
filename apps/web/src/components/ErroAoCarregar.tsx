'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';

/**
 * Estado de erro no carregamento de uma tela.
 *
 * Existe porque, antes, uma falha de API caía num `catch { /* ignora *\/ }` e a
 * tela renderizava o mesmo vazio de "não há dados". O usuário concluía que não
 * tinha registro nenhum e ia embora — sem recarregar, sem reportar. Em
 * /agendamentos isso é pior: parece que não há test drive marcado.
 */
export function ErroAoCarregar({
  mensagem,
  onTentarNovamente,
  carregando = false,
}: {
  mensagem: string;
  onTentarNovamente: () => void;
  carregando?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
      <div className="w-11 h-11 rounded-full bg-rose-100 dark:bg-rose-500/15
                      flex items-center justify-center">
        <AlertCircle size={20} className="text-rose-600 dark:text-rose-400" />
      </div>

      <div>
        <p className="text-sm font-medium">Não foi possível carregar</p>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">{mensagem}</p>
      </div>

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
    </div>
  );
}

/**
 * Traduz a falha para algo acionável. O 401 é tratado à parte por quem chama:
 * sessão expirada se resolve voltando ao login, não insistindo no botão.
 */
export function mensagemDeErro(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return 'Sua sessão expirou. Entre novamente.';
  if (status === 404) return 'Recurso não encontrado no servidor.';
  if (status && status >= 500) return 'O servidor falhou ao responder. Tente novamente em instantes.';
  if (err instanceof TypeError) return 'Sem conexão com o servidor. Verifique sua internet.';
  return (err as Error)?.message || 'Erro inesperado ao buscar os dados.';
}
