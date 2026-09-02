'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { DealStatusValue, PaymentKindValue } from '@autoconnect/shared';

/**
 * Camada de dados de `/negocios`.
 *
 * Aqui é TanStack Query, e não `useEffect` + `api()` como nas telas antigas:
 * são telas de dinheiro, onde um cache que não invalida mostra a margem errada
 * depois de um lançamento de custo. Cada mutação declara o que invalida.
 */

export interface DealResumo {
  id: string;
  status: DealStatusValue;
  listPrice: string;
  discount: string;
  saleValue: string;
  createdAt: string;
  closedAt: string | null;
  vehicle: {
    id: string;
    versionName: string | null;
    yearModel: number;
    licensePlate: string | null;
    brand: { name: string };
    model: { name: string };
  };
  customer: { id: string; fullName: string; email: string; phone: string | null } | null;
  salesperson: { id: string; fullName: string } | null;
  payments: {
    id: string; kind: PaymentKindValue; status: string; value: string;
    institution: string | null; installments: number | null;
  }[];
  statusEvents: {
    id: string; fromStatus: DealStatusValue; toStatus: DealStatusValue;
    reason: string | null; occurredAt: string;
    actor: { id: string; fullName: string } | null;
  }[];
}

export interface PaginaDeNegocios {
  itens: DealResumo[];
  total: number;
  page: number;
  perPage: number;
}

export interface Margem {
  congelado: boolean;
  totalCost: string;
  saleValue: string | null;
  grossMargin: string | null;
  purchaseValue?: string;
  costsTotal?: string;
  marginPercent?: string | null;
  daysInStock?: number | null;
}

export interface Filtros {
  status?: DealStatusValue | '';
  salespersonId?: string;
}

function useToken() {
  return useAuthStore((s) => s.token) ?? undefined;
}

export function useNegocios(filtros: Filtros) {
  const token = useToken();
  const params = new URLSearchParams();
  if (filtros.status) params.set('status', filtros.status);
  if (filtros.salespersonId) params.set('salespersonId', filtros.salespersonId);
  params.set('perPage', '100');

  return useQuery({
    // Os filtros entram na chave: sem isso a troca de filtro devolveria o
    // resultado anterior do cache.
    queryKey: ['negocios', filtros.status ?? '', filtros.salespersonId ?? ''],
    queryFn: () => api<PaginaDeNegocios>(`/deals?${params}`, { token }),
    enabled: Boolean(token),
  });
}

export function useNegocio(id: string) {
  const token = useToken();
  return useQuery({
    queryKey: ['negocio', id],
    queryFn: () => api<DealResumo>(`/deals/${id}`, { token }),
    enabled: Boolean(token && id),
  });
}

export function useMargem(id: string, habilitado: boolean) {
  const token = useToken();
  return useQuery({
    queryKey: ['negocio-margem', id],
    queryFn: () => api<Margem>(`/deals/${id}/margin`, { token }),
    // 403 aqui é esperado para vendedor — não vale repetir a tentativa.
    retry: false,
    enabled: Boolean(token && id && habilitado),
  });
}

export function useTransicionar(id: string) {
  const token = useToken();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (v: { to: DealStatusValue; reason?: string }) =>
      api(`/deals/${id}/transition`, { method: 'POST', token, body: v }),
    onSuccess: () => {
      // A transição mexe no negócio, na lista e — ao faturar — na margem e no
      // status do veículo. Invalidar só o detalhe deixaria a lista mentindo.
      qc.invalidateQueries({ queryKey: ['negocio', id] });
      qc.invalidateQueries({ queryKey: ['negocios'] });
      qc.invalidateQueries({ queryKey: ['negocio-margem', id] });
      qc.invalidateQueries({ queryKey: ['veiculo-custo'] });
    },
  });
}

export function useAdicionarPagamento(id: string) {
  const token = useToken();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (v: {
      kind: PaymentKindValue; value: string; institution?: string; installments?: number;
    }) => api(`/deals/${id}/payments`, { method: 'POST', token, body: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['negocio', id] });
      qc.invalidateQueries({ queryKey: ['negocios'] });
    },
  });
}
