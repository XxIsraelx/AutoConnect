import { Injectable, Logger } from '@nestjs/common';

/**
 * Integração com a tabela FIPE via API pública Parallelum
 * (https://deividfortuna.github.io/fipe/) — gratuita, sem chave.
 *
 * # B16 — a FIPE errava a variante e culpava o cadastro
 *
 * O piloto do primeiro dia cadastrou um **Chevrolet Onix 2022, flex, 1.0
 * Turbo** e a tela respondeu *"Não encontramos este veículo na tabela FIPE —
 * confira marca, modelo e ano"*. O cadastro estava certo.
 *
 * O que acontecia: "Onix 1.0 Turbo" pontuava abaixo do mínimo, então caía no
 * modelo sozinho — e aí **38 variantes do Onix empatavam em 80 pontos**, com
 * `score > bestScore` ficando com a primeira da lista: *"ONIX Lollapalooza 1.0
 * F.Power 5p Mec."*, cujo único ano é **2014**. Sem 2022, não havia ano para
 * casar, e a mensagem mandava o lojista conferir o que estava correto.
 *
 * Três mudanças:
 *
 * 1. **a pontuação deixa de empatar.** Palavras a mais no candidato passaram a
 *    custar: "ONIX 1.0 Turbo" ganha de "ONIX Lollapalooza 1.0" para quem
 *    cadastrou "Onix". Versão, motor e câmbio do cadastro entram como bônus;
 * 2. **o ano desempata antes da escolha.** Os melhores candidatos são
 *    consultados e quem não tem o ano do cadastro é eliminado — a variante de
 *    2014 não concorre com um carro 2022. Era a causa direta do caso relatado;
 * 3. **a confiança é dita.** Quando o desempate é apertado ou a versão não
 *    casa, a resposta vem como **estimativa** e traz as outras variantes, para
 *    o lojista escolher. Afirmar um valor errado com confiança é pior que
 *    mostrar uma faixa e dizer que é aproximada.
 *
 * O custo em chamadas é limitado: no máximo `MAX_CANDIDATOS` consultas de ano,
 * todas em paralelo e com cache de 24h (a tabela muda uma vez por mês).
 */

const FIPE_BASE = 'https://parallelum.com.br/fipe/api/v1/carros';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h — a tabela muda 1x por mês

/**
 * Quantas variantes chegam à etapa de conferir o ano.
 *
 * Seis porque é o que separa o Onix (38 variantes, muitas de anos antigos) sem
 * transformar uma estimativa de preço em 38 requisições a um serviço gratuito.
 */
const MAX_CANDIDATOS = 6;

/**
 * Abreviaturas da FIPE contra o que o lojista escreve.
 *
 * A FIPE grafa turbo como "TB"; o cadastro diz "1.0 Turbo". Sem isto, a variante
 * turbo de 2022 não era reconhecida como a que o lojista descreveu — e a
 * escolha caía no empate que o B16 relata.
 */
const SINONIMOS: Record<string, string[]> = {
  turbo: ['turbo', 'tb', 'tsi', 't'],
  tb: ['turbo', 'tb'],
  automatico: ['automatico', 'aut', 'at', 'cvt'],
  manual: ['manual', 'mec', 'mt'],
  flex: ['flex', 'flexpower', 'f.power'],
};

interface FipeItem { codigo: string; nome: string }
interface FipeYear { codigo: string; nome: string }
interface FipeValue {
  Valor: string;          // "R$ 45.678,00"
  Marca: string;
  Modelo: string;
  AnoModelo: number;
  Combustivel: string;
  CodigoFipe: string;
  MesReferencia: string;
}

/** Quão confiável é a variante escolhida — a tela fala diferente em cada caso. */
export type ConfiancaFipe = 'alta' | 'media' | 'baixa';

export interface VarianteFipe {
  /** Código do modelo na FIPE — o que a tela devolve para fixar a escolha. */
  modelCode: string;
  name: string;
}

export interface FipeEstimate {
  price: number;
  fipeCode: string;
  vehicleName: string;
  brand: string;
  yearModel: number;
  fuel: string;
  monthReference: string;
  /** Código do modelo escolhido, para o lojista repetir ou trocar a escolha. */
  modelCode: string;
  confianca: ConfiancaFipe;
  /**
   * Outras variantes do mesmo modelo que **têm o ano cadastrado** — as que o
   * lojista poderia ter querido. Vazio quando a escolha é única.
   */
  alternativas: VarianteFipe[];
}

/** Remove acentos, pontuação e baixa caixa para comparação */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function palavras(s: string): string[] {
  return normalize(s)
    .split(' ')
    // Ponto no meio é significativo ("1.0", "F.Power"); no fim é abreviatura
    // ("Mec.", "Aut."), e deixá-lo lá fazia "mec." nunca casar com "mec".
    .map((p) => p.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

/**
 * Pontua a similaridade entre o nome buscado e um candidato FIPE.
 *
 * A diferença em relação à versão anterior é a **penalidade por palavra a
 * mais**: antes, todo candidato que começasse com o alvo valia 80, e 38
 * variantes do Onix empatavam nesse 80. Agora "ONIX 1.0 Turbo" vale mais que
 * "ONIX Lollapalooza 1.0 F.Power 5p Mec." para quem buscou "Onix" — o que é o
 * comportamento que um humano esperaria.
 */
export function pontuar(alvo: string, candidato: string): number {
  const t = palavras(alvo);
  const c = palavras(candidato);
  if (t.length === 0 || c.length === 0) return 0;

  const conjuntoC = new Set(c);
  const acertos = t.filter((p) => conjuntoC.has(p)).length;
  if (acertos === 0) return 0;

  // Cobertura do alvo: quanto do que se pediu aparece no candidato.
  const cobertura = acertos / t.length;
  // Excesso: palavras do candidato que ninguém pediu. Cada uma custa, com piso,
  // senão nome longo e nome curto empatam e a ordem da lista decide.
  const excesso = Math.max(0, c.length - acertos);
  const penalidade = Math.min(60, excesso * 8);

  let nota = cobertura * 100 - penalidade;
  // Igualdade exata não perde para nada.
  if (normalize(alvo) === normalize(candidato)) nota = 100;

  return Math.max(0, Math.round(nota));
}

/**
 * Bônus pelo que o cadastro já sabe: versão, motor e câmbio.
 *
 * Não entra na pontuação principal porque a versão é escrita à mão pelo lojista
 * ("1.0 Turbo", "LTZ", "Drive") e não pode **derrubar** um candidato — só
 * favorecer quem a contém.
 */
/**
 * O candidato contém **tudo** o que o cadastro descreveu?
 *
 * É o critério de confiança, e substitui a margem de pontos: "alta" é quando uma
 * variante — e só uma — cobre modelo, versão e motor do cadastro. Explicável
 * numa frase, o que uma diferença de pontuação não é.
 */
export function cobreOCadastro(candidato: string, alvo: string[]): boolean {
  const c = new Set(palavras(candidato));
  return alvo.every((p) => (SINONIMOS[p] ?? [p]).some((s) => c.has(s)));
}

/** As palavras que descrevem o veículo, do jeito que o lojista as escreveu. */
export function descricaoDoCadastro(params: {
  modelName: string;
  versionName?: string;
  engine?: string;
}): string[] {
  return palavras([params.modelName, params.versionName, params.engine].filter(Boolean).join(' '));
}

export function bonusDoCadastro(
  candidato: string,
  extras: { versionName?: string; engine?: string; transmission?: string },
): number {
  const c = new Set(palavras(candidato));
  const alvo = [extras.versionName, extras.engine].filter(Boolean).join(' ');
  let bonus = 0;

  for (const p of palavras(alvo)) {
    if ((SINONIMOS[p] ?? [p]).some((s) => c.has(s))) bonus += 12;
  }

  if (extras.transmission) {
    const automatico = /^(automatic|cvt|automated_manual)$/.test(extras.transmission);
    const temAut = c.has('aut') || c.has('automatico') || c.has('cvt') || c.has('at');
    const temMec = c.has('mec') || c.has('manual') || c.has('mt');
    if (automatico && temAut) bonus += 10;
    if (!automatico && temMec) bonus += 10;
    if (automatico && temMec) bonus -= 10;
    if (!automatico && temAut) bonus -= 10;
  }

  return Math.min(40, bonus);
}

/**
 * Sufixos de combustível do código de ano da FIPE (`"2022-5"`), em ordem de
 * preferência.
 *
 * **Flex é `5`, não `1`.** O código antigo mandava flex para `1` (gasolina) e
 * só não errava por causa do "pega o primeiro do ano" que vinha depois — o que
 * significa que a escolha do combustível nunca foi de fato exercida. Conferido
 * contra a API ao vivo: o Onix 2022 flex é `2022-5`.
 *
 * A lista é de preferência, e não de exigência: carro cadastrado como gasolina
 * cujo único código é flex continua tendo preço.
 */
export function sufixosDeCombustivel(fuel?: string): string[] {
  switch (fuel) {
    case 'flex':     return ['5', '1'];
    case 'gasoline': return ['1', '5'];
    case 'ethanol':  return ['2', '5'];
    case 'diesel':   return ['3'];
    // Híbrido, elétrico e GNV não têm sufixo próprio na FIPE: quem decide é o
    // ano, e o primeiro código daquele ano serve.
    default:         return [];
  }
}

@Injectable()
export class FipeService {
  private readonly logger = new Logger(FipeService.name);
  private cache = new Map<string, { at: number; data: unknown }>();

  private async get<T>(path: string): Promise<T | null> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data as T;
    try {
      const res = await fetch(`${FIPE_BASE}${path}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as T;
      this.cache.set(path, { at: Date.now(), data });
      return data;
    } catch (err) {
      this.logger.warn(`FIPE indisponível em ${path}: ${err}`);
      return null;
    }
  }

  /**
   * Estima o valor FIPE a partir dos dados do formulário.
   *
   * Devolve `null` só quando **nada** casa — nem a marca, nem o modelo, nem o
   * ano em variante nenhuma. Quando casa com folga pequena, devolve com
   * `confianca` abaixo de `alta` e as alternativas, em vez de afirmar.
   */
  async estimate(params: {
    brandName: string;
    modelName: string;
    versionName?: string;
    engine?: string;
    transmission?: string;
    yearModel: number;
    fuel?: string;
    /** Variante escolhida pelo lojista — ganha de qualquer heurística. */
    modelCode?: string;
  }): Promise<FipeEstimate | null> {
    const brands = await this.get<FipeItem[]>('/marcas');
    if (!brands) return null;

    const marca = this.melhor(brands, params.brandName, 55);
    if (!marca) return null;

    const modelsRes = await this.get<{ modelos: FipeItem[] }>(`/marcas/${marca.item.codigo}/modelos`);
    if (!modelsRes?.modelos) return null;

    /* ── O lojista já escolheu a variante ──────────────────── */
    if (params.modelCode) {
      const escolhido = modelsRes.modelos.find((m) => String(m.codigo) === String(params.modelCode));
      if (escolhido) {
        const valor = await this.valorDe(marca.item, escolhido, params.yearModel, params.fuel);
        if (valor) {
          return {
            ...valor,
            modelCode: String(escolhido.codigo),
            // Escolha humana: não há o que estimar.
            confianca: 'alta',
            alternativas: [],
          };
        }
      }
    }

    /* ── Candidatos, pontuados ─────────────────────────────── */
    const descricao = descricaoDoCadastro(params);
    const candidatos = modelsRes.modelos
      .map((m) => ({
        item: m,
        cobre: cobreOCadastro(m.nome, descricao),
        nota:
          pontuar(params.modelName, m.nome) +
          bonusDoCadastro(m.nome, {
            versionName: params.versionName,
            engine: params.engine,
            transmission: params.transmission,
          }),
      }))
      .filter((c) => c.nota > 0)
      // Quem cobre a descrição inteira vem primeiro; a pontuação desempata
      // dentro de cada grupo, e o nome desempata a pontuação, para que duas
      // execuções iguais escolham o mesmo.
      .sort((a, b) =>
        Number(b.cobre) - Number(a.cobre) ||
        b.nota - a.nota ||
        a.item.nome.localeCompare(b.item.nome),
      );

    if (candidatos.length === 0) return null;

    /* ── O ano elimina quem não pode ser ──────────────────── */
    const finalistas = candidatos.slice(0, MAX_CANDIDATOS);
    const comAno = await Promise.all(
      finalistas.map(async (c) => {
        const anos = await this.get<FipeYear[]>(
          `/marcas/${marca.item.codigo}/modelos/${c.item.codigo}/anos`,
        );
        return { ...c, ano: anos ? this.casarAno(anos, params.yearModel, params.fuel) : null };
      }),
    );

    const viaveis = comAno.filter((c) => c.ano !== null);
    if (viaveis.length === 0) {
      this.logger.warn(
        `FIPE: nenhuma variante de "${params.modelName}" (${marca.item.nome}) tem o ano ${params.yearModel}`,
      );
      return null;
    }

    const escolhido = viaveis[0];

    const valor = await this.valorDe(marca.item, escolhido.item, params.yearModel, params.fuel);
    if (!valor) return null;

    /**
     * A confiança, numa regra que dá para explicar ao lojista:
     *
     * - **alta** — uma variante, e só uma, contém tudo o que ele cadastrou
     *   (modelo, versão e motor) e tem o ano dele;
     * - **baixa** — ele informou uma versão e a variante escolhida não menciona
     *   nada dela: o valor pode ser de outro acabamento;
     * - **média** — o resto, que é o caso honesto de ambiguidade (o mesmo
     *   "Onix 1.0 Turbo" existe como hatch e como Plus, com preços diferentes).
     *
     * Antes isto era uma diferença de pontos, que ninguém consegue justificar
     * numa tela.
     */
    const cobrem = viaveis.filter((c) => c.cobre);
    const versaoCasou =
      !params.versionName ||
      bonusDoCadastro(escolhido.item.nome, { versionName: params.versionName }) > 0;

    const confianca: ConfiancaFipe =
      !versaoCasou
        ? 'baixa'
        : cobrem.length === 1 && cobrem[0].item.codigo === escolhido.item.codigo && marca.nota >= 80
          ? 'alta'
          : 'media';

    return {
      ...valor,
      modelCode: String(escolhido.item.codigo),
      confianca,
      alternativas:
        confianca === 'alta'
          ? []
          : viaveis.slice(1, MAX_CANDIDATOS).map((c) => ({
              modelCode: String(c.item.codigo),
              name: c.item.nome,
            })),
    };
  }

  /** Lista as variantes do modelo que têm o ano cadastrado — para o `select`. */
  async variantes(params: {
    brandName: string;
    modelName: string;
    yearModel: number;
    fuel?: string;
  }): Promise<VarianteFipe[]> {
    const brands = await this.get<FipeItem[]>('/marcas');
    if (!brands) return [];
    const marca = this.melhor(brands, params.brandName, 55);
    if (!marca) return [];

    const modelsRes = await this.get<{ modelos: FipeItem[] }>(`/marcas/${marca.item.codigo}/modelos`);
    if (!modelsRes?.modelos) return [];

    const candidatos = modelsRes.modelos
      .map((m) => ({ item: m, nota: pontuar(params.modelName, m.nome) }))
      .filter((c) => c.nota > 0)
      .sort((a, b) => b.nota - a.nota || a.item.nome.localeCompare(b.item.nome))
      .slice(0, MAX_CANDIDATOS * 2);

    const comAno = await Promise.all(
      candidatos.map(async (c) => {
        const anos = await this.get<FipeYear[]>(
          `/marcas/${marca.item.codigo}/modelos/${c.item.codigo}/anos`,
        );
        return { c, temAno: anos ? this.casarAno(anos, params.yearModel, params.fuel) !== null : false };
      }),
    );

    return comAno
      .filter((x) => x.temAno)
      .map((x) => ({ modelCode: String(x.c.item.codigo), name: x.c.item.nome }));
  }

  /** O valor de um (marca, modelo, ano) já resolvido. */
  private async valorDe(
    marca: FipeItem,
    modelo: FipeItem,
    yearModel: number,
    fuel?: string,
  ): Promise<Omit<FipeEstimate, 'modelCode' | 'confianca' | 'alternativas'> | null> {
    const anos = await this.get<FipeYear[]>(`/marcas/${marca.codigo}/modelos/${modelo.codigo}/anos`);
    if (!anos) return null;
    const ano = this.casarAno(anos, yearModel, fuel);
    if (!ano) return null;

    const value = await this.get<FipeValue>(
      `/marcas/${marca.codigo}/modelos/${modelo.codigo}/anos/${ano.codigo}`,
    );
    if (!value?.Valor) return null;

    // `[^\d,]` já descarta o "R$" e o ponto de milhar: "R$ 45.678,00" → "45678,00".
    const price = Number(value.Valor.replace(/[^\d,]/g, '').replace(',', '.'));
    if (!price || Number.isNaN(price)) return null;

    return {
      price,
      fipeCode: value.CodigoFipe,
      vehicleName: value.Modelo,
      brand: value.Marca,
      yearModel: value.AnoModelo,
      fuel: value.Combustivel,
      monthReference: value.MesReferencia?.trim() ?? '',
    };
  }

  private melhor(
    items: FipeItem[],
    alvo: string,
    minimo: number,
  ): { item: FipeItem; nota: number } | null {
    let escolhido: FipeItem | null = null;
    let melhorNota = 0;
    for (const item of items) {
      const nota = pontuar(alvo, item.nome);
      if (nota > melhorNota) { melhorNota = nota; escolhido = item; }
    }
    return escolhido && melhorNota >= minimo ? { item: escolhido, nota: melhorNota } : null;
  }

  /** `"2022-5"` — o sufixo é o combustível. `"32000"` representa 0 km. */
  private casarAno(anos: FipeYear[], yearModel: number, fuel?: string): FipeYear | null {
    const mesmoAno = anos.filter((y) => y.codigo.startsWith(`${yearModel}-`));
    if (mesmoAno.length === 0) return null;
    for (const sufixo of sufixosDeCombustivel(fuel)) {
      const achado = mesmoAno.find((y) => y.codigo.endsWith(`-${sufixo}`));
      if (achado) return achado;
    }
    return mesmoAno[0];
  }
}
