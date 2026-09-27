'use client';

import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { mensagemDoWhatsApp, waLink } from './config';

/**
 * WhatsApp do Israel fixo no canto, em toda a home. A mensagem pronta diz em
 * que seção a pessoa estava quando clicou — a seção que ocupa o meio da tela,
 * lida do `data-secao` de cada `<section>`.
 */
export default function WhatsAppFlutuante() {
  const [secao, setSecao] = useState<string | undefined>();

  useEffect(() => {
    const secoes = Array.from(document.querySelectorAll<HTMLElement>('[data-secao]'));
    // Faixa fina no meio da viewport: a seção que a cruza é a que está sendo lida.
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) if (e.isIntersecting) setSecao(e.target.getAttribute('data-secao') ?? undefined);
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    secoes.forEach((s) => observador.observe(s));
    return () => observador.disconnect();
  }, []);

  return (
    <a
      href={waLink(mensagemDoWhatsApp(secao))}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Conversar com o Israel pelo WhatsApp"
      className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 w-14 h-14 rounded-full bg-[#25D366] text-white
                 flex items-center justify-center shadow-lg shadow-black/20 hover:scale-105 transition"
    >
      <MessageCircle size={26} />
    </a>
  );
}
