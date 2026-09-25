'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock, TimerReset } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { SituacaoDeCobranca } from '@autoconnect/shared';

interface Resumo {
  situacao: SituacaoDeCobranca;
  somenteLeitura: boolean;
  aviso: string | null;
}

/** Quanto tempo a faixa espera antes de reperguntar. */
const INTERVALO_MS = 5 * 60_000;

/**
 * Faixa de aviso de assinatura no painel da concessionária.
 *
 * ## Por que ela existe
 *
 * A partir da Onda 3 a loja entra em **somente leitura** quando o teste acaba
 * ou a fatura passa da carência — continua vendo e exportando tudo, mas não
 * cria nem edita. Descobrir isso só quando um "Salvar" devolve 402 é a pior
 * forma possível de saber: a pessoa perdeu o que digitou e não sabe por quê.
 *
 * Esta faixa avisa antes: três dias antes do fim do teste, no dia, e a cada
 * vencimento — os mesmos marcos do e-mail que o cron manda, pelo mesmo
 * veredito (`avaliarCobranca`, no shared). Tela e API dizendo coisas
 * diferentes sobre o bloqueio é o defeito que este compartilhamento evita.
 *
 * ## Por que só `tenant_admin` vê
 *
 * `GET /cobranca` é restrito a quem responde pela empresa. Para gerente e
 * vendedor a chamada volta 403 e a faixa some — mostrar "sua loja está
 * bloqueada, pague" a quem não pode pagar é ansiedade sem saída.
 */
export default function AvisoDeCobranca() {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();

  const [resumo, setResumo] = useState<Resumo | null>(null);

  const ehAdmin = user?.role === 'tenant_admin';

  useEffect(() => {
    if (!token || !ehAdmin) return;
    let vivo = true;

    const buscar = () => {
      api<Resumo>('/cobranca', { token })
        .then((r) => { if (vivo) setResumo(r); })
        // Silencioso de propósito: sem resposta, a faixa some e cada tela
        // mostra o próprio erro. Errar para o lado de não avisar é melhor que
        // anunciar um bloqueio que talvez não exista.
        .catch(() => { if (vivo) setResumo(null); });
    };

    buscar();
    const t = setInterval(buscar, INTERVALO_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [token, ehAdmin, pathname]);

  if (!resumo?.aviso) return null;
  // Na própria tela de plano a faixa seria eco: a tela inteira já é sobre isso.
  if (pathname?.startsWith('/configuracoes/plano')) return null;

  const grave = resumo.somenteLeitura;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b text-sm ${
      grave
        ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
        : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
    }`}>
      {grave ? <Lock size={15} className="shrink-0" /> : <TimerReset size={15} className="shrink-0" />}
      <span className="flex-1 min-w-[12rem]">{resumo.aviso}</span>
      <Link
        href="/configuracoes/plano"
        className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${
          grave
            ? 'border-rose-300 dark:border-rose-700 hover:bg-rose-100 dark:hover:bg-rose-900/40'
            : 'border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40'
        }`}
      >
        Ver planos
      </Link>
    </div>
  );
}
