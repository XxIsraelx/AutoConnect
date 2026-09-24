'use client';

/**
 * A vitrine como controle da loja: etiqueta de estado e o botão que publica.
 *
 * Fica num componente só porque as duas telas que o usam — a lista de
 * `/veiculos` e a ficha de `/veiculos/[id]` — precisam concordar sobre o que
 * "Rascunho" significa e sobre o que falta para publicar. Duas cópias dessa
 * regra é como se produz uma lista que diz "pronto para publicar" e uma ficha
 * que recusa.
 *
 * O que falta vem de `pendenciasParaPublicar`, a mesma função que a API usa
 * antes de aceitar — a tela avisa *antes*, a API recusa *depois*.
 */

import { useState } from 'react';
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';
import {
  LISTING_STATUS_LABELS,
  pendenciasParaPublicar,
  listarPendencias,
  type ListingStatusValue,
} from '@autoconnect/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface DadosDePublicacao {
  id: string;
  status: string;
  listingStatus: ListingStatusValue;
  price: string | number | null;
  color?: string | null;
  fuel?: string | null;
  transmission?: string | null;
  totalDeFotos: number;
}

const CORES: Record<ListingStatusValue, string> = {
  draft:
    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  published:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  unpublished:
    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
};

/** Etiqueta do estado do anúncio — diferente do status do estoque. */
export function EtiquetaDoAnuncio({
  listingStatus,
  className,
}: {
  listingStatus: ListingStatusValue;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap',
        CORES[listingStatus] ?? CORES.draft,
        className,
      )}
    >
      {LISTING_STATUS_LABELS[listingStatus] ?? listingStatus}
    </span>
  );
}

/**
 * O que ainda falta para este anúncio ir ao ar, em uma frase.
 * `null` quando está pronto.
 */
export function pendenciasDoVeiculo(v: DadosDePublicacao): string | null {
  if (v.status !== 'available') {
    return 'só veículo com status "Disponível" vai para a vitrine';
  }
  const faltando = pendenciasParaPublicar({
    price: v.price,
    totalDeFotos: v.totalDeFotos,
    color: v.color,
    fuel: v.fuel,
    transmission: v.transmission,
  });
  return faltando.length > 0 ? `falta ${listarPendencias(faltando)}` : null;
}

/**
 * Botão publicar/despublicar.
 *
 * Quando falta alguma coisa, o botão fica desabilitado e o motivo aparece ao
 * lado — e não num alerta depois do clique. Um botão que só diz "não" depois
 * de apertado obriga o lojista a adivinhar o que consertar.
 */
export function BotaoDePublicacao({
  veiculo,
  token,
  onMudou,
  compacto = false,
}: {
  veiculo: DadosDePublicacao;
  token: string | null;
  onMudou: (listingStatus: ListingStatusValue) => void;
  compacto?: boolean;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const noAr = veiculo.listingStatus === 'published';
  const faltando = noAr ? null : pendenciasDoVeiculo(veiculo);
  const bloqueado = !noAr && faltando !== null;

  async function alternar() {
    if (!token || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await api(`/vehicles/${veiculo.id}/${noAr ? 'unpublish' : 'publish'}`, {
        method: 'POST',
        token,
      });
      onMudou(noAr ? 'unpublished' : 'published');
    } catch (e) {
      // A API é quem decide: mesmo com a tela achando que está tudo certo, a
      // mensagem dela é a que vale (outra aba pode ter apagado a foto).
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={compacto ? 'flex flex-col items-end gap-1' : 'space-y-1.5'}>
      <button
        type="button"
        onClick={alternar}
        disabled={bloqueado || enviando || !token}
        title={bloqueado ? `Para publicar, ${faltando}` : undefined}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg font-medium transition',
          compacto ? 'text-xs px-2.5 py-1.5' : 'text-sm px-4 py-2',
          noAr
            ? 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-400 hover:text-amber-600'
            : 'bg-emerald-600 text-white hover:bg-emerald-700',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        {enviando ? (
          <Loader2 size={compacto ? 13 : 15} className="animate-spin" />
        ) : noAr ? (
          <EyeOff size={compacto ? 13 : 15} />
        ) : (
          <Eye size={compacto ? 13 : 15} />
        )}
        {noAr ? 'Despublicar' : 'Publicar'}
      </button>

      {bloqueado && (
        <p
          className={cn(
            'flex items-start gap-1 text-slate-500',
            compacto ? 'text-[11px] text-right justify-end' : 'text-xs',
          )}
        >
          {!compacto && <AlertCircle size={13} className="mt-0.5 shrink-0" />}
          Para publicar, {faltando}.
        </p>
      )}

      {erro && (
        <p className={cn('text-red-500', compacto ? 'text-[11px]' : 'text-xs')}>
          {erro}
        </p>
      )}
    </div>
  );
}
