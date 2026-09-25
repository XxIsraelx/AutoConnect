'use client';

import { AlertTriangle } from 'lucide-react';
import { ENVIO_DE_FOTOS_CONFIGURADO } from '@/lib/uploadDeFotos';

/**
 * Faixa que aparece quando o envio de fotos não está configurado no ambiente.
 *
 * Aparece **antes** de a pessoa tentar, e não depois de cinco tentativas
 * frustradas. É a diferença entre "está quebrado" e "falta configurar": sem a
 * Cloudinary nenhuma foto sobe, e sem foto nenhum veículo é publicado — o
 * lojista cadastra o carro, lê "Para publicar, falta pelo menos uma foto", e não
 * tem como saber que o problema é uma variável de ambiente.
 *
 * Renderiza `null` no caminho feliz: nada a dizer quando está tudo certo.
 */
export default function AvisoDeEnvioDeFotos({ className = '' }: { className?: string }) {
  if (ENVIO_DE_FOTOS_CONFIGURADO) return null;

  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50
                  dark:border-amber-500/30 dark:bg-amber-500/10 px-3 py-2.5 ${className}`}
    >
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
        <p className="font-semibold">Envio de fotos indisponível neste ambiente.</p>
        <p className="mt-0.5">
          A integração de imagens não está configurada, então nenhuma foto sobe — e sem
          foto o veículo não pode ser publicado. Não é problema das suas fotos:{' '}
          <a href="mailto:contato@autoconnect.app" className="underline font-medium">
            fale com o suporte do AutoConnect
          </a>
          .
        </p>
      </div>
    </div>
  );
}
