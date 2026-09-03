'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import type { TipoConsulta } from '@autoconnect/shared';

interface ItemSelo {
  tipo: TipoConsulta;
  rotulo: string;
}

/**
 * Selo de procedência na vitrine.
 *
 * Só aparece o que a loja **de fato consultou** e não achou nada — a API filtra
 * consulta que falhou ou que está pendente. Afirmar "sem registro de roubo" a
 * partir de consulta que não aconteceu seria informação falsa para o comprador
 * e exposição para a loja.
 *
 * Quando não há consulta nenhuma, o componente não renderiza: ausência de selo
 * não é afirmação sobre o veículo, e um "não verificado" na vitrine sugeriria
 * problema onde só há falta de consulta.
 */
export default function SeloProcedencia({ vehicleId }: { vehicleId: string }) {
  const [itens, setItens] = useState<ItemSelo[]>([]);

  useEffect(() => {
    let ativo = true;
    api<ItemSelo[]>(`/catalog/vehicles/${vehicleId}/provenance`)
      .then((r) => { if (ativo) setItens(r); })
      // Silêncio aqui é deliberado e diferente do resto do app: o selo é
      // enfeite informativo, e uma falha nele não pode virar erro na página do
      // veículo, que é a tela de venda.
      .catch(() => { if (ativo) setItens([]); });
    return () => { ativo = false; };
  }, [vehicleId]);

  if (itens.length === 0) return null;

  return (
    <div className="px-5 py-3">
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900
                      bg-emerald-50 dark:bg-emerald-950/30 p-3">
        <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300
                      flex items-center gap-1.5 mb-2">
          <ShieldCheck size={13} />
          Procedência verificada
        </p>
        <ul className="space-y-1">
          {itens.map((i) => (
            <li key={i.tipo} className="text-xs text-emerald-700 dark:text-emerald-400
                                        flex items-center gap-1.5">
              <ShieldCheck size={11} className="shrink-0" />
              {i.rotulo}: nada consta
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-emerald-700/70 dark:text-emerald-500/70 mt-2">
          Consultas realizadas pela concessionária na data do anúncio.
        </p>
      </div>
    </div>
  );
}
