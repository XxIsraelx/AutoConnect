'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Car, User, Plus, History, TrendingUp } from 'lucide-react';
import {
  DEAL_TRANSITIONS, PAYMENT_KINDS, formatarBRL, somar, subtrair,
  isDealEditable, type DealStatusValue, type PaymentKindValue,
} from '@autoconnect/shared';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import { useNegocio, useMargem, useTransicionar, useAdicionarPagamento } from '../dados';
import { ROTULO_STATUS, COR_STATUS, ROTULO_PAGAMENTO } from '../rotulos';

const VE_CUSTO = ['manager', 'tenant_admin', 'super_admin'];

export default function NegocioPage() {
  const { id } = useParams<{ id: string }>();
  const papel = useAuthStore((s) => s.user?.role) ?? '';
  const podeVerCusto = VE_CUSTO.includes(papel);

  const { data: negocio, isLoading, error, refetch, isFetching } = useNegocio(id);
  const { data: margem } = useMargem(id, podeVerCusto);
  const transicionar = useTransicionar(id);
  const adicionar = useAdicionarPagamento(id);

  const [motivo, setMotivo] = useState('');
  const [novoPagamento, setNovo] = useState<{ kind: PaymentKindValue; value: string }>({
    kind: 'cash', value: '',
  });

  if (error) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <ErroAoCarregar
          erro={error}
          onTentarNovamente={() => void refetch()}
          carregando={isFetching}
          contexto="o negócio"
        />
      </div>
    );
  }

  if (isLoading || !negocio) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
        ))}
      </div>
    );
  }

  const pagos = negocio.payments.filter((p) => p.status !== 'failed' && p.status !== 'refunded');
  const somaPagamentos = pagos.length ? somar(pagos.map((p) => p.value)) : '0.00';
  const falta = subtrair(negocio.saleValue, somaPagamentos);
  const fechado = Number(falta) === 0;
  const editavel = isDealEditable(negocio.status);

  /**
   * Os botões vêm da mesma tabela de transições que o backend usa. É por isso
   * que ela mora no `@autoconnect/shared`: uma segunda cópia aqui produziria
   * um botão que abre o diálogo e termina em 409.
   */
  const proximos = DEAL_TRANSITIONS[negocio.status];
  const exigeMotivo = (destino: DealStatusValue) =>
    destino === 'canceled' || destino === 'rescinded';

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <Link href="/negocios" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 mb-4">
        <ArrowLeft size={14} /> Todos os negócios
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">
              {negocio.vehicle.brand.name} {negocio.vehicle.model.name}
            </h1>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${COR_STATUS[negocio.status]}`}>
              {ROTULO_STATUS[negocio.status]}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {negocio.vehicle.versionName ?? ''} {negocio.vehicle.yearModel}
            {negocio.vehicle.licensePlate && ` · ${negocio.vehicle.licensePlate}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{formatarBRL(negocio.saleValue)}</p>
          {Number(negocio.discount) > 0 && (
            <p className="text-xs text-slate-400">
              {formatarBRL(negocio.listPrice)} − {formatarBRL(negocio.discount)}
            </p>
          )}
        </div>
      </div>

      {/* Ações de status */}
      {proximos.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 mb-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Próxima etapa
          </p>
          <div className="flex flex-wrap gap-2">
            {proximos.map((destino) => (
              <button
                key={destino}
                disabled={transicionar.isPending}
                onClick={() =>
                  transicionar.mutate({
                    to: destino,
                    reason: exigeMotivo(destino) ? motivo || undefined : undefined,
                  })
                }
                className={`text-sm px-3 py-1.5 rounded-lg font-medium transition disabled:opacity-50 ${
                  exigeMotivo(destino)
                    ? 'border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                    : 'bg-brand-accent text-white hover:bg-blue-600'
                }`}
              >
                {ROTULO_STATUS[destino]}
              </button>
            ))}
          </div>
          {proximos.some(exigeMotivo) && (
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (usado ao cancelar ou distratar)"
              className="mt-3 w-full text-sm bg-transparent border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2"
            />
          )}
          {transicionar.error && (
            <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
              {textoDoErro(transicionar.error)}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Pagamento */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Composição do pagamento
          </p>

          {pagos.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma forma de pagamento lançada.</p>
          ) : (
            <ul className="space-y-2 mb-3">
              {pagos.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span>
                    {ROTULO_PAGAMENTO[p.kind]}
                    {p.institution && <span className="text-slate-400"> · {p.institution}</span>}
                    {p.installments && <span className="text-slate-400"> · {p.installments}x</span>}
                  </span>
                  <span className="font-medium">{formatarBRL(p.value)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className={`flex items-center justify-between text-sm border-t pt-2 ${
            fechado
              ? 'border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400'
              : 'border-slate-200 dark:border-slate-800'
          }`}>
            <span className="font-medium">{fechado ? 'Fecha com a venda' : 'Falta lançar'}</span>
            <span className="font-bold">{fechado ? formatarBRL(somaPagamentos) : formatarBRL(falta)}</span>
          </div>

          {editavel && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!novoPagamento.value) return;
                adicionar.mutate(novoPagamento, {
                  onSuccess: () => setNovo({ kind: 'cash', value: '' }),
                });
              }}
            >
              <select
                value={novoPagamento.kind}
                onChange={(e) => setNovo({ ...novoPagamento, kind: e.target.value as PaymentKindValue })}
                className="text-sm bg-transparent border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5"
              >
                {PAYMENT_KINDS.map((k) => (
                  <option key={k} value={k}>{ROTULO_PAGAMENTO[k]}</option>
                ))}
              </select>
              <input
                value={novoPagamento.value}
                onChange={(e) => setNovo({ ...novoPagamento, value: e.target.value })}
                placeholder="0.00"
                inputMode="decimal"
                className="flex-1 min-w-0 text-sm bg-transparent border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1.5"
              />
              <button
                type="submit"
                disabled={adicionar.isPending}
                className="shrink-0 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50"
              >
                <Plus size={16} />
              </button>
            </form>
          )}
          {adicionar.error && (
            <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">
              {textoDoErro(adicionar.error)}
            </p>
          )}
        </div>

        {/* Margem — só manager+ */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <TrendingUp size={12} /> Margem
          </p>
          {!podeVerCusto ? (
            <p className="text-sm text-slate-500">
              O custo do veículo é visível para gerência.
            </p>
          ) : !margem ? (
            <p className="text-sm text-slate-500">Sem custo registrado para este veículo.</p>
          ) : (
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Venda</dt>
                <dd>{formatarBRL(margem.saleValue ?? '0.00')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Custo total</dt>
                <dd>−{formatarBRL(margem.totalCost)}</dd>
              </div>
              <div className="flex justify-between font-bold border-t border-slate-200 dark:border-slate-800 pt-1.5">
                <dt>Margem bruta</dt>
                <dd className={Number(margem.grossMargin ?? 0) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                  {formatarBRL(margem.grossMargin ?? '0.00')}
                </dd>
              </div>
              {margem.congelado && (
                <p className="text-[11px] text-slate-400 pt-1">
                  Congelada no faturamento — não acompanha custos lançados depois.
                </p>
              )}
            </dl>
          )}
        </div>

        {/* Partes */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Partes</p>
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <User size={14} className="text-slate-400" />
              {negocio.customer?.fullName ?? 'Sem cliente vinculado'}
            </p>
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
        </div>

        {/* Timeline */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <History size={12} /> Histórico
          </p>
          <ol className="space-y-2.5">
            {negocio.statusEvents.map((e) => (
              <li key={e.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span>
                    {e.fromStatus === e.toStatus
                      ? ROTULO_STATUS[e.toStatus]
                      : `${ROTULO_STATUS[e.fromStatus]} → ${ROTULO_STATUS[e.toStatus]}`}
                  </span>
                  <time className="text-[11px] text-slate-400 shrink-0">
                    {new Date(e.occurredAt).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </time>
                </div>
                <p className="text-[11px] text-slate-400">
                  {e.actor?.fullName ?? 'Sistema'}
                  {e.reason && ` · ${e.reason}`}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
