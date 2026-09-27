declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
  }
}

/** Conversões da landing: as três portas da métrica do plano. */
export type EventoDaLanding = 'raio_x_enviado' | 'conta_criar_click' | 'whatsapp_click';

/**
 * Evento no Microsoft Clarity. Sem o script (`NEXT_PUBLIC_CLARITY_ID` vazio,
 * bloqueador de anúncio) não faz nada — medir nunca pode quebrar o clique
 * que está sendo medido. As `tags` viram tags de sessão (`clarity('set')`),
 * que é como o Clarity filtra: "sessões com secao = Calculadora".
 */
export function registrarEvento(nome: EventoDaLanding, tags?: Record<string, string>) {
  try {
    const clarity = window.clarity;
    if (!clarity) return;
    for (const [chave, valor] of Object.entries(tags ?? {})) clarity('set', chave, valor);
    clarity('event', nome);
  } catch {
    // Script de terceiro com erro: perder o evento é melhor que perder o clique.
  }
}
