/**
 * Chave de acesso da NF-e: 44 posições que identificam uma nota no país inteiro.
 *
 * É o **contrato comum** entre as duas trilhas do plano fiscal
 * (`docs/planos/plano-fiscal-renave-nfe.md`): a NF-e produz a chave, o RENAVE a
 * recebe — digitada pela loja no registro manual, ou lida da nota autorizada
 * mais tarde. Nasceu antes da divisão entre as sessões para nenhuma das duas
 * precisar escrever no arquivo da outra. **Mudou? Peça no PR.**
 *
 * Composição (Manual de Orientação do Contribuinte):
 *
 * | posições | campo                                  |
 * |----------|----------------------------------------|
 * | 1–2      | código IBGE da UF do emitente          |
 * | 3–6      | ano e mês da emissão (AAMM)            |
 * | 7–20     | CNPJ do emitente (ou CPF com zeros)    |
 * | 21–22    | modelo (55 = NF-e, 65 = NFC-e)         |
 * | 23–25    | série                                  |
 * | 26–34    | número da nota                         |
 * | 35       | tipo de emissão                        |
 * | 36–43    | código numérico                        |
 * | 44       | dígito verificador                     |
 *
 * **CNPJ alfanumérico.** Desde julho de 2026 a Receita emite CNPJ com letras
 * nas 12 primeiras posições (IN RFB 2.229/2024), e a chave passou a carregá-lo.
 * O dígito verificador da chave usa o valor ASCII do caractere menos 48 — para
 * algarismo, é o próprio algarismo; para letra, `A` vale 17. Uma validação que
 * só aceitasse dígitos recusaria a nota de toda empresa aberta a partir daí.
 */

/** Códigos IBGE das 27 unidades da federação. */
const CODIGOS_IBGE_DAS_UFS: Readonly<Record<string, string>> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
  '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

/** Modelos que usam esta chave. O plano fiscal só emite o 55. */
export const MODELOS_DE_NOTA = { '55': 'nfe', '65': 'nfce' } as const;
export type ModeloDeNota = (typeof MODELOS_DE_NOTA)[keyof typeof MODELOS_DE_NOTA];

/**
 * 12 alfanuméricos (CNPJ novo) ou algarismos, seguidos de 2 dígitos
 * verificadores do CNPJ, que continuam numéricos.
 */
const FORMATO_DA_CHAVE = /^\d{6}[0-9A-Z]{12}\d{26}$/;

export interface CamposDaChaveNfe {
  /** A chave na forma canônica: 44 caracteres, maiúsculos, sem espaço. */
  chave: string;
  uf: string;
  /** Primeiro dia do mês de emissão, no formato `AAAA-MM`. */
  anoMes: string;
  /** CNPJ (14) ou, para emitente pessoa física, o CPF com zeros à esquerda. */
  documentoDoEmitente: string;
  modelo: ModeloDeNota;
  serie: number;
  numero: number;
  tipoDeEmissao: number;
  codigoNumerico: string;
  digitoVerificador: number;
}

/**
 * Tira o que a pessoa costuma colar junto da chave: espaços do DANFE
 * (`3526 1012 3456…`), pontos, o prefixo `NFe` do XML. Letras viram
 * maiúsculas porque o CNPJ alfanumérico é maiúsculo por definição.
 */
export function normalizarChaveNfe(bruta: string | null | undefined): string {
  if (!bruta) return '';
  return bruta
    .toUpperCase()
    .replace(/^\s*NFE/, '')
    .replace(/[^0-9A-Z]/g, '');
}

/** Valor de um caractere no cálculo do dígito: ASCII − 48. */
function valorDoCaractere(c: string): number {
  return c.charCodeAt(0) - 48;
}

/**
 * Dígito verificador módulo 11 das 43 primeiras posições, com pesos de 2 a 9
 * aplicados da direita para a esquerda. Resto 0 ou 1 dá dígito 0.
 */
export function digitoVerificadorDaChave(primeiras43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = primeiras43.length - 1; i >= 0; i--) {
    soma += valorDoCaractere(primeiras43[i]!) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * Lê a chave, ou devolve `null` quando ela não é uma chave possível.
 *
 * `null` é resultado esperado, como em `normalizarTelefoneBr`: a tela
 * transforma em erro de campo. Confere formato, UF, mês, modelo e dígito
 * verificador — o suficiente para pegar o dígito trocado e a chave colada pela
 * metade. **Não** confere se a nota existe nem se está autorizada: isso é
 * pergunta para a SEFAZ, e quem pergunta é o emissor.
 */
export function lerChaveNfe(bruta: string | null | undefined): CamposDaChaveNfe | null {
  const chave = normalizarChaveNfe(bruta);
  if (!FORMATO_DA_CHAVE.test(chave)) return null;

  const uf = CODIGOS_IBGE_DAS_UFS[chave.slice(0, 2)];
  if (!uf) return null;

  const ano = 2000 + Number(chave.slice(2, 4));
  const mes = Number(chave.slice(4, 6));
  if (mes < 1 || mes > 12) return null;

  const modelo = MODELOS_DE_NOTA[chave.slice(20, 22) as keyof typeof MODELOS_DE_NOTA];
  if (!modelo) return null;

  const digitoVerificador = Number(chave[43]);
  if (digitoVerificadorDaChave(chave.slice(0, 43)) !== digitoVerificador) return null;

  return {
    chave,
    uf,
    anoMes: `${ano}-${String(mes).padStart(2, '0')}`,
    documentoDoEmitente: chave.slice(6, 20),
    modelo,
    serie: Number(chave.slice(22, 25)),
    numero: Number(chave.slice(25, 34)),
    tipoDeEmissao: Number(chave[34]),
    codigoNumerico: chave.slice(35, 43),
    digitoVerificador,
  };
}

export function chaveNfeValida(bruta: string | null | undefined): boolean {
  return lerChaveNfe(bruta) !== null;
}

/** Agrupa de 4 em 4, como o DANFE imprime — para mostrar, nunca para gravar. */
export function formatarChaveNfe(chave: string): string {
  return normalizarChaveNfe(chave).replace(/(.{4})(?=.)/g, '$1 ');
}
