/**
 * Raio-X gratuito do atendimento — o pedido que a landing capta.
 *
 * O pedido vira lead **dentro do próprio AutoConnect**: uma loja "AutoConnect"
 * em produção recebe os pedidos por `POST /leads/public`, o mesmo caminho do
 * formulário de interesse da vitrine. Com isso o Raio-X ganha de graça o que
 * a captura de lead já tem — consentimento por cópia, deduplicação, honeypot,
 * teto por IP, rodízio e prazo de primeiro contato — e o Israel vende usando
 * o produto. Plano: `docs/planos/plano-nova-landing.md`.
 *
 * Loja, cargo e origem vão no `message` na primeira versão, sem mudar o
 * schema do lead. Se o volume justificar, viram campos.
 */

/**
 * O texto do aceite do Raio-X. É uma versão de consentimento própria: o texto
 * da vitrine fala "desta concessionária … sobre este veículo", e o Raio-X não
 * é nem uma coisa nem outra. Como todo consentimento, vai **por cópia** em
 * `leads.consent_text` — mudar a frase é publicar uma versão nova, e os
 * aceites antigos continuam guardando o que a pessoa leu.
 */
export const TEXTO_DE_CONSENTIMENTO_RAIO_X =
  'Autorizo o AutoConnect a entrar em contato por telefone, WhatsApp ou e-mail sobre o ' +
  'Raio-X do atendimento da minha loja e a tratar meus dados para esse fim, conforme a ' +
  'Política de Privacidade.';

export const CARGOS_DO_RAIO_X = [
  { valor: 'dono', rotulo: 'Dono' },
  { valor: 'gerente', rotulo: 'Gerente' },
  { valor: 'vendedor', rotulo: 'Vendedor' },
  { valor: 'outro', rotulo: 'Outro' },
] as const;
export type CargoDoRaioX = (typeof CARGOS_DO_RAIO_X)[number]['valor'];

export const ORIGEM_PADRAO_DO_RAIO_X = 'direto';

/**
 * `?origem=` vem da URL — o ManyChat, o link da bio, ou qualquer um que
 * digitar. Só passa o que parece rótulo de campanha; o resto vira `direto`, em
 * vez de recusar o pedido de quem clicou num link malformado.
 */
export function origemDoRaioX(bruta: string | null | undefined): string {
  const limpa = (bruta ?? '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(limpa) ? limpa : ORIGEM_PADRAO_DO_RAIO_X;
}

export const LIMITE_NOME_DA_LOJA = 120;

/**
 * O `message` do lead: `Raio-X do atendimento · Loja: … · Cargo: … · Origem: …
 * · Seção: …`. É o que o vendedor lê no painel, então é texto para gente, com
 * os rótulos por extenso.
 */
export function mensagemDoRaioX(p: {
  loja: string;
  cargo: CargoDoRaioX;
  origem?: string | null;
  secao?: string | null;
}): string {
  const cargo = CARGOS_DO_RAIO_X.find((c) => c.valor === p.cargo)?.rotulo ?? 'Outro';
  const partes = [
    'Raio-X do atendimento',
    `Loja: ${p.loja.trim().replace(/\s+/g, ' ').slice(0, LIMITE_NOME_DA_LOJA)}`,
    `Cargo: ${cargo}`,
    `Origem: ${origemDoRaioX(p.origem)}`,
  ];
  if (p.secao) partes.push(`Seção: ${p.secao}`);
  return partes.join(' · ');
}
