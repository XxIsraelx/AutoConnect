/**
 * O que a landing precisa ajustar sem caçar texto em cada seção.
 * Plano: `docs/planos/plano-nova-landing.md`.
 */
export const WHATSAPP_NUMBER = '5519978285984'; // TODO(Israel): confirmar o número comercial
export const waLink = (msg: string) =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;

/**
 * Headlines em teste. Com pouco tráfego, trocar por semana não dá diferença
 * confiável: só comparar com ~100 visitas por versão (plano, "Métrica").
 */
export const TITULOS_DO_HERO = [
  'Quanto tempo sua loja leva para responder um cliente no WhatsApp?',
  'Nenhum cliente sem resposta, do Instagram ao test drive.',
  'Sua loja perde venda na demora da resposta. O AutoConnect mostra onde — e resolve.',
] as const;
export const TITULO_DO_HERO = TITULOS_DO_HERO[0];

/**
 * Nome de cada seção como aparece na mensagem pronta do WhatsApp flutuante —
 * é por ela que o Israel sabe de onde a conversa veio. Cada `<section>` da
 * landing declara o seu em `data-secao`.
 */
export const SECOES = {
  hero: 'Início',
  problema: 'As 42 horas',
  oQueMuda: 'O que muda na loja',
  comoFunciona: 'Como funciona',
  produto: 'O painel',
  calculadora: 'Calculadora',
  planos: 'Planos',
  faq: 'Perguntas',
  final: 'Pedir o Raio-X',
} as const;

export function mensagemDoWhatsApp(secao?: string) {
  return secao
    ? `Oi, Israel! Vi a parte "${secao}" do site do AutoConnect e quero saber mais.`
    : 'Oi, Israel! Vi o site do AutoConnect e quero saber mais.';
}
