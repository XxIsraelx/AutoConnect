'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, API_URL, ApiError } from '@/lib/api';
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

/* ── Contrato ─────────────────────────────────────────────── */

export interface Contrato {
  id: string;
  status: 'draft' | 'issued' | 'signed' | 'voided';
  contentHash: string;
  storageKey: string | null;
  issuedAt: string;
  signedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  template: { name: string; version: number };
  signatures: {
    id: string;
    role: 'customer' | 'dealer';
    signerName: string;
    signedAt: string;
  }[];
}

export function useContratos(dealId: string) {
  const token = useToken();
  return useQuery({
    queryKey: ['contratos', dealId],
    queryFn: () => api<Contrato[]>(`/deals/${dealId}/contracts`, { token }),
    enabled: Boolean(token && dealId),
  });
}

export function useEmitirContrato(dealId: string) {
  const token = useToken();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => api<Contrato>(`/deals/${dealId}/contract`, { method: 'POST', token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contratos', dealId] });
      // A emissão grava um evento na timeline do negócio.
      qc.invalidateQueries({ queryKey: ['negocio', dealId] });
    },
  });
}

export function useAssinarContrato(dealId: string) {
  const token = useToken();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (v: { id: string; role: 'customer' | 'dealer'; signerName: string }) =>
      api(`/contracts/${v.id}/sign`, {
        method: 'POST', token, body: { role: v.role, signerName: v.signerName },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contratos', dealId] }),
  });
}

export function useAnularContrato(dealId: string) {
  const token = useToken();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      api(`/contracts/${v.id}/void`, { method: 'POST', token, body: { reason: v.reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contratos', dealId] }),
  });
}

/**
 * Baixa o PDF.
 *
 * Não dá para usar `<a href>`: a rota exige o header `Authorization`, e um
 * link cru devolveria 401. Busca-se o arquivo com o token, e o blob é aberto
 * em aba nova — o object URL é revogado depois para não vazar memória.
 */
export async function baixarPdf(contratoId: string, token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/contracts/${contratoId}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    // O backend recusa o download quando o hash regerado não confere; a
    // mensagem dele é mais útil que um "falhou" genérico.
    let msg = `Erro ${res.status}`;
    try {
      const corpo = await res.json();
      if (typeof corpo.message === 'string') msg = corpo.message;
    } catch {
      // resposta sem JSON: fica o status
    }
    throw new ApiError(res.status, msg);
  }

  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ── Cliente do negócio ───────────────────────────────────── */

export interface ClienteRelacionado {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
}

/**
 * Clientes com quem a loja já se relacionou.
 *
 * Não é a base da plataforma: o backend usa o mesmo critério da policy de
 * isolamento — quem tem lead, agendamento ou conversa com esta loja.
 */
export function useClientesRelacionados(busca: string, habilitado: boolean) {
  const token = useToken();
  return useQuery({
    queryKey: ['clientes-relacionados', busca],
    queryFn: () =>
      api<ClienteRelacionado[]>(
        `/deals/customers${busca ? `?q=${encodeURIComponent(busca)}` : ''}`,
        { token },
      ),
    enabled: Boolean(token) && habilitado,
  });
}

export function useVincularCliente(dealId: string) {
  const token = useToken();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (customerUserId: string | null) =>
      api(`/deals/${dealId}`, { method: 'PATCH', token, body: { customerUserId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['negocio', dealId] });
      qc.invalidateQueries({ queryKey: ['negocios'] });
    },
  });
}
