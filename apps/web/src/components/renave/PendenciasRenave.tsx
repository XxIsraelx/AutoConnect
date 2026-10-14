'use client';

import Link from 'next/link';
import { AlertTriangle, Info, ClipboardCheck } from 'lucide-react';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import { usePendenciasRenave } from './dados';

/**
 * Pendências RENAVE da loja — a lista da gerência.
 *
 * Responde "o que falta registrar na integradora?" para o estoque inteiro e
 * para as vendas recentes. Cada linha leva ao veículo, onde o cartão RENAVE
 * anota o protocolo. Nada aqui bloqueia o resto do sistema.
 */
export default function PendenciasRenave() {
  const { data, isLoading, error, refetch, isFetching } = usePendenciasRenave();

  if (error) {
    return (
      <ErroAoCarregar
        erro={error}
        onTentarNovamente={() => void refetch()}
        carregando={isFetching}
        contexto="as pendências do RENAVE"
      />
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <Numero rotulo="Veículos com pendência" valor={data.total.veiculos} />
        <Numero rotulo="Obrigações" valor={data.total.obrigatorias} destaque={data.total.obrigatorias > 0} />
        <Numero rotulo="Avisos" valor={data.total.avisos} />
      </div>

      {data.itens.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center">
          <ClipboardCheck className="mx-auto text-emerald-500 mb-2" size={28} />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Nada pendente no RENAVE para o estoque e as vendas dos últimos {data.janelaDeVendidosDias} dias.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {data.itens.map((i) => (
            <li key={i.veiculo.id}>
              <Link
                href={`/veiculos/${i.veiculo.id}`}
                className="block rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:border-brand-accent transition"
              >
                <p className="font-medium text-sm">
                  {i.veiculo.descricao}
                  {i.veiculo.licensePlate && (
                    <span className="text-slate-400 font-normal"> · {i.veiculo.licensePlate}</span>
                  )}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {i.pendencias.map((p, n) => (
                    <li
                      key={`${p.codigo}-${n}`}
                      className={`flex gap-2 text-sm ${
                        p.gravidade === 'obrigatoria'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {p.gravidade === 'obrigatoria'
                        ? <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                        : <Info size={14} className="shrink-0 mt-0.5" />}
                      <span>{p.mensagem}</span>
                    </li>
                  ))}
                </ul>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-400">
        O AutoConnect guarda os protocolos e avisa o que falta; o envio é pela sua integradora.
        Vendidos entram na lista por {data.janelaDeVendidosDias} dias; zero km fica de fora
        (no RENAVE ele entra pela montadora).
      </p>
    </div>
  );
}

function Numero({ rotulo, valor, destaque = false }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`text-2xl font-bold ${destaque ? 'text-amber-600 dark:text-amber-400' : ''}`}>{valor}</p>
    </div>
  );
}
