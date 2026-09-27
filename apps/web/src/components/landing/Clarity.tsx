'use client';

import { useEffect } from 'react';
import Script from 'next/script';
import { registrarEvento, type EventoDaLanding } from './eventos';
import { secaoNoMeioDaTela } from './config';

/**
 * Microsoft Clarity, só nas páginas do grupo `(landing)` — a home e o
 * `/raio-x`. No layout raiz ele gravaria também o painel, que mostra CPF,
 * telefone e negociação de cliente. `/privacidade` descreve exatamente isto;
 * mudar o alcance é mudar aquela página junto.
 *
 * `NEXT_PUBLIC_CLARITY_ID` vazio = nada carrega. Os formulários levam
 * `data-clarity-mask`, então o que se digita não entra na gravação.
 *
 * Os cliques de conversão são medidos por delegação: link com
 * `data-evento="whatsapp_click"` vira evento, com a seção (`data-secao` do
 * elemento, a `<section>` em volta ou a do meio da tela) — sem cada link
 * precisar ser componente de cliente.
 */
const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID;

export default function Clarity() {
  useEffect(() => {
    if (!CLARITY_ID) return;
    const aoClicar = (e: MouseEvent) => {
      const alvo = (e.target as Element | null)?.closest<HTMLElement>('[data-evento]');
      if (!alvo) return;
      // Link fora de qualquer seção (o WhatsApp flutuante) leva a do meio da tela.
      const secao =
        alvo.dataset.secao ?? alvo.closest<HTMLElement>('section[data-secao]')?.dataset.secao ?? secaoNoMeioDaTela();
      registrarEvento(alvo.dataset.evento as EventoDaLanding, secao ? { secao } : undefined);
    };
    document.addEventListener('click', aoClicar, true);
    return () => document.removeEventListener('click', aoClicar, true);
  }, []);

  if (!CLARITY_ID || !/^[a-z0-9]+$/i.test(CLARITY_ID)) return null;
  return (
    <Script id="clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${CLARITY_ID}");`}
    </Script>
  );
}
