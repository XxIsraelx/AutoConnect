'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileText, RefreshCw } from 'lucide-react';
import { formatarBRL, type FaltaParaEmitir, type LugarDaFalta, type NotaMontada } from '@autoconnect/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';

const PAPEIS_DO_FISCAL = ['manager', 'tenant_admin', 'super_admin'];

interface Previa {
  operacao: string;
  rotulo: string;
  nota: NotaMontada | null;
  faltas: FaltaParaEmitir[];
}

/** Onde cada falta se corrige — a lista manda a pessoa ao lugar, não só diz o quê. */
function ondeCorrigir(onde: LugarDaFalta, vehicleId: string): { texto: string; href?: string } {
  switch (onde) {
    case 'perfil_fiscal': return { texto: 'Perfil fiscal', href: '/configuracoes/fiscal' };
    case 'loja': return { texto: 'Configurações da loja', href: '/configuracoes' };
    case 'veiculo': return { texto: 'Dados fiscais do veículo', href: `/veiculos/${vehicleId}` };
    case 'contraparte': return { texto: 'Qualificação do comprador, acima' };
    case 'negocio': return { texto: 'Preço do negócio, acima' };
  }
}

/**
 * A nota de saída que o negócio geraria hoje — fase N1 do plano fiscal.
 *
 * Ainda não emite: mostra o que falta, ou a nota pronta, com a mesma regra
 * (`montarNota`) que a emissão vai usar. Pronta, os dados servem para o emissor
 * que a loja já usa; a emissão pelo AutoConnect é a fase seguinte.
 *
 * O comprador entra na chave da consulta: salvar a qualificação acima refaz o
 * negócio, e a prévia acompanha sem botão.
 */
export default function PreviaDaNotaFiscal({ dealId, vehicleId, comprador }: {
  dealId: string;
  vehicleId: string;
  comprador: unknown;
}) {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const papel = useAuthStore((s) => s.user?.role) ?? '';
  const [presencial, setPresencial] = useState(true);

  const consulta = useQuery({
    queryKey: ['fiscal-previa', dealId, presencial, comprador],
    queryFn: () => api<Previa>(`/fiscal/negocios/${dealId}/previa?presencial=${presencial}`, { token }),
    enabled: !!token && PAPEIS_DO_FISCAL.includes(papel),
  });

  if (!PAPEIS_DO_FISCAL.includes(papel)) return null;

  const previa = consulta.data;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <FileText size={12} /> Nota fiscal{previa ? ` — ${previa.rotulo.toLowerCase()}` : ''}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={presencial} onChange={(e) => setPresencial(e.target.checked)} />
            Comprador retira na loja
          </label>
          <button
            type="button" onClick={() => consulta.refetch()} aria-label="Conferir de novo"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <RefreshCw size={13} className={consulta.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {consulta.isError && <ErroAoCarregar erro={consulta.error} onTentarNovamente={() => consulta.refetch()} />}

      {previa && previa.faltas.length > 0 && (
        <>
          <p className="text-sm text-slate-700 dark:text-slate-200 mb-2">
            Para a nota sair, falta:
          </p>
          <ul className="space-y-1.5">
            {previa.faltas.map((f) => {
              const onde = ondeCorrigir(f.onde, vehicleId);
              return (
                <li key={f.campo} className="text-sm text-slate-600 dark:text-slate-300 flex flex-wrap gap-x-2">
                  <span>• {f.mensagem}</span>
                  {onde.href
                    ? <Link href={onde.href} className="text-xs text-brand-accent self-center">{onde.texto} →</Link>
                    : <span className="text-xs text-slate-400 self-center">{onde.texto}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {previa?.nota && (
        <div className="space-y-2">
          <p className="text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 size={14} /> Os dados da nota estão completos.
          </p>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div><dt className="text-slate-400">CFOP</dt><dd className="font-mono text-slate-800 dark:text-slate-100">{previa.nota.cfop}</dd></div>
            <div><dt className="text-slate-400">Situação tributária</dt><dd className="font-mono text-slate-800 dark:text-slate-100">{previa.nota.situacaoTributaria}</dd></div>
            <div><dt className="text-slate-400">Valor</dt><dd className="text-slate-800 dark:text-slate-100">{formatarBRL(previa.nota.valorTotal)}</dd></div>
            <div><dt className="text-slate-400">Ambiente</dt><dd className="text-slate-800 dark:text-slate-100">{previa.nota.ambiente === 'producao' ? 'Produção' : 'Homologação'}</dd></div>
          </dl>
          <p className="text-xs text-slate-500">{previa.nota.item.descricao}</p>
          <p className="text-xs text-slate-500">
            A emissão pelo AutoConnect ainda não está ligada — por enquanto, use estes dados no
            emissor da loja.
          </p>
        </div>
      )}
    </div>
  );
}
