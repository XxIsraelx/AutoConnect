'use client';

import { startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';

/**
 * A página pública da loja é renderizada no servidor. Quando a API falha (rede
 * ou 5xx), `fetchDealer` lança em vez de responder "não encontrada" — e aqui o
 * visitante vê que foi uma falha, com a opção de tentar de novo.
 *
 * O erro original não é repassado: em produção o Next o substitui por uma
 * mensagem genérica em inglês, que não diria nada ao visitante.
 */
export default function Erro({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <ErroAoCarregar
        erro={new Error('O servidor falhou ao responder.')}
        onTentarNovamente={() => startTransition(() => { router.refresh(); reset(); })}
        contexto="a concessionária"
      />
    </div>
  );
}
