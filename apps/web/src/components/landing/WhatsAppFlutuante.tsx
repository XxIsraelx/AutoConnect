'use client';

import { MessageCircle } from 'lucide-react';
import { mensagemDoWhatsApp, secaoNoMeioDaTela, waLink } from './config';

/**
 * WhatsApp do Israel fixo no canto, em toda a home. A mensagem pronta diz em
 * que seção a pessoa estava quando clicou: o `href` é refeito no próprio
 * clique, antes de o navegador segui-lo.
 */
export default function WhatsAppFlutuante() {
  return (
    <a
      href={waLink(mensagemDoWhatsApp())}
      onClick={(e) => {
        e.currentTarget.href = waLink(mensagemDoWhatsApp(secaoNoMeioDaTela()));
      }}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Conversar com o Israel pelo WhatsApp"
      data-evento="whatsapp_click"
      className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 w-14 h-14 rounded-full bg-[#25D366] text-white
                 flex items-center justify-center shadow-lg shadow-black/20 hover:scale-105 transition"
    >
      <MessageCircle size={26} />
    </a>
  );
}
