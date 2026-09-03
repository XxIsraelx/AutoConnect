'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, Search, Loader2, Clock } from 'lucide-react';
import {
  TIPOS_CONSULTA, ROTULO_CONSULTA, formatarBRL,
  type TipoConsulta, type ResultadoConsulta,
} from '@autoconnect/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';

interface Consulta {
  id: string;
  kind: TipoConsulta;
  status: 'pending' | 'success' | 'failed';
  provider: string;
  result: ResultadoConsulta | null;
  costCents: number | null;
  errorMessage: string | null;
  queriedAt: string;
  expiresAt: string;
}

const VE_CONSULTA = ['manager', 'tenant_admin', 'super_admin'];

const data = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

/**
 * Consulta veicular do veículo.
 *
 * Restrita a manager+ como o custo: **cada consulta é cobrada por chamada**, e
 * o botão precisa estar na mão de quem responde pela conta. A tela mostra o
 * custo e a validade justamente para que ninguém consulte por reflexo.
 */
export default function ConsultaVeicular({
  vehicleId, placa, chassi,
}: {
  vehicleId: string;
  placa: string | null;
  chassi: string | null;
}) {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const papel = useAuthStore((s) => s.user?.role) ?? '';
  const podeVer = VE_CONSULTA.includes(papel);
  const qc = useQueryClient();

  const [tipo, setTipo] = useState<TipoConsulta>('theft');

  const { data: consultas, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['consultas-veiculo', vehicleId],
    queryFn: () => api<Consulta[]>(`/vehicles/${vehicleId}/queries`, { token }),
    enabled: Boolean(token && vehicleId && podeVer),
    retry: false,
  });

  const consultar = useMutation({
    mutationFn: () =>
      api(`/vehicle-queries`, {
        method: 'POST', token,
        body: { kind: tipo, vehicleId, ...(placa ? { plate: placa } : { vin: chassi }) },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultas-veiculo', vehicleId] }),
  });

  if (!podeVer) return null;

  const semAlvo = !placa && !chassi;
  const agora = Date.now();

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
      <h2 className="font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
        <Search size={16} className="text-slate-400" />
        Consulta veicular
      </h2>

      {semAlvo ? (
        <p className="text-sm text-slate-500">
          Preencha a placa ou o chassi do veículo para consultar.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-center mb-4">
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoConsulta)}
              className="text-sm bg-transparent border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5"
            >
              {TIPOS_CONSULTA.map((t) => (
                <option key={t} value={t}>{ROTULO_CONSULTA[t]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => consultar.mutate()}
              disabled={consultar.isPending}
              className="text-sm bg-brand-accent text-white px-3 py-1.5 rounded-lg font-medium
                         hover:bg-blue-600 transition disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {consultar.isPending && <Loader2 size={14} className="animate-spin" />}
              Consultar {placa ?? chassi}
            </button>
          </div>

          {consultar.error && (
            <p className="text-sm text-rose-600 dark:text-rose-400 mb-3">
              {textoDoErro(consultar.error)}
            </p>
          )}
        </>
      )}

      {error ? (
        <ErroAoCarregar
          erro={error}
          onTentarNovamente={() => void refetch()}
          carregando={isFetching}
          contexto="as consultas"
        />
      ) : isLoading ? (
        <div className="h-16 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
      ) : !consultas?.length ? (
        <p className="text-sm text-slate-500">Nenhuma consulta feita para este veículo.</p>
      ) : (
        <ul className="space-y-2">
          {consultas.map((c) => {
            const valida = new Date(c.expiresAt).getTime() > agora;
            const alerta = c.result?.alerta ?? false;

            return (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                <div className="flex items-start gap-2 min-w-0">
                  {c.status === 'failed' ? (
                    <ShieldAlert size={15} className="text-slate-400 mt-0.5 shrink-0" />
                  ) : alerta ? (
                    <ShieldAlert size={15} className="text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
                  ) : (
                    <ShieldCheck size={15} className="text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium">{ROTULO_CONSULTA[c.kind]}</p>
                    <p className="text-xs text-slate-500">
                      {c.status === 'failed'
                        ? `Falhou: ${c.errorMessage ?? 'sem detalhe'}`
                        : (c.result?.resumo ?? 'sem resultado')}
                    </p>
                    {c.result?.itens?.length ? (
                      <ul className="mt-1 space-y-0.5">
                        {c.result.itens.map((i, n) => (
                          <li key={n} className="text-xs text-slate-500">
                            · {i.descricao}{i.valor ? ` — ${i.valor}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-xs text-slate-400">{data(c.queriedAt)}</p>
                  {/* Validade à vista: sem isso a loja reconsulta por reflexo
                      e paga de novo por dado que ainda vale. */}
                  {c.status === 'success' && (
                    <p className={`text-[11px] flex items-center gap-1 justify-end ${
                      valida ? 'text-slate-400' : 'text-amber-600 dark:text-amber-400'
                    }`}>
                      <Clock size={10} />
                      {valida ? `vale até ${data(c.expiresAt)}` : 'vencida'}
                    </p>
                  )}
                  {c.costCents != null && c.costCents > 0 && (
                    <p className="text-[11px] text-slate-400">
                      {formatarBRL((c.costCents / 100).toFixed(2))}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
