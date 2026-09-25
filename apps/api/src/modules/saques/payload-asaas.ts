import { emCentavos, ehTipoDeSaque, MOTIVO, type PedidoDeSaque, type TipoDeSaque } from '@autoconnect/shared';

/**
 * O protocolo da validação de saque da Asaas — e só ele.
 *
 * Documentação:
 * https://docs.asaas.com/docs/mecanismo-para-validacao-de-saque-via-webhooks
 *
 * A Asaas chama a nossa URL ~5 s depois de cada operação de saída solicitada
 * na conta (pela API **ou** pelo painel dela, conforme a configuração) e
 * espera um corpo que contenha, **exatamente**:
 *
 *   {"status":"APPROVED"}
 *   {"status":"REFUSED","refuseReason":"..."}
 *
 * Qualquer outra coisa — inclusive um 500 com stack trace — faz a operação ser
 * **cancelada**, e três falhas seguidas cancelam também. Cancelar é o lado
 * seguro do erro (o dinheiro não sai), mas é o lado caro do acerto: um saque
 * legítimo do dono morre junto. Por isso nada aqui lança: toda leitura devolve
 * um resultado, e quem chama transforma em `REFUSED` com motivo.
 *
 * O payload é `{ type, <objetoDaOperacao> }`, com o objeto sob um nome
 * diferente por tipo. Os campos que interessam à decisão são dois: o `id` da
 * operação (chave de idempotência) e o `value`, em **reais**.
 */

/**
 * O cabeçalho do token é o mesmo do webhook de cobrança
 * (`CABECALHO_TOKEN_ASAAS`, em `../cobranca/token-webhook`), e a comparação em
 * tempo constante também — é para isso que ela mora fora do adaptador.
 */

/** Onde mora o objeto da operação, por tipo. */
export const CAMPO_DA_OPERACAO: Record<TipoDeSaque, string> = {
  TRANSFER: 'transfer',
  BILL: 'bill',
  PIX_QR_CODE: 'pixQrCode',
  MOBILE_PHONE_RECHARGE: 'mobilePhoneRecharge',
  PIX_REFUND: 'pixRefund',
};

/**
 * `operation_type` das linhas que não são uma operação reconhecida.
 *
 * `NAO_AUTENTICADO` é um balde separado de propósito: a chave de idempotência
 * de um pedido sem token válido **nunca** é o id da operação, senão qualquer
 * um que adivinhasse o id de um saque futuro gravaria um `REFUSED` para ele e
 * a entrega verdadeira, depois, só repetiria essa recusa. Fica o SHA-256 do
 * corpo, que ninguém consegue fazer colidir com uma entrega real.
 */
export const TIPO_NAO_AUTENTICADO = 'NAO_AUTENTICADO';

/** `operation_type` de um corpo autenticado que não dá para interpretar. */
export const TIPO_INVALIDO = 'INVALIDO';

/** Nome do provedor nas duas tabelas. */
export const PROVEDOR_DE_SAQUE = 'asaas';

/** As duas respostas possíveis, na forma exata que a Asaas exige. */
export type RespostaDeValidacaoDeSaque =
  | { status: 'APPROVED' }
  | { status: 'REFUSED'; refuseReason: string };

export function aprovado(): RespostaDeValidacaoDeSaque {
  return { status: 'APPROVED' };
}

export function recusado(refuseReason: string): RespostaDeValidacaoDeSaque {
  return { status: 'REFUSED', refuseReason };
}

export type LeituraDoPedido =
  | { ok: true; pedido: PedidoDeSaque }
  | {
      ok: false;
      motivo: string;
      /** O `type` que veio, quando veio — vai para a trilha como está. */
      tipoBruto: string;
    };

/** Limita o que um corpo estranho consegue escrever na coluna. */
const LIMITE_DO_TIPO = 60;
const LIMITE_DO_ID = 120;

/**
 * Lê o corpo cru da validação. **Nunca lança** — devolve o motivo da recusa.
 *
 * Fecha-se por omissão em cada passo: corpo que não é JSON, `type` fora da
 * lista, objeto da operação ausente, `id` ausente e `value` não positivo são
 * todos recusa. Interpretar "quase certo" como "certo" é exatamente o que este
 * mecanismo existe para não fazer.
 */
export function interpretarPedidoDeSaque(corpoCru: Uint8Array): LeituraDoPedido {
  let payload: Record<string, unknown>;
  try {
    const cru: unknown = JSON.parse(Buffer.from(corpoCru).toString('utf8'));
    if (!cru || typeof cru !== 'object' || Array.isArray(cru)) {
      return { ok: false, motivo: MOTIVO.corpoInvalido, tipoBruto: TIPO_INVALIDO };
    }
    payload = cru as Record<string, unknown>;
  } catch {
    return { ok: false, motivo: MOTIVO.corpoInvalido, tipoBruto: TIPO_INVALIDO };
  }

  const tipoBruto = typeof payload.type === 'string' ? payload.type.slice(0, LIMITE_DO_TIPO) : '';
  if (!tipoBruto) return { ok: false, motivo: MOTIVO.corpoInvalido, tipoBruto: TIPO_INVALIDO };
  if (!ehTipoDeSaque(tipoBruto)) {
    return { ok: false, motivo: MOTIVO.tipoDesconhecido, tipoBruto };
  }

  const bruto = payload[CAMPO_DA_OPERACAO[tipoBruto]];
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { ok: false, motivo: MOTIVO.corpoInvalido, tipoBruto };
  }
  const operacao = bruto as Record<string, unknown>;

  // O `id` é string (UUID) em quase todos os tipos e número no pagamento de
  // conta. Os dois viram texto — é o que a coluna guarda.
  const id =
    typeof operacao.id === 'string'
      ? operacao.id.trim()
      : typeof operacao.id === 'number' && Number.isFinite(operacao.id)
        ? String(operacao.id)
        : '';
  if (!id) return { ok: false, motivo: MOTIVO.corpoInvalido, tipoBruto };

  const valorCentavos = lerValor(operacao.value);
  if (valorCentavos === null || valorCentavos <= 0n) {
    return { ok: false, motivo: MOTIVO.valorInvalido, tipoBruto };
  }

  return {
    ok: true,
    pedido: { tipo: tipoBruto, idOperacao: id.slice(0, LIMITE_DO_ID), valorCentavos },
  };
}

/**
 * `value` vem em reais, como número (`4000.5`). A conversão passa por
 * `toFixed(2)` de propósito: `emCentavos` recusa `number` fracionário, e é
 * nessa recusa que se enxerga um valor que já chegou com imprecisão de ponto
 * flutuante — arredondar aqui, uma vez, é exato até a segunda casa.
 */
function lerValor(valor: unknown): bigint | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
  // Acima disso não é valor de saque, é payload corrompido — e estouraria a
  // coluna Decimal(14,2).
  if (Math.abs(valor) >= 1e11) return null;
  try {
    return emCentavos(valor.toFixed(2));
  } catch {
    return null;
  }
}
