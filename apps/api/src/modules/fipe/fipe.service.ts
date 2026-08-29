import { Injectable, Logger } from '@nestjs/common';

/**
 * Integração com a tabela FIPE via API pública Parallelum
 * (https://deividfortuna.github.io/fipe/) — gratuita, sem chave.
 *
 * O fluxo casa marca/modelo/ano cadastrados no AutoConnect com os
 * códigos da FIPE por similaridade de nome e retorna o valor de referência.
 */

const FIPE_BASE = 'https://parallelum.com.br/fipe/api/v1/carros';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h — a tabela muda 1x por mês

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

export interface FipeEstimate {
  price: number;
  fipeCode: string;
  vehicleName: string;
  brand: string;
  yearModel: number;
  fuel: string;
  monthReference: string;
}

/** Remove acentos, pontuação e baixa caixa para comparação */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pontua a similaridade entre o nome buscado e um candidato FIPE */
function score(target: string, candidate: string): number {
  const t = normalize(target);
  const c = normalize(candidate);
  if (!t || !c) return 0;
  if (t === c) return 100;
  if (c.startsWith(t) || t.startsWith(c)) return 80;
  // proporção de palavras do alvo presentes no candidato
  const tWords = t.split(' ');
  const cWords = new Set(c.split(' '));
  const hits = tWords.filter((w) => cWords.has(w)).length;
  return (hits / tWords.length) * 60;
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
   * Retorna null quando não há correspondência confiável.
   */
  async estimate(params: {
    brandName: string;
    modelName: string;
    versionName?: string;
    yearModel: number;
    fuel?: string;
  }): Promise<FipeEstimate | null> {
    const brands = await this.get<FipeItem[]>('/marcas');
    if (!brands) return null;

    const brand = this.best(brands, params.brandName, 60);
    if (!brand) return null;

    const modelsRes = await this.get<{ modelos: FipeItem[] }>(`/marcas/${brand.codigo}/modelos`);
    if (!modelsRes?.modelos) return null;

    // tenta "modelo + versão" primeiro (mais específico), depois só o modelo
    const withVersion = params.versionName
      ? this.best(modelsRes.modelos, `${params.modelName} ${params.versionName}`, 50)
      : null;
    const model = withVersion ?? this.best(modelsRes.modelos, params.modelName, 40);
    if (!model) return null;

    const years = await this.get<FipeYear[]>(`/marcas/${brand.codigo}/modelos/${model.codigo}/anos`);
    if (!years) return null;

    const year = this.matchYear(years, params.yearModel, params.fuel);
    if (!year) return null;

    const value = await this.get<FipeValue>(
      `/marcas/${brand.codigo}/modelos/${model.codigo}/anos/${year.codigo}`,
    );
    if (!value?.Valor) return null;

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

  private best(items: FipeItem[], target: string, minScore: number): FipeItem | null {
    let bestItem: FipeItem | null = null;
    let bestScore = 0;
    for (const item of items) {
      const s = score(target, item.nome);
      if (s > bestScore) { bestScore = s; bestItem = item; }
    }
    return bestScore >= minScore ? bestItem : null;
  }

  /**
   * Códigos de ano FIPE têm o formato "2020-1" onde o sufixo é o combustível
   * (1 gasolina/flex, 2 álcool, 3 diesel). "32000" representa 0 km.
   */
  private matchYear(years: FipeYear[], yearModel: number, fuel?: string): FipeYear | null {
    const fuelSuffix = fuel === 'diesel' ? '3' : fuel === 'ethanol' ? '2' : '1';
    const sameYear = years.filter((y) => y.codigo.startsWith(`${yearModel}-`));
    if (sameYear.length === 0) return null;
    return sameYear.find((y) => y.codigo.endsWith(`-${fuelSuffix}`)) ?? sameYear[0];
  }
}
