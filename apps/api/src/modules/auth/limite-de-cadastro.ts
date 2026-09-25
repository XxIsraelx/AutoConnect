import { Injectable } from '@nestjs/common';
import { LimitePorIp } from '../../common/limite-por-ip';

/**
 * Antiabuso do cadastro de concessionária, que passou a ser público em
 * 25/09/2026.
 *
 * ## Por que estes números
 *
 * **3 cadastros por IP a cada hora.** Um dono de revenda cria uma loja, uma
 * vez. Três cobre o caso real de errar e recomeçar — e-mail digitado errado,
 * CNPJ da filial em vez da matriz — e ainda deixa um escritório inteiro atrás
 * do mesmo IP criar as lojas do grupo ao longo do dia. Quem precisa de mais é
 * script.
 *
 * **10 reenvios de verificação por IP a cada hora**, na mesma janela e com o
 * mesmo mecanismo. `POST /auth/resend-verification` dispara e-mail para um
 * endereço escolhido por quem chama: sem teto, é um canhão de spam apontado
 * para terceiros com a nossa marca no remetente.
 *
 * ## O que este teto NÃO é
 *
 * Não é a defesa principal. Ela é a soma: dígito verificador do CNPJ conferido
 * pelo Zod (regra dura, não depende de serviço externo), CNPJ **único** por
 * loja no banco, e-mail único por usuário, e este teto. Não há CAPTCHA, de
 * propósito: quem está avaliando um sistema para a própria loja num sábado à
 * noite desiste no primeiro quebra-cabeça.
 *
 * ⚠ **Memória de processo, como o dos leads.** Com mais de uma réplica da API
 * cada uma tem a própria contagem e o teto efetivo é `LIMITE × réplicas`. Hoje
 * a API roda em réplica única no Railway. `trust proxy` está ligado no
 * `app.setup` — sem ele `req.ip` seria o da borda do Railway e o teto barraria
 * a internet inteira depois do terceiro cadastro do dia.
 */

/** Cadastros de loja aceitos por IP dentro da janela. */
export const LIMITE_DE_CADASTROS = 3;

/** Reenvios de verificação de e-mail aceitos por IP dentro da janela. */
export const LIMITE_DE_REENVIOS = 10;

/** Uma hora. */
export const JANELA_DE_CADASTRO_MS = 60 * 60 * 1000;

/**
 * Duas subclasses, e não duas instâncias de `LimitePorIp` com `useValue`,
 * porque o contêiner do Nest precisa distinguir uma da outra pelo tipo — o
 * cadastro e o reenvio têm tetos diferentes e não podem dividir a mesma janela.
 *
 * São providers, e não campos privados dos services, para que os testes de
 * integração possam zerar a janela entre casos (`app.get(LimiteDeCadastro)
 * .limpar()`) sem expor um método só-para-teste no caminho de produção.
 */
@Injectable()
export class LimiteDeCadastro extends LimitePorIp {
  constructor() {
    super(LIMITE_DE_CADASTROS, JANELA_DE_CADASTRO_MS);
  }
}

@Injectable()
export class LimiteDeReenvio extends LimitePorIp {
  constructor() {
    super(LIMITE_DE_REENVIOS, JANELA_DE_CADASTRO_MS);
  }
}
