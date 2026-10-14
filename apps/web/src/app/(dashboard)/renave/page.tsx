'use client';

import PendenciasRenave from '@/components/renave/PendenciasRenave';

/** Pendências RENAVE da loja. A API recusa o vendedor; o menu não o mostra. */
export default function RenavePage() {
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-1">RENAVE</h1>
      <p className="text-sm text-slate-500 mb-6">
        O que falta registrar na sua integradora: entradas, saídas e notas fiscais.
      </p>
      <PendenciasRenave />
    </div>
  );
}
