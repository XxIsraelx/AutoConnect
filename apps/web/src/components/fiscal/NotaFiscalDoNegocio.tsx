'use client';

import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import CartaoDaNotaFiscal from './CartaoDaNotaFiscal';

/**
 * A NF-e de saída do negócio. O cartão é o genérico; aqui moram as rotas — e
 * a URL de emissão literal, que é o que o `corpos-do-web.spec.ts` confere.
 */
export default function NotaFiscalDoNegocio({ dealId, vehicleId, comprador }: {
  dealId: string;
  vehicleId: string;
  comprador: unknown;
}) {
  const token = useAuthStore((s) => s.token) ?? undefined;
  return (
    <CartaoDaNotaFiscal
      chave={['negocio', dealId]}
      titulo="Nota fiscal"
      rotaPrevia={`/fiscal/negocios/${dealId}/previa`}
      rotaNotas={`/fiscal/negocios/${dealId}/notas`}
      emitir={(presencial) => api(`/fiscal/negocios/${dealId}/notas`, {
        token, method: 'POST', body: JSON.stringify({ presencial }),
      })}
      vehicleId={vehicleId}
      versaoDosDados={comprador}
      rotuloPresencial="Comprador retira na loja"
      ondeCorrigirContraparte="Qualificação do comprador, acima"
      ondeCorrigirValor="Preço do negócio, acima"
    />
  );
}
