/**
 * Limite simples de envios do formulário público, por IP e por alvo.
 *
 * Proporcional ao problema: o que se quer evitar é o script bobo que despeja
 * cem leads falsos num veículo, não um ataque coordenado. Por isso **não** há
 * CAPTCHA (custo de conversão alto para quem está comprando carro) e **não** há
 * Redis — o projeto não usa Redis, e trazer uma dependência de infraestrutura
 * para isto seria caro demais pelo que entrega.
 *
 * ⚠ O estado é de processo. Com mais de uma réplica da API, cada uma tem sua
 * própria contagem e o limite efetivo é `LIMITE × réplicas`. Hoje a API roda em
 * réplica única no Railway; se isso mudar, esta é a primeira coisa a revisar
 * (junto dos crons, que têm a mesma restrição — ver `execucao-unica.ts`).
 *
 * A defesa real contra lead falso continua sendo a soma: telefone brasileiro
 * validado, honeypot no formulário, e este teto.
 */

import { Injectable } from '@nestjs/common';

/** Quantos envios o mesmo IP pode fazer para o mesmo alvo dentro da janela. */
export const LIMITE_POR_JANELA = 5;

/** Tamanho da janela deslizante. */
export const JANELA_MS = 10 * 60 * 1000;

/**
 * Teto de chaves guardadas. Sem ele, um atacante com IPs variados faria o mapa
 * crescer até derrubar o processo — a proteção contra abuso viraria o abuso.
 */
const MAXIMO_DE_CHAVES = 10_000;

/**
 * É um provider, e não um campo privado do service, por um motivo concreto: os
 * testes de integração precisam zerar a janela entre casos, e um `new`
 * escondido dentro do service não teria como ser alcançado sem expor um método
 * só-para-teste no caminho de produção.
 *
 * O módulo o registra com `useValue`, e não pela classe: os parâmetros do
 * construtor são números, que o contêiner do Nest não teria como resolver.
 */
@Injectable()
export class LimitePorIp {
  private readonly janelas = new Map<string, number[]>();

  constructor(
    private readonly limite = LIMITE_POR_JANELA,
    private readonly janelaMs = JANELA_MS,
  ) {}

  /**
   * Registra uma tentativa e devolve se ela é permitida.
   *
   * Consome a cota mesmo quando recusa? Não: a tentativa recusada não entra na
   * janela. Caso contrário quem estourou o limite nunca mais sairia dele
   * enquanto continuasse tentando, o que pune o usuário legítimo que insistiu.
   */
  permitir(chave: string, agora = Date.now()): boolean {
    const inicio = agora - this.janelaMs;
    const registros = (this.janelas.get(chave) ?? []).filter((t) => t > inicio);

    if (registros.length >= this.limite) {
      // Regrava a janela podada: senão os carimbos velhos nunca são coletados
      // para uma chave que só recebe recusas.
      this.janelas.set(chave, registros);
      return false;
    }

    registros.push(agora);
    this.janelas.set(chave, registros);
    this.podar(agora);
    return true;
  }

  /** Só para os testes: zera o estado entre casos. */
  limpar(): void {
    this.janelas.clear();
  }

  private podar(agora: number): void {
    if (this.janelas.size <= MAXIMO_DE_CHAVES) return;

    const inicio = agora - this.janelaMs;
    for (const [chave, registros] of this.janelas) {
      if (registros.every((t) => t <= inicio)) this.janelas.delete(chave);
    }

    // Ainda cheio depois de podar o que expirou: descarta as chaves mais
    // antigas. Perder contagem faz o limite ficar mais frouxo, nunca mais
    // apertado — errar para o lado de deixar o cliente enviar é o certo aqui.
    if (this.janelas.size > MAXIMO_DE_CHAVES) {
      const sobrando = this.janelas.size - MAXIMO_DE_CHAVES;
      let removidas = 0;
      for (const chave of this.janelas.keys()) {
        if (removidas++ >= sobrando) break;
        this.janelas.delete(chave);
      }
    }
  }
}

/** Uma chave por (quem envia, para onde envia). */
export function chaveDoEnvio(ip: string, tenantId: string, vehicleId: string | null): string {
  return `${ip}|${tenantId}|${vehicleId ?? 'sem-veiculo'}`;
}
