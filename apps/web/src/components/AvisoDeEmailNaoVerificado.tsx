'use client';

import { useEffect, useState } from 'react';
import { MailWarning, Loader2, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

/**
 * Faixa "confirme seu e-mail" do painel da concessionária.
 *
 * ## Por que ela existe
 *
 * Desde que o cadastro passou a ser em autosserviço (25/09/2026), a loja nasce
 * com o e-mail **por confirmar** e entra no painel na hora — barrar o primeiro
 * acesso seria a mesma porta na cara que a decisão veio derrubar, e num
 * ambiente sem provedor de e-mail o link nem chega. Duas ações, porém, exigem a
 * confirmação (`EmailVerificadoGuard` na API): **convidar equipe** e **publicar
 * anúncio**, as duas que falam com terceiros em nome da loja.
 *
 * Esta faixa é o que torna isso previsível: o dono descobre o que falta antes
 * de bater no 403, e tem o botão de reenviar ali mesmo — a tela do consumidor
 * final não tinha, e quem não recebia o e-mail só podia se cadastrar de novo,
 * com um endereço que já estava em uso.
 *
 * ## Por que consulta o servidor
 *
 * O estado guardado no `localStorage` envelhece no instante em que a pessoa
 * clica no link numa outra aba. `GET /users/me` dá a resposta atual e atualiza
 * o store, para o resto do painel não continuar mostrando o aviso.
 */
export default function AvisoDeEmailNaoVerificado() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);

  const [verificado, setVerificado] = useState<boolean | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    // O `api()` não lê o store sozinho: sem passar o token aqui, a chamada sai
    // sem `Authorization`, volta 401 e a faixa some justamente para quem ela
    // existe — o dono recém-cadastrado, que é quem nunca verificou o e-mail.
    api<{ emailVerifiedAt: string | null }>('/users/me', { token })
      .then((me) => {
        if (!vivo) return;
        const ok = Boolean(me.emailVerifiedAt);
        setVerificado(ok);
        updateUser({ emailVerified: ok });
      })
      // Falha ao ler o próprio perfil não pode inventar um aviso: sem resposta,
      // a faixa some e cada tela mostra o próprio erro de carga. Errar para o
      // lado de não avisar é melhor que acusar de não verificado quem já está.
      .catch(() => { if (vivo) setVerificado(true); });
    return () => { vivo = false; };
  }, [token, updateUser]);

  if (verificado !== false || !user?.email) return null;

  async function reenviar() {
    if (!user?.email) return;
    setEnviando(true);
    setErro('');
    try {
      await api('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email: user.email }),
      });
      setEnviado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível reenviar agora.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b text-sm
                    bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800
                    text-amber-800 dark:text-amber-200">
      <MailWarning size={15} className="shrink-0" />
      <span className="flex-1 min-w-[12rem]">
        Confirme seu e-mail (<strong className="font-semibold break-all">{user.email}</strong>) para
        publicar anúncios e convidar sua equipe. O resto do painel já está liberado.
      </span>
      {enviado ? (
        <span className="flex items-center gap-1.5 text-xs font-medium shrink-0">
          <Check size={13} /> Link reenviado — confira a caixa de entrada e o spam.
        </span>
      ) : (
        <button
          onClick={reenviar}
          disabled={enviando}
          className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg
                     border border-amber-300 dark:border-amber-700 hover:bg-amber-100
                     dark:hover:bg-amber-900/40 transition disabled:opacity-50"
        >
          {enviando ? <><Loader2 size={12} className="animate-spin" /> Enviando…</> : 'Reenviar e-mail'}
        </button>
      )}
      {erro && <span className="w-full text-xs text-red-600 dark:text-red-400">{erro}</span>}
    </div>
  );
}
