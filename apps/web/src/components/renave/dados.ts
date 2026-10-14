'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PendenciaRenave, RenaveOperacaoValue, RenaveOrigemValue, RenaveStatusValue, SituacaoNoRenave,
} from '@autoconnect/shared';
import { api, ApiError } from '@/lib/api';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { useAuthStore } from '@/store/auth';

/** Quem registra. O vendedor vê o cartão, não registra — a API recusa com 403. */
export const PAPEIS_FISCAIS = ['manager', 'tenant_admin', 'super_admin'];

export interface RegistroRenave {
  id: string;
  vehicleId: string;
  dealId: string | null;
  tipo: RenaveOperacaoValue;
  status: RenaveStatusValue;
  origem: RenaveOrigemValue;
  protocolo: string | null;
  registradoEm: string | null;
  dataOperacao: string;
  chaveNfe: string | null;
  valor: string | null;
  observacao: string | null;
  motivoRecusa: string | null;
  canceladoEm: string | null;
  motivoCancelamento: string | null;
  protocoloCancelamento: string | null;
  createdAt: string;
}

export interface RenaveDoVeiculo {
  vehicleId: string;
  situacao: SituacaoNoRenave;
  registros: RegistroRenave[];
  pendencias: PendenciaRenave[];
  sugestao: {
    entrada: {
      tipo: RenaveOperacaoValue;
      valor: string | null;
      dataOperacao: string | null;
      temAquisicao: boolean;
    };
    saidas: { dealId: string; valor: string; dataOperacao: string | null }[];
  };
}

export interface PendenciasDaLoja {
  janelaDeVendidosDias: number;
  total: { veiculos: number; obrigatorias: number; avisos: number };
  itens: {
    veiculo: { id: string; status: string; licensePlate: string | null; descricao: string };
    pendencias: PendenciaRenave[];
  }[];
}

export interface NovoRegistro {
  vehicleId: string;
  tipo: RenaveOperacaoValue;
  dealId?: string;
  protocolo?: string;
  registradoEm?: string;
  dataOperacao?: string;
  chaveNfe?: string;
  observacao?: string;
}

export type AcaoNoRegistro =
  | { acao: 'confirmar'; protocolo: string; registradoEm?: string }
  | { acao: 'recusar'; motivo: string }
  | { acao: 'cancelar'; motivo: string; protocoloCancelamento?: string }
  | { acao: 'nfe'; chaveNfe: string };

/**
 * O erro da ação, com a frase do campo quando o `ZodFilter` mandou uma — "a
 * chave tem dígito errado" diz o que fazer; "Validation failed" não diz.
 */
export function erroDaAcao(err: unknown): string {
  if (err instanceof ApiError && err.fieldErrors.length > 0) return err.fieldErrors[0]!.message;
  return textoDoErro(err);
}

const chave = (vehicleId: string) => ['renave', vehicleId] as const;

export function useRenaveDoVeiculo(vehicleId: string) {
  const token = useAuthStore((s) => s.token) ?? undefined;
  return useQuery({
    queryKey: chave(vehicleId),
    queryFn: () => api<RenaveDoVeiculo>(`/renave/veiculos/${vehicleId}`, { token }),
    enabled: Boolean(token && vehicleId),
    retry: false,
  });
}

export function usePendenciasRenave() {
  const token = useAuthStore((s) => s.token) ?? undefined;
  return useQuery({
    queryKey: ['renave', 'pendencias'],
    queryFn: () => api<PendenciasDaLoja>('/renave/pendencias', { token }),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useRegistrarRenave() {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const qc = useQueryClient();
  return useMutation({
    // Corpo literal, campo a campo: é o que deixa `corpos-do-web.spec.ts`
    // conferir cada nome contra o `registrarRenaveSchema`. `undefined` some no
    // JSON, então campo vazio não vai.
    mutationFn: (c: NovoRegistro) =>
      api<RegistroRenave>('/renave/registros', {
        method: 'POST',
        token,
        body: {
          vehicleId: c.vehicleId, tipo: c.tipo, dealId: c.dealId, protocolo: c.protocolo,
          registradoEm: c.registradoEm, dataOperacao: c.dataOperacao, chaveNfe: c.chaveNfe,
          observacao: c.observacao,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['renave'] }),
  });
}

/** Uma rota por ação, com corpo literal — pelo mesmo motivo do registro. */
function executar(id: string, a: AcaoNoRegistro, token?: string): Promise<RegistroRenave> {
  switch (a.acao) {
    case 'confirmar':
      return api(`/renave/registros/${id}/confirmar`, {
        method: 'POST', token, body: { protocolo: a.protocolo, registradoEm: a.registradoEm },
      });
    case 'recusar':
      return api(`/renave/registros/${id}/recusar`, {
        method: 'POST', token, body: { motivo: a.motivo },
      });
    case 'cancelar':
      return api(`/renave/registros/${id}/cancelar`, {
        method: 'POST', token, body: { motivo: a.motivo, protocoloCancelamento: a.protocoloCancelamento },
      });
    case 'nfe':
      return api(`/renave/registros/${id}/nfe`, {
        method: 'POST', token, body: { chaveNfe: a.chaveNfe },
      });
  }
}

export function useAcaoRenave() {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...a }: AcaoNoRegistro & { id: string }) => executar(id, a, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['renave'] }),
  });
}
