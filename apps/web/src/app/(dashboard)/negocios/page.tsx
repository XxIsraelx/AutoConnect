'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Handshake, Plus, Filter } from 'lucide-react';
import { DEAL_STATUSES, formatarBRL, somar, type DealStatusValue } from '@autoconnect/shared';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import { useNegocios, type DealResumo } from './dados';
import { ROTULO_STATUS, COR_STATUS, ETAPAS_FUNIL } from './rotulos';

/** Soma exata dos valores de venda. Nunca `reduce` com `Number`. */
function totalDe(negocios: DealResumo[]): string {
  return negocios.length ? somar(negocios.map((n) => n.saleValue)) : '0.00';
}

export default function NegociosPage() {
  const [status, setStatus] = useState<DealStatusValue | ''>('');
  const { data, isLoading, error, refetch, isFetching } = useNegocios({ status });

  const itens = useMemo(() => data?.itens ?? [], [data]);

  /**
   * O funil é de **valor**, não de contagem: cinco negócios de R$ 20 mil não
   * são o mesmo que um de R$ 300 mil, e é a segunda informação que decide onde
   * o gerente põe atenção.
   */
  const funil = useMemo(
    () =>
      ETAPAS_FUNIL.map((etapa) => {
        const doEstagio = itens.filter((n) => n.status === etapa);
        return { etapa, quantidade: doEstagio.length, valor: totalDe(doEstagio) };
      }).filter((e) => e.quantidade > 0),
    [itens],
  );

  const emAberto = useMemo(
    () => itens.filter((n) => !['canceled', 'rescinded', 'delivered'].includes(n.status)),
    [itens],
  );

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Negócios</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isLoading ? 'Carregando…' : `${data?.total ?? 0} no total`}
          </p>
        </div>
        <Link
          href="/veiculos"
          className="inline-flex items-center gap-2 text-sm bg-brand-accent text-white
                     px-4 py-2 rounded-lg font-medium hover:bg-blue-600 transition"
        >
          <Plus size={16} />
          Abrir a partir de um veículo
        </Link>
      </div>

      {error ? (
        <ErroAoCarregar
          erro={error}
          onTentarNovamente={() => void refetch()}
          carregando={isFetching}
          contexto="os negócios"
        />
      ) : (
        <>
          {/* Funil de valor */}
          {funil.length > 0 && (
            <div className="grid gap-3 mb-6 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-blue-50 dark:bg-blue-950/30 p-3">
                <p className="text-xs text-slate-500">Em aberto</p>
                <p className="text-lg font-bold mt-0.5">{formatarBRL(totalDe(emAberto))}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{emAberto.length} negócios</p>
              </div>
              {funil.map(({ etapa, quantidade, valor }) => (
                <button
                  key={etapa}
                  onClick={() => setStatus(status === etapa ? '' : etapa)}
                  className={`text-left rounded-xl border p-3 transition ${
                    status === etapa
                      ? 'border-brand-accent ring-1 ring-brand-accent'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <p className="text-xs text-slate-500 truncate">{ROTULO_STATUS[etapa]}</p>
                  <p className="text-lg font-bold mt-0.5">{formatarBRL(valor)}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{quantidade} negócios</p>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mb-4">
            <Filter size={14} className="text-slate-400" />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as DealStatusValue | '')}
              className="text-sm bg-transparent border border-slate-200 dark:border-slate-800
                         rounded-lg px-2.5 py-1.5"
            >
              <option value="">Todos os status</option>
              {DEAL_STATUSES.map((s) => (
                <option key={s} value={s}>{ROTULO_STATUS[s]}</option>
              ))}
            </select>
            {isFetching && <span className="text-xs text-slate-400">atualizando…</span>}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
              ))}
            </div>
          ) : itens.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              <Handshake size={32} className="mx-auto text-slate-300 dark:text-slate-700" />
              <p className="mt-3 font-medium">Nenhum negócio {status && 'neste status'}</p>
              <p className="text-sm text-slate-500 mt-1">
                Um negócio começa na página do veículo, em <strong>Estoque →
                abrir o carro → Negócio</strong>.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {itens.map((n) => (
                <Link
                  key={n.id}
                  href={`/negocios/${n.id}`}
                  className="block rounded-xl border border-slate-200 dark:border-slate-800 p-4
                             hover:border-slate-300 dark:hover:border-slate-700 transition"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold truncate">
                          {n.vehicle.brand.name} {n.vehicle.model.name}
                        </span>
                        <span className="text-xs text-slate-400">{n.vehicle.yearModel}</span>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${COR_STATUS[n.status]}`}>
                          {ROTULO_STATUS[n.status]}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {n.customer?.fullName ?? 'Sem cliente vinculado'}
                        {n.salesperson && ` · ${n.salesperson.fullName}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold">{formatarBRL(n.saleValue)}</p>
                      {Number(n.discount) > 0 && (
                        <p className="text-[11px] text-slate-400">
                          tabela {formatarBRL(n.listPrice)}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
