'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Handshake, ArrowRight, Loader2 } from 'lucide-react';
import { formatarBRL, subtrair } from '@autoconnect/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { ROTULO_STATUS, COR_STATUS } from '../../negocios/rotulos';
import type { DealResumo, PaginaDeNegocios } from '../../negocios/dados';

/**
 * Abertura do negócio a partir do veículo.
 *
 * É o ponto de entrada que faltava: a API aceitava `POST /deals` desde a Fase
 * 1, mas nenhuma tela o chamava — o funil de negócios era inalcançável pela
 * interface.
 *
 * Fica aqui, e não numa tela própria, porque todo negócio começa por um carro:
 * pedir para escolher o veículo num seletor seria repetir o que a navegação
 * já disse.
 */
export default function NegocioDoVeiculo({
  vehicleId, preco,
}: {
  vehicleId: string;
  preco: string | null;
}) {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['negocios-do-veiculo', vehicleId],
    queryFn: () =>
      api<PaginaDeNegocios>(`/deals?vehicleId=${vehicleId}&perPage=20`, { token }),
    enabled: Boolean(token && vehicleId),
  });

  const [venda, setVenda] = useState('');

  const abrir = useMutation({
    mutationFn: () => {
      const tabela = preco ?? '0';
      const valor = venda.trim() || tabela;
      return api<DealResumo>('/deals', {
        method: 'POST', token,
        body: {
          vehicleId,
          listPrice: tabela,
          // O backend exige `tabela − desconto = venda`; o desconto é derivado
          // do que a loja digitou, não pedido em campo separado.
          discount: subtrair(tabela, valor),
          saleValue: valor,
        },
      });
    },
    onSuccess: (negocio) => {
      qc.invalidateQueries({ queryKey: ['negocios-do-veiculo', vehicleId] });
      qc.invalidateQueries({ queryKey: ['negocios'] });
      router.push(`/negocios/${negocio.id}`);
    },
  });

  const vivos = (data?.itens ?? []).filter(
    (n) => !['canceled', 'rescinded'].includes(n.status),
  );

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
      <h2 className="font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
        <Handshake size={16} className="text-slate-400" />
        Negócio
      </h2>

      {isLoading ? (
        <div className="h-12 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
      ) : vivos.length > 0 ? (
        <ul className="space-y-2">
          {vivos.map((n) => (
            <li key={n.id}>
              <Link
                href={`/negocios/${n.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border
                           border-slate-200 dark:border-slate-800 p-3
                           hover:border-slate-300 dark:hover:border-slate-700 transition"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${COR_STATUS[n.status]}`}>
                    {ROTULO_STATUS[n.status]}
                  </span>
                  <span className="text-sm font-medium">{formatarBRL(n.saleValue)}</span>
                </span>
                <ArrowRight size={14} className="text-slate-400 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="text-sm text-slate-500 mb-3">
            Este veículo não tem negócio em andamento.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={venda}
              onChange={(e) => setVenda(e.target.value)}
              placeholder={preco ? `Valor da venda (tabela ${preco})` : 'Valor da venda'}
              inputMode="decimal"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); abrir.mutate(); } }}
              className="flex-1 min-w-[12rem] text-sm bg-transparent border
                         border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5"
            />
            <button
              type="button"
              onClick={() => abrir.mutate()}
              disabled={abrir.isPending || !preco}
              className="text-sm bg-brand-accent text-white px-3 py-1.5 rounded-lg font-medium
                         hover:bg-blue-600 transition disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {abrir.isPending && <Loader2 size={14} className="animate-spin" />}
              Abrir negócio
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Em branco, usa o preço de tabela. O veículo sai da vitrine enquanto o
            negócio estiver em andamento.
          </p>
        </>
      )}

      {abrir.error && (
        <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
          {textoDoErro(abrir.error)}
        </p>
      )}
    </section>
  );
}
