'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Plus, Clock } from 'lucide-react';
import {
  ACQUISITION_ORIGINS, VEHICLE_COST_KINDS, formatarBRL,
  type AcquisitionOriginValue, type VehicleCostKindValue,
} from '@autoconnect/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';

const ROTULO_ORIGEM: Record<AcquisitionOriginValue, string> = {
  direct_purchase: 'Compra direta',
  trade_in: 'Troca',
  consignment: 'Consignado',
  dealer_transfer: 'Transferência entre lojas',
  auction: 'Leilão',
  factory: 'Fábrica',
};

const ROTULO_CUSTO: Record<VehicleCostKindValue, string> = {
  preparation: 'Preparação',
  mechanical: 'Mecânica',
  bodywork: 'Funilaria',
  documentation: 'Documentação',
  transport: 'Transporte',
  commission: 'Comissão',
  other: 'Outro',
};

interface Custo {
  vehicleId: string;
  acquisition: {
    origin: AcquisitionOriginValue;
    supplierName: string | null;
    purchaseValue: string;
    enteredAt: string;
  } | null;
  costs: {
    id: string; kind: VehicleCostKindValue; value: string;
    description: string | null; incurredAt: string;
  }[];
  purchaseValue: string;
  costsTotal: string;
  totalCost: string;
  listPrice: string;
  daysInStock: number;
}

const VE_CUSTO = ['manager', 'tenant_admin', 'super_admin'];

/**
 * Custo do veículo: aquisição, preparação, total e dias em estoque.
 *
 * É a informação que faltava para responder "esse carro deu lucro?" — e é
 * restrita a gerência, como a margem, porque custo de aquisição é o que a
 * maioria das lojas não mostra ao vendedor.
 */
export default function CustoDoVeiculo({ vehicleId }: { vehicleId: string }) {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const papel = useAuthStore((s) => s.user?.role) ?? '';
  const podeVer = VE_CUSTO.includes(papel);
  const qc = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['veiculo-custo', vehicleId],
    queryFn: () => api<Custo>(`/vehicles/${vehicleId}/costs`, { token }),
    enabled: Boolean(token && vehicleId && podeVer),
    retry: false,
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['veiculo-custo', vehicleId] });
    // A margem de qualquer negócio deste carro muda junto.
    qc.invalidateQueries({ queryKey: ['negocio-margem'] });
  };

  const salvarAquisicao = useMutation({
    mutationFn: (v: { origin: AcquisitionOriginValue; purchaseValue: string; enteredAt: string }) =>
      api(`/vehicles/${vehicleId}/acquisition`, { method: 'POST', token, body: v }),
    onSuccess: invalidar,
  });

  const lancarCusto = useMutation({
    mutationFn: (v: { kind: VehicleCostKindValue; value: string; incurredAt: string; description?: string }) =>
      api(`/vehicles/${vehicleId}/costs`, { method: 'POST', token, body: v }),
    onSuccess: invalidar,
  });

  const [aquisicao, setAquisicao] = useState({
    origin: 'direct_purchase' as AcquisitionOriginValue,
    purchaseValue: '',
    enteredAt: new Date().toISOString().slice(0, 10),
  });
  const [custo, setCusto] = useState({
    kind: 'preparation' as VehicleCostKindValue,
    value: '',
    description: '',
  });

  if (!podeVer) return null;

  const lancar = () => {
    if (!custo.value) return;
    lancarCusto.mutate(
      {
        kind: custo.kind,
        value: custo.value,
        description: custo.description || undefined,
        incurredAt: new Date().toISOString(),
      },
      { onSuccess: () => setCusto({ kind: 'preparation', value: '', description: '' }) },
    );
  };

  /*
   * Sem <form> aqui de propósito: esta seção é montada dentro do formulário de
   * edição do veículo, e <form> aninhado é HTML inválido — o navegador descarta
   * o interno e o botão passa a submeter o de fora, recarregando a página sem
   * gravar nada. Foi exatamente o que aconteceu antes desta correção.
   */
  const campo =
    'text-sm bg-transparent border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5';

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
      <h2 className="font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
        <Wallet size={16} className="text-slate-400" />
        Custo do veículo
      </h2>

      {error ? (
        <ErroAoCarregar
          erro={error}
          onTentarNovamente={() => void refetch()}
          carregando={isFetching}
          contexto="o custo do veículo"
        />
      ) : isLoading ? (
        <div className="h-24 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              ['Aquisição', formatarBRL(data.purchaseValue)],
              ['Preparação', formatarBRL(data.costsTotal)],
              ['Custo total', formatarBRL(data.totalCost)],
            ].map(([rotulo, valor]) => (
              <div key={rotulo}>
                <p className="text-xs text-slate-500">{rotulo}</p>
                <p className="font-bold mt-0.5">{valor}</p>
              </div>
            ))}
            <div>
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <Clock size={11} /> Em estoque
              </p>
              <p
                className={`font-bold mt-0.5 ${
                  data.daysInStock >= 90
                    ? 'text-rose-600 dark:text-rose-400'
                    : data.daysInStock >= 60
                      ? 'text-amber-600 dark:text-amber-400'
                      : ''
                }`}
              >
                {data.daysInStock} dias
              </p>
            </div>
          </div>

          {/* Aquisição */}
          {data.acquisition ? (
            <p className="text-sm text-slate-500 mb-4">
              {ROTULO_ORIGEM[data.acquisition.origin]}
              {data.acquisition.supplierName && ` · ${data.acquisition.supplierName}`}
              {' · entrou em '}
              {new Date(data.acquisition.enteredAt).toLocaleDateString('pt-BR')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-4 items-end">
              <div className="w-full">
                {/* Sem aquisição não há custo conhecido, e o total acima seria
                    zero — o que faria a margem parecer a venda inteira. */}
                <p className="text-sm text-amber-600 dark:text-amber-400 mb-2">
                  Sem aquisição registrada, a margem deste carro não pode ser calculada.
                </p>
              </div>
              <select
                value={aquisicao.origin}
                onChange={(e) => setAquisicao({ ...aquisicao, origin: e.target.value as AcquisitionOriginValue })}
                className={campo}
              >
                {ACQUISITION_ORIGINS.map((o) => (
                  <option key={o} value={o}>{ROTULO_ORIGEM[o]}</option>
                ))}
              </select>
              <input
                value={aquisicao.purchaseValue}
                onChange={(e) => setAquisicao({ ...aquisicao, purchaseValue: e.target.value })}
                placeholder="Valor de compra"
                inputMode="decimal"
                className={campo}
              />
              <input
                type="date"
                value={aquisicao.enteredAt}
                onChange={(e) => setAquisicao({ ...aquisicao, enteredAt: e.target.value })}
                className={campo}
              />
              <button
                type="button"
                onClick={() => {
                  if (!aquisicao.purchaseValue) return;
                  salvarAquisicao.mutate({
                    ...aquisicao,
                    enteredAt: new Date(aquisicao.enteredAt).toISOString(),
                  });
                }}
                disabled={salvarAquisicao.isPending}
                className="text-sm bg-brand-accent text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-600 transition disabled:opacity-50"
              >
                Registrar aquisição
              </button>
            </div>
          )}
          {salvarAquisicao.error && (
            <p className="text-sm text-rose-600 dark:text-rose-400 mb-3">
              {textoDoErro(salvarAquisicao.error)}
            </p>
          )}

          {/* Lançamentos */}
          {data.costs.length > 0 && (
            <ul className="space-y-1.5 mb-4">
              {data.costs.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <span>
                    {ROTULO_CUSTO[c.kind]}
                    {c.description && <span className="text-slate-400"> · {c.description}</span>}
                    <span className="text-slate-400">
                      {' · '}
                      {new Date(c.incurredAt).toLocaleDateString('pt-BR')}
                    </span>
                  </span>
                  <span className="font-medium">{formatarBRL(c.value)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <select
              value={custo.kind}
              onChange={(e) => setCusto({ ...custo, kind: e.target.value as VehicleCostKindValue })}
              className={campo}
            >
              {VEHICLE_COST_KINDS.map((k) => (
                <option key={k} value={k}>{ROTULO_CUSTO[k]}</option>
              ))}
            </select>
            <input
              value={custo.description}
              onChange={(e) => setCusto({ ...custo, description: e.target.value })}
              placeholder="Descrição (opcional)"
              className={`${campo} flex-1 min-w-[8rem]`}
            />
            <input
              value={custo.value}
              onChange={(e) => setCusto({ ...custo, value: e.target.value })}
              placeholder="0.00"
              inputMode="decimal"
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); lancar(); }
              }}
              className={`${campo} w-28`}
            />
            <button
              type="button"
              onClick={lancar}
              disabled={lancarCusto.isPending}
              className="shrink-0 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50"
            >
              <Plus size={16} />
            </button>
          </div>
          {lancarCusto.error && (
            <p className="text-sm text-rose-600 dark:text-rose-400 mt-2">
              {textoDoErro(lancarCusto.error)}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
