/* ─────────────────────────────────────────────────────────
   Importação de estoque via planilha CSV

   Faz o parse do arquivo, normaliza cabeçalhos (acentos,
   maiúsculas), converte números pt-BR ("65.900,50", "R$ 1.234")
   e valida célula a célula. Cada erro aponta linha da planilha,
   coluna, valor encontrado e como deveria estar preenchido.
───────────────────────────────────────────────────────── */

export interface ImportRowData {
  brandName: string;
  modelName: string;
  versionName?: string;
  condition: 'new' | 'used' | 'semi_new' | 'demo';
  yearModel: number;
  yearMake: number;
  mileageKm: number;
  color?: string;
  fuel?: 'gasoline' | 'ethanol' | 'flex' | 'diesel' | 'hybrid' | 'electric' | 'gnv';
  transmission?: 'manual' | 'automatic' | 'cvt' | 'automated_manual';
  engine?: string;
  doors?: number;
  price: number;
  promoPrice?: number;
  description?: string;
}

export interface CellError {
  /** Linha na planilha (1 = cabeçalho, dados começam em 2) */
  line: number;
  /** Índice da linha de dados (0-based) — para destacar na preview */
  rowIndex: number;
  column: string;
  value: string;
  message: string;
  hint: string;
}

export interface ParsedSheet {
  /** Cabeçalhos originais reconhecidos, na ordem do arquivo */
  columns: string[];
  /** Células cruas para a preview (mesma ordem de columns) */
  rawRows: string[][];
  /** Linhas convertidas — só é confiável quando errors.length === 0 */
  rows: ImportRowData[];
  errors: CellError[];
  /** Colunas obrigatórias ausentes no arquivo */
  missingColumns: string[];
}

/* ── Definição das colunas ───────────────────────────────── */

export const TEMPLATE_COLUMNS = [
  'marca', 'modelo', 'versao', 'condicao', 'ano_modelo', 'ano_fabricacao',
  'quilometragem', 'cor', 'combustivel', 'cambio', 'motor', 'portas',
  'preco', 'preco_promocional', 'descricao',
] as const;

const REQUIRED = ['marca', 'modelo', 'condicao', 'ano_modelo', 'ano_fabricacao', 'quilometragem', 'preco'];

const CONDITION_MAP: Record<string, ImportRowData['condition']> = {
  'novo': 'new', 'nova': 'new', '0km': 'new', '0 km': 'new',
  'usado': 'used', 'usada': 'used',
  'seminovo': 'semi_new', 'semi-novo': 'semi_new', 'semi novo': 'semi_new', 'semi_novo': 'semi_new',
  'demo': 'demo', 'demonstracao': 'demo', 'test drive': 'demo',
};
const FUEL_MAP: Record<string, NonNullable<ImportRowData['fuel']>> = {
  'flex': 'flex', 'gasolina': 'gasoline', 'etanol': 'ethanol', 'alcool': 'ethanol',
  'diesel': 'diesel', 'hibrido': 'hybrid', 'eletrico': 'electric', 'gnv': 'gnv',
};
const TRANSMISSION_MAP: Record<string, NonNullable<ImportRowData['transmission']>> = {
  'manual': 'manual', 'automatico': 'automatic', 'automatica': 'automatic',
  'cvt': 'cvt', 'automatizado': 'automated_manual', 'automatizada': 'automated_manual',
};

const THIS_YEAR = new Date().getFullYear();

/* ── Helpers ─────────────────────────────────────────────── */

/** Remove acentos e baixa caixa — usado p/ cabeçalhos e enums */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** "R$ 65.900,50" → 65900.5 · "65000" → 65000 · retorna NaN se inválido */
function parseBrlNumber(raw: string): number {
  let s = raw.trim().replace(/^r\$\s*/i, '').replace(/\s/g, '');
  if (!s) return NaN;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma) {
    // vírgula é decimal, pontos são milhar: 65.900,50
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasDot) {
    // só pontos: se parecer milhar (3 dígitos após cada ponto), remove
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    // senão mantém como decimal: 65900.5
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/* ── Parser CSV (separador ; ou , · aspas com escape "") ─── */

export function parseCsv(text: string): string[][] {
  const content = text.replace(/^﻿/, ''); // remove BOM
  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }

  // descarta linhas totalmente vazias
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/* ── Validação ───────────────────────────────────────────── */

export function parseAndValidate(text: string): ParsedSheet {
  const grid = parseCsv(text);
  const empty: ParsedSheet = { columns: [], rawRows: [], rows: [], errors: [], missingColumns: [] };
  if (grid.length === 0) return { ...empty, missingColumns: [...REQUIRED] };

  const headers = grid[0].map(norm);
  const colIdx = (name: string) => headers.indexOf(name);
  const missingColumns = REQUIRED.filter((c) => colIdx(c) === -1);

  const dataRows = grid.slice(1);
  const columns = TEMPLATE_COLUMNS.filter((c) => colIdx(c) !== -1) as string[];
  const rawRows = dataRows.map((r) => columns.map((c) => (r[colIdx(c)] ?? '').trim()));

  if (missingColumns.length > 0) {
    return { ...empty, columns, rawRows, missingColumns };
  }

  const errors: CellError[] = [];
  const rows: ImportRowData[] = [];
  const dupKeys = new Map<string, number>(); // chave → linha da planilha

  dataRows.forEach((r, rowIndex) => {
    const line = rowIndex + 2; // 1 = cabeçalho
    const cell = (name: string) => (r[colIdx(name)] ?? '').trim();
    const fail = (column: string, message: string, hint: string) =>
      errors.push({ line, rowIndex, column, value: cell(column), message, hint });

    /* marca / modelo — obrigatórios, não numéricos */
    const brandName = cell('marca');
    const modelName = cell('modelo');
    if (!brandName) fail('marca', 'Marca não preenchida', 'Informe o nome da marca, ex: "Fiat"');
    else if (/^\d+$/.test(brandName)) fail('marca', 'Marca não pode ser apenas números', 'Use o nome da marca, ex: "Toyota" — não "0" ou "123"');
    else if (brandName.length < 2) fail('marca', 'Marca muito curta', 'Use o nome completo da marca, ex: "VW" ou "Fiat"');

    // modelos numéricos reais existem (208, 911, 147…) — bloqueia apenas zeros
    if (!modelName) fail('modelo', 'Modelo não preenchido', 'Informe o nome do modelo, ex: "Argo"');
    else if (/^0+$/.test(modelName)) fail('modelo', 'Modelo inválido', 'Use o nome real do modelo, ex: "Corolla" — não "0"');

    /* condição */
    const condRaw = cell('condicao');
    const condition = CONDITION_MAP[norm(condRaw)];
    if (!condRaw) fail('condicao', 'Condição não preenchida', 'Preencha com: novo, seminovo, usado ou demo');
    else if (!condition) fail('condicao', `Condição "${condRaw}" não reconhecida`, 'Valores aceitos: novo, seminovo, usado, demo');

    /* anos */
    const ymRaw = cell('ano_modelo');
    const yfRaw = cell('ano_fabricacao');
    const yearModel = parseBrlNumber(ymRaw);
    const yearMake = parseBrlNumber(yfRaw);
    if (!ymRaw) fail('ano_modelo', 'Ano do modelo não preenchido', `Informe um ano entre 1950 e ${THIS_YEAR + 1}, ex: "2022"`);
    else if (!Number.isInteger(yearModel) || yearModel < 1950 || yearModel > THIS_YEAR + 1)
      fail('ano_modelo', `Ano do modelo inválido`, `Use um ano inteiro entre 1950 e ${THIS_YEAR + 1}, ex: "2022"`);
    if (!yfRaw) fail('ano_fabricacao', 'Ano de fabricação não preenchido', `Informe um ano entre 1950 e ${THIS_YEAR + 1}, ex: "2021"`);
    else if (!Number.isInteger(yearMake) || yearMake < 1950 || yearMake > THIS_YEAR + 1)
      fail('ano_fabricacao', `Ano de fabricação inválido`, `Use um ano inteiro entre 1950 e ${THIS_YEAR + 1}, ex: "2021"`);
    else if (Number.isInteger(yearModel) && yearMake > yearModel)
      fail('ano_fabricacao', 'Fabricação posterior ao ano do modelo', 'O ano de fabricação deve ser igual ou anterior ao ano do modelo (ex: fab. 2021, modelo 2022)');

    /* quilometragem */
    const kmRaw = cell('quilometragem');
    const mileageKm = parseBrlNumber(kmRaw);
    if (kmRaw === '') fail('quilometragem', 'Quilometragem não preenchida', 'Informe os km rodados — use "0" para veículo novo');
    else if (!Number.isInteger(mileageKm) || mileageKm < 0)
      fail('quilometragem', `Quilometragem inválida`, 'Use apenas números inteiros ≥ 0, ex: "45000" ou "45.000"');
    else if (mileageKm > 2_000_000)
      fail('quilometragem', 'Quilometragem alta demais', 'Confira o valor — o máximo aceito é 2.000.000 km');
    else if (condition === 'new' && mileageKm > 100)
      fail('quilometragem', 'Veículo novo com quilometragem alta', 'Veículos com condição "novo" devem ter no máximo 100 km — confira a condição ou os km');

    /* preço */
    const priceRaw = cell('preco');
    const price = parseBrlNumber(priceRaw);
    if (!priceRaw) fail('preco', 'Preço não preenchido', 'Informe o valor de venda, ex: "65.900,00" ou "65900"');
    else if (Number.isNaN(price) || price <= 0)
      fail('preco', `Preço inválido`, 'Use um valor maior que zero, ex: "65.900,00" — sem letras');
    else if (price < 1000)
      fail('preco', 'Preço suspeito (menor que R$ 1.000)', 'Confira se o valor está completo, ex: "65.900,00" e não "65,9"');

    /* preço promocional (opcional) */
    const promoRaw = cell('preco_promocional');
    let promoPrice: number | undefined;
    if (promoRaw) {
      promoPrice = parseBrlNumber(promoRaw);
      if (Number.isNaN(promoPrice) || promoPrice <= 0) {
        fail('preco_promocional', `Preço promocional inválido`, 'Use um valor numérico maior que zero ou deixe em branco');
        promoPrice = undefined;
      } else if (!Number.isNaN(price) && promoPrice >= price) {
        fail('preco_promocional', 'Promocional maior ou igual ao preço de tabela', 'O preço promocional deve ser menor que o preço normal — ou deixe em branco');
      }
    }

    /* combustível / câmbio (opcionais) */
    const fuelRaw = cell('combustivel');
    const fuel = fuelRaw ? FUEL_MAP[norm(fuelRaw)] : undefined;
    if (fuelRaw && !fuel)
      fail('combustivel', `Combustível "${fuelRaw}" não reconhecido`, 'Valores aceitos: flex, gasolina, etanol, diesel, hibrido, eletrico, gnv — ou deixe em branco');

    const transRaw = cell('cambio');
    const transmission = transRaw ? TRANSMISSION_MAP[norm(transRaw)] : undefined;
    if (transRaw && !transmission)
      fail('cambio', `Câmbio "${transRaw}" não reconhecido`, 'Valores aceitos: manual, automatico, cvt, automatizado — ou deixe em branco');

    /* portas (opcional) */
    const doorsRaw = cell('portas');
    let doors: number | undefined;
    if (doorsRaw) {
      doors = parseBrlNumber(doorsRaw);
      if (!Number.isInteger(doors) || doors < 2 || doors > 6) {
        fail('portas', `Número de portas inválido`, 'Use um número entre 2 e 6, ex: "4" — ou deixe em branco');
        doors = undefined;
      }
    }

    /* duplicada dentro do próprio arquivo */
    const dupKey = [norm(brandName), norm(modelName), norm(cell('versao')), ymRaw, kmRaw, priceRaw].join('|');
    if (brandName && modelName) {
      const firstLine = dupKeys.get(dupKey);
      if (firstLine !== undefined) {
        fail('modelo', `Linha duplicada (igual à linha ${firstLine})`, 'Remova uma das linhas repetidas ou diferencie versão/km/preço');
      } else {
        dupKeys.set(dupKey, line);
      }
    }

    rows.push({
      brandName,
      modelName,
      versionName: cell('versao') || undefined,
      condition: condition ?? 'used',
      yearModel: Number.isInteger(yearModel) ? yearModel : 0,
      yearMake: Number.isInteger(yearMake) ? yearMake : 0,
      mileageKm: Number.isInteger(mileageKm) ? mileageKm : 0,
      color: cell('cor') || undefined,
      fuel,
      transmission,
      engine: cell('motor') || undefined,
      doors,
      price: Number.isNaN(price) ? 0 : price,
      promoPrice,
      description: cell('descricao') || undefined,
    });
  });

  return { columns, rawRows, rows, errors, missingColumns: [] };
}

/* ── Modelo para download ────────────────────────────────── */

export function buildTemplateCsv(): string {
  const header = TEMPLATE_COLUMNS.join(';');
  const example1 = 'Fiat;Argo;Drive 1.0;novo;2025;2025;0;Vermelho;flex;manual;1.0 Firefly;4;89.990,00;;Carro 0km pronta entrega';
  const example2 = 'Toyota;Corolla;XEi 2.0;usado;2021;2020;45.000;Prata;flex;automatico;2.0 Dynamic Force;4;139.900,00;134.900,00;Único dono, revisões na concessionária';
  // BOM para o Excel abrir com acentuação correta
  return '﻿' + [header, example1, example2].join('\r\n');
}

export function downloadTemplate() {
  const blob = new Blob([buildTemplateCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modelo-importacao-veiculos.csv';
  a.click();
  URL.revokeObjectURL(url);
}
