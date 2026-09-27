import { Injectable } from '@nestjs/common';
import { LimitePorIp } from '../../common/limite-por-ip';

/** Mensagens que o mesmo IP pode mandar por links de visitante na janela. */
export const LIMITE_DE_MENSAGENS_DE_VISITANTE = 30;

/** Dez minutos, a mesma janela do formulário público de lead. */
export const JANELA_DE_VISITANTE_MS = 10 * 60 * 1000;

/**
 * Teto de mensagens de quem entra **só com um link**.
 *
 * Sem ele, um link vazado é um canal de despejo direto no painel da loja. Trinta
 * mensagens em dez minutos é folgado para uma conversa de verdade (ninguém
 * digita três por minuto por dez minutos seguidos) e estreito para um script.
 *
 * É subclasse, e não `useValue`, pelo mesmo motivo dos limites do cadastro: o
 * contêiner distingue pelo tipo, e os testes de integração precisam zerar a
 * janela entre casos sem um método só-para-teste no caminho de produção.
 *
 * ⚠ Memória de processo: duas réplicas = `teto × réplicas`, como no resto.
 */
@Injectable()
export class LimiteDeVisitante extends LimitePorIp {
  constructor() {
    super(LIMITE_DE_MENSAGENS_DE_VISITANTE, JANELA_DE_VISITANTE_MS);
  }
}
