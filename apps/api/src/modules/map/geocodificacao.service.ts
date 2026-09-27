import { Injectable, Logger } from '@nestjs/common';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';

/**
 * # Onde a loja fica, de verdade
 *
 * B8 do piloto do primeiro dia: o pino do mapa caía no **centro da cidade**. O
 * geocodificador antigo consultava só o município, persistia o resultado e
 * pronto — a Garagem Central, na Rua dos Aimorés, aparecia na Praça Sete, a
 * 1,5 km, e o botão "Como chegar" levava o cliente para lá. Duas lojas da mesma
 * cidade caíam no mesmo ponto.
 *
 * Três mudanças:
 *
 * 1. **o endereço completo vem primeiro** (rua, número, bairro, CEP, cidade), e
 *    o município é só o último recurso;
 * 2. **a precisão é gravada** (`geocode_precision`), então um ponto de município
 *    é provisório: assim que a filial ganha rua e número, a próxima leitura do
 *    mapa tenta subir para `address`. Antes, o município persistido era
 *    definitivo;
 * 3. **a coordenada que o lojista informa na tela é `manual` e nunca é
 *    sobrescrita** — ele é a autoridade sobre onde fica a própria loja.
 *
 * ## Qual serviço, e por quê
 *
 * Nominatim (OpenStreetMap) — o **mesmo** que o projeto já usava para o
 * município. Gratuito, sem chave, sem cadastro, e já com o `User-Agent` exigido
 * pela política de uso. Não introduz dependência nova: o ViaCEP, que também já
 * é usado no projeto, devolve endereço a partir do CEP e **não** devolve
 * coordenada, então não serve aqui.
 *
 * Limites respeitados: 1 requisição por segundo (a fila abaixo serializa),
 * `User-Agent` identificável, e no máximo três tentativas por filial. O
 * resultado é persistido, então o caminho comum não chama nada.
 *
 * ## Falha nunca trava nada
 *
 * Toda falha — rede, 429, 5xx, JSON quebrado, resposta vazia — vira `null`,
 * um aviso no log e um `geocoded_at` novo para não insistir a cada requisição.
 * O mapa continua desenhando o que já tem; o cadastro e o salvamento da filial
 * não sabem que isto existe.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/** Política de uso do Nominatim: no máximo 1 req/s. Com folga. */
const INTERVALO_ENTRE_CHAMADAS_MS = 1100;

/** Uma tentativa falha não se repete antes disso. */
export const JANELA_DE_NOVA_TENTATIVA_MS = 24 * 60 * 60 * 1000;

/** Caixa do Brasil, com folga. Fora dela, o resultado é lixo. */
const BRASIL = { latMin: -34.5, latMax: 6.5, lngMin: -74.5, lngMax: -33.5 };

/**
 * Tipos que o Nominatim devolve quando caiu no **município** em vez do
 * endereço. Sem esta checagem, uma busca por rua que o OSM não conhece voltaria
 * com o ponto da cidade e seria gravada como `address` — o defeito original com
 * outro nome.
 */
const TIPOS_DE_MUNICIPIO = new Set([
  'city', 'town', 'village', 'municipality', 'administrative',
  'state', 'county', 'region', 'hamlet', 'suburb', 'neighbourhood',
  'city_district', 'district', 'borough', 'quarter',
]);

export type PrecisaoDeGeocodificacao = 'manual' | 'address' | 'city';

/** O que o serviço precisa saber da filial. */
export interface FilialLocalizavel {
  id: string;
  addressLine: string | null;
  addressNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodePrecision: PrecisaoDeGeocodificacao | null;
  geocodedAt: Date | null;
}

export interface Localizacao {
  latitude: number;
  longitude: number;
  precisao: PrecisaoDeGeocodificacao | null;
}

interface RespostaNominatim {
  lat: string;
  lon: string;
  class?: string;
  type?: string;
  addresstype?: string;
}

/** A busca está desligada? (a suíte de integração não fala com a Nominatim) */
export function geocodificacaoDesligada(): boolean {
  return process.env.GEOCODIFICACAO_DESLIGADA === '1';
}

/**
 * As consultas a tentar, da mais específica para a mais genérica.
 *
 * Exportada porque é a regra que o teste fixa: o endereço vem antes do
 * município, e o município sozinho continua existindo como último recurso —
 * loja sem rua cadastrada não pode ficar fora do mapa.
 */
export function consultasDe(filial: FilialLocalizavel): { q: string; alvo: 'address' | 'city' }[] {
  const rua = [filial.addressLine, filial.addressNumber].filter(Boolean).join(', ');
  const cidade = [filial.city, filial.state].filter(Boolean).join(', ');
  const cep = (filial.postalCode ?? '').replace(/\D/g, '');

  const consultas: { q: string; alvo: 'address' | 'city' }[] = [];
  const juntar = (partes: (string | null)[], alvo: 'address' | 'city') => {
    const q = partes.filter((p) => p && p.trim()).join(', ');
    if (q && !consultas.some((c) => c.q === q)) consultas.push({ q: `${q}, Brasil`, alvo });
  };

  if (rua && cidade) {
    // Completa primeiro. O CEP é o que desempata duas ruas de mesmo nome.
    juntar([rua, filial.neighborhood, cidade, cep ? cep : null], 'address');
    // Sem bairro e sem CEP: o OSM brasileiro tem cobertura irregular de bairro,
    // e um bairro que ele não conhece derruba a busca inteira.
    juntar([rua, cidade], 'address');
  } else if (cep.length === 8 && cidade) {
    // Sem rua, mas com CEP: ainda é melhor que o centro do município.
    juntar([cep, cidade], 'address');
  }

  if (cidade) juntar([cidade], 'city');

  return consultas;
}

@Injectable()
export class GeocodificacaoService {
  private readonly logger = new Logger(GeocodificacaoService.name);

  /**
   * A escrita acontece a partir de uma rota **pública** (o mapa) e em filial de
   * qualquer concessionária: a policy `leitura_publica` é só de SELECT, e é
   * assim que deve ser. A travessia é declarada aqui, como no `MapService`.
   */
  constructor(private readonly privilegiado: PrivilegedPrismaService) {}

  /** Serializa as chamadas de saída para respeitar o 1 req/s da Nominatim. */
  private static fila: Promise<unknown> = Promise.resolve();
  private static ultimaChamada = 0;

  /**
   * Espaço mínimo entre duas chamadas de saída.
   *
   * É um `get` e não uma constante direta para que o teste possa derivar uma
   * subclasse sem espera — a alternativa seria um relógio falso brigando com a
   * fila, ou 1,1 s de sono de verdade por caso.
   */
  protected get intervaloMs(): number {
    return INTERVALO_ENTRE_CHAMADAS_MS;
  }

  /**
   * A localização da filial, geocodificando e persistindo quando fizer sentido.
   *
   * Nunca lança: devolve o que a filial já tem se não puder melhorar.
   */
  async localizar(filial: FilialLocalizavel): Promise<Localizacao | null> {
    const atual: Localizacao | null =
      filial.latitude != null && filial.longitude != null
        ? { latitude: filial.latitude, longitude: filial.longitude, precisao: filial.geocodePrecision }
        : null;

    if (!this.valeTentar(filial)) return atual;

    const consultas = consultasDe(filial);
    if (consultas.length === 0) return atual;

    for (const consulta of consultas) {
      const achado = await this.consultar(consulta.q);
      if (!achado) continue;

      // Uma busca de endereço que voltou com o ponto do município é município,
      // não endereço — mesmo que a consulta fosse específica.
      const precisao: PrecisaoDeGeocodificacao =
        consulta.alvo === 'address' && !this.ehMunicipio(achado) ? 'address' : 'city';

      // Só desce de precisão quando não há nada: um `address` gravado não é
      // rebaixado para `city` por uma tentativa ruim de hoje.
      if (atual && atual.precisao === 'address' && precisao === 'city') break;

      await this.gravar(filial.id, { latitude: achado.lat, longitude: achado.lng, precisao });
      return { latitude: achado.lat, longitude: achado.lng, precisao };
    }

    // Nada encontrado: marca a tentativa para não insistir em toda requisição.
    await this.gravar(filial.id, null);
    return atual;
  }

  /**
   * Agenda uma geocodificação sem que ninguém espere por ela.
   *
   * É o que o salvamento da filial usa: o lojista clica em "Salvar filial" e a
   * resposta não fica pendurada numa chamada a um serviço de terceiro. Falha
   * não pode travar o cadastro — aqui ela nem é vista.
   */
  agendar(filial: FilialLocalizavel): void {
    void this.localizar(filial).catch((err) =>
      this.logger.warn(`Geocodificação em segundo plano falhou (${filial.id}): ${err}`),
    );
  }

  /** Quando uma nova tentativa faz sentido. */
  private valeTentar(filial: FilialLocalizavel): boolean {
    if (geocodificacaoDesligada()) return false;
    // O lojista marcou o ponto: ele é a autoridade.
    if (filial.geocodePrecision === 'manual') return false;
    // Já está no endereço — não há para onde subir.
    if (filial.geocodePrecision === 'address') return false;

    const temCoordenada = filial.latitude != null && filial.longitude != null;
    const temEndereco = Boolean(filial.addressLine || (filial.postalCode ?? '').replace(/\D/g, '').length === 8);

    // Com o município já resolvido e nenhum endereço para tentar, insistir só
    // gastaria a cota da Nominatim para chegar ao mesmo ponto.
    if (temCoordenada && !temEndereco) return false;

    // Tentou há pouco (com ou sem sucesso): espera a janela.
    if (filial.geocodedAt && Date.now() - filial.geocodedAt.getTime() < JANELA_DE_NOVA_TENTATIVA_MS) {
      return false;
    }

    return Boolean(filial.city || temEndereco);
  }

  private ehMunicipio(achado: { tipo: string | null }): boolean {
    return !!achado.tipo && TIPOS_DE_MUNICIPIO.has(achado.tipo);
  }

  /** Uma consulta à Nominatim. Devolve `null` para qualquer falha. */
  private consultar(q: string): Promise<{ lat: number; lng: number; tipo: string | null } | null> {
    const execucao = GeocodificacaoService.fila.then(async () => {
      const espera = this.intervaloMs - (Date.now() - GeocodificacaoService.ultimaChamada);
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      GeocodificacaoService.ultimaChamada = Date.now();

      try {
        const url =
          `${NOMINATIM}?q=${encodeURIComponent(q)}` +
          '&format=json&limit=1&countrycodes=br&addressdetails=0';
        const res = await fetch(url, {
          headers: { 'User-Agent': 'AutoConnect/1.0 (mapa de concessionarias)' },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          this.logger.warn(`Nominatim respondeu ${res.status} para "${q}"`);
          return null;
        }
        const dados = (await res.json()) as RespostaNominatim[];
        const primeiro = Array.isArray(dados) ? dados[0] : undefined;
        if (!primeiro) return null;

        const lat = parseFloat(primeiro.lat);
        const lng = parseFloat(primeiro.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (lat < BRASIL.latMin || lat > BRASIL.latMax || lng < BRASIL.lngMin || lng > BRASIL.lngMax) {
          this.logger.warn(`Nominatim devolveu ponto fora do Brasil para "${q}": ${lat},${lng}`);
          return null;
        }

        return { lat, lng, tipo: primeiro.addresstype ?? primeiro.type ?? null };
      } catch (err) {
        this.logger.warn(`Geocodificação falhou para "${q}": ${err}`);
        return null;
      }
    });

    // A fila segue viva mesmo se esta consulta rejeitar.
    GeocodificacaoService.fila = execucao.catch(() => undefined);
    return execucao;
  }

  /** Persiste o resultado (ou só a tentativa, quando não houve resultado). */
  private async gravar(
    branchId: string,
    achado: { latitude: number; longitude: number; precisao: PrecisaoDeGeocodificacao } | null,
  ): Promise<void> {
    await this.privilegiado.dealershipBranch
      .update({
        where: { id: branchId },
        data: {
          geocodedAt: new Date(),
          ...(achado
            ? {
                latitude: achado.latitude,
                longitude: achado.longitude,
                geocodePrecision: achado.precisao,
              }
            : {}),
        },
      })
      // Gravar é otimização, não requisito: o pino aparece igual sem o cache.
      .catch((err) => this.logger.warn(`Não foi possível gravar a coordenada: ${err}`));
  }
}
