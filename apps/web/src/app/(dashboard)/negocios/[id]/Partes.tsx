'use client';

import { useState } from 'react';
import Link from 'next/link';
import { User, Car, Search, X, Loader2 } from 'lucide-react';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { useClientesRelacionados, useVincularCliente, type DealResumo } from '../dados';

/**
 * Partes do negócio, com o vínculo do cliente.
 *
 * O cliente não é digitado à mão: escolhe-se entre quem já se relacionou com a
 * loja. Um nome digitado viraria texto solto, sem ligação com a conta do
 * comprador — e o contrato precisa da pessoa, não da string.
 */
export default function Partes({
  negocio, editavel,
}: {
  negocio: DealResumo;
  editavel: boolean;
}) {
  const [buscando, setBuscando] = useState(false);
  const [termo, setTermo] = useState('');

  const { data: clientes, isLoading } = useClientesRelacionados(termo, buscando);
  const vincular = useVincularCliente(negocio.id);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Partes</p>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            <User size={14} className="text-slate-400 shrink-0" />
            {negocio.customer ? (
              <span className="truncate">
                {negocio.customer.fullName}
                <span className="text-slate-400"> · {negocio.customer.email}</span>
              </span>
            ) : (
              <span className="text-slate-500">Sem cliente vinculado</span>
            )}
          </span>

          {editavel && (
            negocio.customer ? (
              <button
                type="button"
                onClick={() => vincular.mutate(null)}
                disabled={vincular.isPending}
                className="shrink-0 text-xs text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
              >
                remover
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setBuscando((v) => !v)}
                className="shrink-0 text-xs text-brand-accent inline-flex items-center gap-1"
              >
                {buscando ? <X size={11} /> : <Search size={11} />}
                {buscando ? 'fechar' : 'vincular'}
              </button>
            )
          )}
        </div>

        {buscando && !negocio.customer && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2">
            <input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Buscar por nome ou e-mail"
              autoFocus
              className="w-full text-sm bg-transparent border border-slate-200 dark:border-slate-800
                         rounded-lg px-2.5 py-1.5 mb-2"
            />
            {isLoading ? (
              <p className="text-xs text-slate-400 px-1 py-2">
                <Loader2 size={11} className="animate-spin inline mr-1" /> buscando…
              </p>
            ) : !clientes?.length ? (
              <p className="text-xs text-slate-500 px-1 py-2">
                Nenhum cliente encontrado. Só aparecem aqui pessoas que já têm
                lead, agendamento ou conversa com esta loja.
              </p>
            ) : (
              <ul className="max-h-48 overflow-y-auto">
                {clientes.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() =>
                        vincular.mutate(c.id, { onSuccess: () => { setBuscando(false); setTermo(''); } })
                      }
                      disabled={vincular.isPending}
                      className="w-full text-left px-2 py-1.5 rounded-lg text-sm
                                 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50"
                    >
                      {c.fullName}
                      <span className="block text-xs text-slate-400">{c.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="flex items-center gap-2">
          <User size={14} className="text-slate-400" />
          {negocio.salesperson?.fullName ?? 'Sem vendedor'}
        </p>
        <Link
          href={`/veiculos/${negocio.vehicle.id}`}
          className="flex items-center gap-2 text-brand-accent hover:underline"
        >
          <Car size={14} /> Ver veículo
        </Link>
      </div>

      {vincular.error && (
        <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">
          {textoDoErro(vincular.error)}
        </p>
      )}
    </div>
  );
}
