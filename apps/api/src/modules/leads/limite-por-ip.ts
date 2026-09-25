/**
 * Antiabuso do formulário público de lead.
 *
 * A janela deslizante em si mora em `common/limite-por-ip.ts` — o cadastro de
 * concessionária usa a mesma classe, com outro teto. Aqui ficam só a chave e os
 * números deste caminho.
 *
 * A defesa real contra lead falso continua sendo a soma: telefone brasileiro
 * validado, honeypot no formulário, e este teto.
 */
export { LimitePorIp, LIMITE_POR_JANELA, JANELA_MS } from '../../common/limite-por-ip';

/** Uma chave por (quem envia, para onde envia). */
export function chaveDoEnvio(ip: string, tenantId: string, vehicleId: string | null): string {
  return `${ip}|${tenantId}|${vehicleId ?? 'sem-veiculo'}`;
}
