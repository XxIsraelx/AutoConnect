/**
 * Gerador da **loja de demonstração**.
 *
 * Monta UMA concessionária fictícia completa — equipe, estoque com foto,
 * leads distribuídos pelo rodízio, agenda, negócios em todos os estágios,
 * contrato emitido e assinado, chat com proposta aceita — para ser mostrada no
 * celular a um dono de revenda.
 *
 *   pnpm --filter @autoconnect/db run demo                  # cria (ou pula, se já existe)
 *   DEMO_RESET=1  pnpm --filter @autoconnect/db run demo    # apaga e recria com as datas de hoje
 *   DEMO_APAGAR=1 pnpm --filter @autoconnect/db run demo    # só apaga
 *
 * ## Por que existe, separado do `seed.ts`
 *
 * O seed povoa **oito** concessionárias de teste, para exercitar o isolamento
 * por tenant. Este arquivo faz o contrário: uma loja só, com história coerente
 * do começo ao fim, porque numa demonstração de dez minutos o que convence é o
 * mesmo cliente aparecendo no lead, no agendamento, no negócio e no contrato —
 * e não oito lojas com dados sorteados.
 *
 * ## Tudo é fictício, e assumidamente
 *
 * - Razão social diz "loja de demonstração"; o slug é `demo`, então a URL
 *   pública é `/c/demo`.
 * - CNPJ e CPFs têm dígito verificador válido (senão o contrato não sai), mas
 *   saem de faixas que a Receita não emite: o CNPJ é o `11.222.333/0001-81`
 *   usado como exemplo em documentação, e os CPFs começam em `000.`.
 * - E-mails em `@example.com` (RFC 2606, reservado), todos com prefixo `demo.`.
 * - **Telefones não podem tocar em ninguém.** O Brasil não tem faixa oficial
 *   para número fictício, então usamos celulares `(16) 9 0000-00xx`: o app os
 *   aceita (`normalizarTelefoneBr` só exige o nono dígito `9`), mas a Anatel
 *   só aloca celular com o segundo dígito entre 6 e 9 — `90000-…` não existe e
 *   não vai existir. Isso importa porque a tela de leads monta link de
 *   `wa.me` e de `tel:` a partir desse campo, e um número de verdade aqui
 *   viraria ligação para um estranho durante a demonstração.
 *
 * ## Fotos dos veículos
 *
 * Vêm do **Wikimedia Commons**, escolhidas uma a uma para bater com o modelo e
 * com a cor registrada no cadastro, e todas sob licença que permite uso
 * comercial (CC0, domínio público, CC BY ou CC BY-SA). A tabela `FOTOS` abaixo
 * guarda, para cada arquivo, autor, licença e a página de origem, e o crédito
 * vai para o `alt` da imagem (`VehicleImage.altText`). Nenhuma foto foi tirada
 * de anúncio de loja real.
 *
 * As CC BY e CC BY-SA **exigem atribuição**. Numa demonstração fechada o
 * crédito no `alt` e neste arquivo dá conta; se alguma dessas imagens for
 * parar em material público (site, anúncio, apresentação), o crédito precisa
 * ficar visível ao lado da foto.
 *
 * ## Datas
 *
 * Tudo é relativo ao instante em que o script roda, espalhado pelas últimas
 * ~8 semanas, com atividade **hoje e amanhã** — lead de hoje, agendamento de
 * hoje e de amanhã, negócio aberto hoje. É o que impede a demonstração de
 * parecer parada. Para renovar, basta rodar de novo com `DEMO_RESET=1`: as
 * datas são recalculadas a partir do novo "hoje".
 *
 * ## Escopo das escritas
 *
 * Fora a loja `demo` e tudo o que pende dela (que some por cascata ao apagar o
 * tenant), o script escreve em dois lugares globais, de propósito:
 *
 *  - `vehicle_brands` / `vehicle_models`: catálogo global, upsert por nome. São
 *    as mesmas marcas que qualquer loja usaria; nunca são apagados.
 *  - `users` com `tenant_id` nulo: os clientes finais, que na plataforma real
 *    são globais (a mesma pessoa fala com várias lojas). Todos têm e-mail
 *    `demo.cliente.*@example.com` e são apagados por essa lista exata.
 *
 * Roda pela conexão dona das tabelas, que não passa pelo RLS — por isso cada
 * `where` daqui filtra `tenantId` explicitamente.
 */
import {
  Prisma,
  PrismaClient,
  type AppointmentStatus,
  type AppointmentType,
  type DealStatus,
  type FuelType,
  type LeadSource,
  type LeadStatus,
  type TransmissionType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

// O shared não é dependência do @autoconnect/db (seria ciclo: o shared já
// depende deste pacote). Como isto é script, e não código publicado, o import
// é pelo caminho do fonte — o tsx transpila na hora.
import { calcularPrazoDeResposta, type Expediente } from '../../shared/src/domain/sla';
import { normalizarTelefoneBr } from '../../shared/src/domain/telefone';
import { qualificarComprador, qualificarVendedor, formatarCpf } from '../../shared/src/schemas/deal';

// A geração do PDF é a MESMA do `ContractsService` (`gerar-pdf.ts` existe para
// isso). Copiá-la aqui faria o hash do contrato de demonstração divergir do que
// a rota de download regenera — e o download responderia 409 dizendo que o
// documento foi alterado.
import { TEMPLATE_PADRAO, type SnapshotContrato } from '../../../apps/api/src/modules/contracts/blocos';
import { gerarPdfDoContrato } from '../../../apps/api/src/modules/contracts/gerar-pdf';

const prisma = new PrismaClient();
const D = (v: string | number) => new Prisma.Decimal(v);

const SLUG = 'demo';
const SENHA_DA_EQUIPE = 'Demo@2026';
const SENHA_DOS_CLIENTES = 'Cliente@2026';
const DOMINIO = 'example.com';
const PREFIXO_CLIENTE = 'demo.cliente.';

const AGORA = new Date();

/* ════════════════════════════════════════════════════════════════════════
   Utilitários
   ════════════════════════════════════════════════════════════════════════ */

/** PRNG determinístico: a mesma loja recebe sempre os mesmos custos e placas. */
function rngDe(semente: string) {
  let h = 1779033703 ^ semente.length;
  for (let i = 0; i < semente.length; i++) {
    h = Math.imul(h ^ semente.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
  };
}
const rng = rngDe('autoconnect-demo-v1');

/** `dias` atrás, numa hora do dia estável. Nunca devolve instante futuro. */
function diasAtras(dias: number, hora = 10, minuto = 0): Date {
  const d = new Date(AGORA);
  d.setDate(d.getDate() - dias);
  d.setHours(hora, minuto, 0, 0);
  return d > AGORA ? new Date(AGORA.getTime() - 5 * 60_000) : d;
}

function diasAFrente(dias: number, hora: number, minuto = 0): Date {
  const d = new Date(AGORA);
  d.setDate(d.getDate() + dias);
  d.setHours(hora, minuto, 0, 0);
  return d;
}

const minutosAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000);
const somarMinutos = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/**
 * Um horário ainda por vir **hoje**. Se a hora pedida já passou, joga para
 * daqui a uma hora — e nunca depois das 23h, para não virar "amanhã" quando o
 * script rodar de madrugada.
 */
function hojeMaisTarde(hora: number): Date {
  const alvo = new Date(AGORA);
  alvo.setHours(hora, 0, 0, 0);
  if (alvo > AGORA) return alvo;

  const limite = new Date(AGORA);
  limite.setHours(23, 0, 0, 0);
  const daquiUmaHora = somarMinutos(AGORA, 60);
  return daquiUmaHora < limite ? daquiUmaHora : limite;
}

/**
 * Empurra um agendamento para um instante em que a loja está **aberta**.
 *
 * Os agendamentos são declarados como "daqui a N dias", e N dias a partir de
 * hoje cai em domingo uma vez por semana — a agenda mostrava visita marcada
 * num dia em que a loja está fechada, que é o tipo de incoerência que um dono
 * de revenda enxerga em dois segundos. Também encaixa a hora na janela do dia
 * (sábado fecha às 13h) e deixa pelo menos uma hora antes de fechar.
 *
 * `paraFrente` diz para que lado procurar o próximo dia aberto: futuro empurra
 * adiante, passado puxa para trás, para que um agendamento "de 4 dias atrás"
 * não vire um do futuro.
 */
function dentroDoExpediente(d: Date, paraFrente: boolean): Date {
  const r = new Date(d);
  for (let i = 0; i < 8; i++) {
    const dia = EXPEDIENTE[String(r.getDay())];
    if (dia && !dia.closed) {
      const [ah, am] = dia.open.split(':').map(Number);
      const [fh, fm] = dia.close.split(':').map(Number);
      const abre = ah * 60 + am;
      // Uma hora antes de fechar: test drive de 45 minutos tem que caber.
      const ultimo = Math.max(abre, fh * 60 + fm - 60);
      const agora = r.getHours() * 60 + r.getMinutes();
      const alvo = agora < abre ? abre : agora > ultimo ? ultimo : agora;
      r.setHours(Math.floor(alvo / 60), alvo % 60, 0, 0);
      return r;
    }
    r.setDate(r.getDate() + (paraFrente ? 1 : -1));
  }
  return r;
}

/** CPF com DV válido a partir dos 9 primeiros dígitos. */
function cpfComDv(base9: string): string {
  const base = base9.split('').map(Number);
  const dv = (digs: number[]) => {
    const n = digs.length;
    const s = digs.reduce((acc, d, i) => acc + d * (n + 1 - i), 0);
    const r = (s * 10) % 11;
    return r >= 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

/**
 * CPFs da demonstração: `000.000.0NN`, com DV calculado. Passam em
 * `cpfValido` (que só recusa tamanho errado e dígito repetido), e a Receita
 * nunca emitiu CPF começando em `000` — então não há como colidir com pessoa
 * de verdade.
 */
const cpfDemo = (n: number) => cpfComDv(`000000${String(n).padStart(3, '0')}`);

/** `(16) 9 0000-00NN` — celular que a Anatel não pode alocar. Ver o cabeçalho. */
const telefoneDemo = (n: number) => `(16) 90000-${String(n).padStart(4, '0')}`;

const brl = (d: Prisma.Decimal) =>
  d.toNumber().toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `YYYY-MM` de um mês relativo ao atual. */
function periodo(mesesAtras: number): string {
  const d = new Date(AGORA.getFullYear(), AGORA.getMonth() - mesesAtras, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function placaMercosul(): string {
  const L = () => String.fromCharCode(65 + rng.int(0, 25));
  return `${L()}${L()}${L()}${rng.int(0, 9)}${L()}${rng.int(10, 99)}`;
}

/* ════════════════════════════════════════════════════════════════════════
   A loja
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Ribeirão Preto/SP: mercado de seminovos típico do interior paulista e — o
 * que importa para o mapa do painel — uma das cidades da tabela `CITY_COORDS`
 * da API, que é o que faz a distância até o cliente aparecer.
 */
const LOJA = {
  slug: SLUG,
  tradeName: 'Aurora Seminovos',
  legalName: 'Aurora Seminovos Comércio de Veículos Ltda. — loja de demonstração',
  taxId: '11222333000181',
  stateRegistration: '111.222.333.444',
  primaryEmail: `demo.contato@${DOMINIO}`,
  primaryPhone: telefoneDemo(0),
  brandColor: '#0F766E',
  websiteUrl: null as string | null,
  acceptsTradeIn: true,
  legalRep: {
    nome: 'Marcos Antônio Vilela',
    cpf: cpfDemo(1),
    cargo: 'Sócio-administrador',
    email: `demo.dono@${DOMINIO}`,
  },
  filial: {
    name: 'Aurora Seminovos — Ribeirão Preto',
    addressLine: 'Av. Presidente Vargas',
    addressNumber: '2200',
    neighborhood: 'Jardim Irajá',
    city: 'Ribeirão Preto',
    state: 'SP',
    postalCode: '14020-260',
    latitude: -21.1775,
    longitude: -47.8103,
  },
};

/**
 * Expediente da filial. Sai do padrão do shared de propósito (abre 8h30,
 * fecha 18h30) para deixar visível, na tela de configuração, que o horário é
 * da loja e não uma constante do sistema. É ele que o prazo de primeiro
 * contato consome, e é ele que acende o selo "Aberto" no mapa.
 */
const EXPEDIENTE: Expediente = {
  '0': { closed: true, open: '09:00', close: '18:00' },
  '1': { closed: false, open: '08:30', close: '18:30' },
  '2': { closed: false, open: '08:30', close: '18:30' },
  '3': { closed: false, open: '08:30', close: '18:30' },
  '4': { closed: false, open: '08:30', close: '18:30' },
  '5': { closed: false, open: '08:30', close: '18:30' },
  '6': { closed: false, open: '09:00', close: '13:00' },
};

const FUSO = 'America/Sao_Paulo';
const SLA_MINUTOS = 15;

/**
 * Um logotipo desenhado aqui, em SVG, embutido como `data:` URI.
 *
 * Não é preguiça: o logo é nosso, não depende de rede no meio da
 * demonstração (que costuma acontecer no celular, dentro da loja do cliente) e
 * não some se um CDN cair. O `logoUrl` é renderizado com `<img>` simples em
 * todo o app, então o `data:` URI funciona igual a uma URL.
 */
const LOGO = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <rect width="120" height="120" rx="26" fill="#0F766E"/>
  <path d="M26 78 L47 34 h26 l21 44 h-18 l-4-9H48l-4 9z" fill="#ffffff"/>
  <path d="M54 55 h12 l-6-13z" fill="#0F766E"/>
  <rect x="34" y="86" width="52" height="6" rx="3" fill="#5EEAD4"/>
</svg>`,
).toString('base64')}`;

/* ════════════════════════════════════════════════════════════════════════
   Equipe
   ════════════════════════════════════════════════════════════════════════ */

const EQUIPE = [
  {
    chave: 'dono',
    email: `demo.dono@${DOMINIO}`,
    fullName: 'Marcos Antônio Vilela',
    role: 'tenant_admin' as const,
    jobTitle: 'Proprietário',
    cpf: cpfDemo(1),
    telefone: telefoneDemo(1),
    comissao: null as number | null,
    entrouHaDias: 900,
  },
  {
    chave: 'gerente',
    email: `demo.gerente@${DOMINIO}`,
    fullName: 'Patrícia Lemos',
    role: 'manager' as const,
    jobTitle: 'Gerente de vendas',
    cpf: cpfDemo(2),
    telefone: telefoneDemo(2),
    comissao: 0.8,
    entrouHaDias: 640,
  },
  {
    chave: 'ana',
    email: `demo.ana@${DOMINIO}`,
    fullName: 'Ana Beatriz Crespo',
    role: 'salesperson' as const,
    jobTitle: 'Consultora de vendas',
    cpf: cpfDemo(3),
    telefone: telefoneDemo(3),
    comissao: 2.5,
    entrouHaDias: 520,
  },
  {
    chave: 'rogerio',
    email: `demo.rogerio@${DOMINIO}`,
    fullName: 'Rogério Tanaka',
    role: 'salesperson' as const,
    jobTitle: 'Consultor de vendas',
    cpf: cpfDemo(4),
    telefone: telefoneDemo(4),
    comissao: 2.5,
    entrouHaDias: 410,
  },
  {
    chave: 'wesley',
    email: `demo.wesley@${DOMINIO}`,
    fullName: 'Wesley Prado',
    role: 'salesperson' as const,
    jobTitle: 'Consultor de vendas',
    cpf: cpfDemo(5),
    telefone: telefoneDemo(5),
    comissao: 2.0,
    entrouHaDias: 180,
  },
];

/** A ordem do rodízio é o anel por data de entrada na equipe. */
const VENDEDORES = ['ana', 'rogerio', 'wesley'] as const;
type ChaveDeVendedor = (typeof VENDEDORES)[number];

/* ════════════════════════════════════════════════════════════════════════
   Fotos — Wikimedia Commons, licença que permite uso comercial
   ════════════════════════════════════════════════════════════════════════ */

interface FotoCreditada {
  url: string;
  autor: string;
  licenca: string;
  pagina: string;
}

/** Cor do carro **na foto** e as fotos. A cor do cadastro sai daqui. */
interface FotosDoModelo {
  cor: string;
  fotos: FotoCreditada[];
}

const FOTOS: Record<string, FotosDoModelo> = {
  onix: {
    cor: 'Vermelho',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Chevrolet_Onix_Mk2_RS_2020_in_Maldonado_-_front.jpg/1280px-Chevrolet_Onix_Mk2_RS_2020_in_Maldonado_-_front.jpg',
        autor: 'NaBUru38',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Chevrolet_Onix_Mk2_RS_2020_in_Maldonado_-_front.jpg',
      },
    ],
  },
  onix_plus: {
    cor: 'Branco',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/2022_Chevrolet_Onix_Plus_1.0_Premier_%28side%29.jpg/1280px-2022_Chevrolet_Onix_Plus_1.0_Premier_%28side%29.jpg',
        autor: 'Just a Man',
        licenca: 'CC BY 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:2022_Chevrolet_Onix_Plus_1.0_Premier_%28side%29.jpg',
      },
    ],
  },
  tracker: {
    cor: 'Azul',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Chevrolet_Tracker_2021_%28front%29_%28cropped%29.png/1280px-Chevrolet_Tracker_2021_%28front%29_%28cropped%29.png',
        autor: 'Autosdeprimera',
        licenca: 'CC BY 3.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Chevrolet_Tracker_2021_%28front%29_%28cropped%29.png',
      },
    ],
  },
  hb20: {
    cor: 'Azul',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Hyundai_HB20S_%28second_generation%29_front_view.png/1280px-Hyundai_HB20S_%28second_generation%29_front_view.png',
        autor: 'Compara Motors',
        licenca: 'CC BY 3.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Hyundai_HB20S_%28second_generation%29_front_view.png',
      },
    ],
  },
  creta: {
    cor: 'Cinza',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/2022_Hyundai_Creta_SE.jpg/1280px-2022_Hyundai_Creta_SE.jpg',
        autor: 'Chanokchon',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:2022_Hyundai_Creta_SE.jpg',
      },
    ],
  },
  polo: {
    cor: 'Cinza',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/2019_Volkswagen_Polo_1.6_MSi_Highline.jpg/1280px-2019_Volkswagen_Polo_1.6_MSi_Highline.jpg',
        autor: 'Just a Man',
        licenca: 'CC BY 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:2019_Volkswagen_Polo_1.6_MSi_Highline.jpg',
      },
    ],
  },
  tcross: {
    cor: 'Vermelho',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Volkswagen_T-Cross%2C_PIA.jpg/1280px-Volkswagen_T-Cross%2C_PIA.jpg',
        autor: 'Raf24~commonswiki',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Volkswagen_T-Cross%2C_PIA.jpg',
      },
    ],
  },
  nivus: {
    cor: 'Cinza',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Volkswagen_Nivus_Brazil_front.jpg/1280px-Volkswagen_Nivus_Brazil_front.jpg',
        autor: 'Mateusmatsuda',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Volkswagen_Nivus_Brazil_front.jpg',
      },
    ],
  },
  gol: {
    cor: 'Prata',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Volkswagen_Gol_G8_in_Montevideo.jpg/1280px-Volkswagen_Gol_G8_in_Montevideo.jpg',
        autor: 'NaBUru38',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Volkswagen_Gol_G8_in_Montevideo.jpg',
      },
    ],
  },
  argo: {
    cor: 'Branco',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Fiat_Argo_2020_Trekking_in_Uruguay_%28front%29.jpg/1280px-Fiat_Argo_2020_Trekking_in_Uruguay_%28front%29.jpg',
        autor: 'NaBUru38',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Fiat_Argo_2020_Trekking_in_Uruguay_%28front%29.jpg',
      },
    ],
  },
  strada: {
    cor: 'Cinza',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Fiat_Strada_2020_Volcano_in_Montevideo_%28front%29.jpg/1280px-Fiat_Strada_2020_Volcano_in_Montevideo_%28front%29.jpg',
        autor: 'NaBUru38',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Fiat_Strada_2020_Volcano_in_Montevideo_%28front%29.jpg',
      },
    ],
  },
  toro: {
    cor: 'Verde',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/2021_Fiat_Toro_Freedom_1.8_4X2_-_%282%29.jpg/1280px-2021_Fiat_Toro_Freedom_1.8_4X2_-_%282%29.jpg',
        autor: 'Just a Man',
        licenca: 'CC BY 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:2021_Fiat_Toro_Freedom_1.8_4X2_-_%282%29.jpg',
      },
    ],
  },
  pulse: {
    cor: 'Branco',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/2022_Fiat_Pulse_1.3_GSE_Drive.jpg/1280px-2022_Fiat_Pulse_1.3_GSE_Drive.jpg',
        autor: 'Just a Man',
        licenca: 'CC BY 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:2022_Fiat_Pulse_1.3_GSE_Drive.jpg',
      },
    ],
  },
  kwid: {
    cor: 'Prata',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Renault_Kwid_1.0_Outsider_2022.jpg/1280px-Renault_Kwid_1.0_Outsider_2022.jpg',
        autor: 'RL GNZLZ',
        licenca: 'CC BY-SA 2.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Renault_Kwid_1.0_Outsider_2022.jpg',
      },
    ],
  },
  duster: {
    cor: 'Cinza',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Dacia_Duster_II_001.jpg/1280px-Dacia_Duster_II_001.jpg',
        autor: 'Zoerides',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Dacia_Duster_II_001.jpg',
      },
    ],
  },
  corolla: {
    cor: 'Prata',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Toyota_Corolla_E210_sedan_variation.jpg/1280px-Toyota_Corolla_E210_sedan_variation.jpg',
        autor: 'Ee2mba',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Toyota_Corolla_E210_sedan_variation.jpg',
      },
    ],
  },
  yaris: {
    cor: 'Branco',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/2025_Toyota_Yaris_1.5_XS_CVT.jpg/1280px-2025_Toyota_Yaris_1.5_XS_CVT.jpg',
        autor: 'Just a Man',
        licenca: 'CC BY 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:2025_Toyota_Yaris_1.5_XS_CVT.jpg',
      },
    ],
  },
  hilux: {
    cor: 'Vermelho',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/2019_Toyota_Hilux_SR.jpg/1280px-2019_Toyota_Hilux_SR.jpg',
        autor: 'RL GNZLZ',
        licenca: 'CC BY-SA 2.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:2019_Toyota_Hilux_SR.jpg',
      },
    ],
  },
  hrv: {
    cor: 'Branco',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Honda_HR-V_in_Thailand_1.jpg/1280px-Honda_HR-V_in_Thailand_1.jpg',
        autor: 'B20180',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Honda_HR-V_in_Thailand_1.jpg',
      },
    ],
  },
  renegade: {
    cor: 'Prata',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/2025_Jeep_Renegade_Longitude_in_Argentina.jpg/1280px-2025_Jeep_Renegade_Longitude_in_Argentina.jpg',
        autor: 'Elcondelvp',
        licenca: 'CC BY 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:2025_Jeep_Renegade_Longitude_in_Argentina.jpg',
      },
    ],
  },
  compass: {
    cor: 'Branco',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/2021_Jeep_Compass_Nighteagle_Multiair_4x2.jpg/1280px-2021_Jeep_Compass_Nighteagle_Multiair_4x2.jpg',
        autor: 'Calreyn88',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:2021_Jeep_Compass_Nighteagle_Multiair_4x2.jpg',
      },
    ],
  },
  kicks: {
    cor: 'Cinza',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Nissan_Kicks_Advance_2019_%2849107691811%29.jpg/1280px-Nissan_Kicks_Advance_2019_%2849107691811%29.jpg',
        autor: 'RL GNZLZ from Chile',
        licenca: 'CC BY-SA 2.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Nissan_Kicks_Advance_2019_%2849107691811%29.jpg',
      },
    ],
  },
  virtus: {
    cor: 'Branco',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/2023_Volkswagen_Virtus_Topline_front_20230520.jpg/1280px-2023_Volkswagen_Virtus_Topline_front_20230520.jpg',
        autor: 'Dairokkan9',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:2023_Volkswagen_Virtus_Topline_front_20230520.jpg',
      },
    ],
  },
  mobi: {
    cor: 'Vermelho',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Fiat_Mobi_1.0_Like_2021.jpg/1280px-Fiat_Mobi_1.0_Like_2021.jpg',
        autor: 'RL GNZLZ',
        licenca: 'CC BY-SA 2.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:Fiat_Mobi_1.0_Like_2021.jpg',
      },
    ],
  },
  city: {
    cor: 'Cinza',
    fotos: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/2021_Honda_City_1.5_GN2_%2820211117%29.jpg/1280px-2021_Honda_City_1.5_GN2_%2820211117%29.jpg',
        autor: 'オーバードライブ83',
        licenca: 'CC BY-SA 4.0',
        pagina: 'https://commons.wikimedia.org/wiki/File:2021_Honda_City_1.5_GN2_%2820211117%29.jpg',
      },
    ],
  },
};

/* ════════════════════════════════════════════════════════════════════════
   Estoque
   ════════════════════════════════════════════════════════════════════════ */

interface ItemDeEstoque {
  foto: string;
  marca: string;
  modelo: string;
  versao: string;
  anoFab: number;
  anoMod: number;
  km: number;
  comb: FuelType;
  cambio: TransmissionType;
  /** Referência de mercado usada para ancorar o preço de venda. */
  fipe: number;
  preco: number;
  compra: number;
}

/**
 * Vinte e cinco seminovos plausíveis para uma revenda do interior paulista.
 *
 * `preco` fica entre 2% e 4% acima da `fipe` — que é como uma revenda anuncia
 * (a tabela é referência, não teto) — e `compra` entre 82% e 88% do preço, que
 * é a margem bruta antes da preparação. Sem esses dois campos o painel de
 * margem e o de giro ficariam vazios.
 */
const ESTOQUE: ItemDeEstoque[] = [
  { foto: 'onix',     marca: 'Chevrolet',  modelo: 'Onix',      versao: '1.0 Turbo RS',           anoFab: 2022, anoMod: 2023, km: 38_400, comb: 'flex',   cambio: 'automatic', fipe:  82_500, preco:  84_900, compra:  72_000 },
  { foto: 'onix_plus',marca: 'Chevrolet',  modelo: 'Onix Plus', versao: '1.0 Turbo LTZ',          anoFab: 2021, anoMod: 2022, km: 54_100, comb: 'flex',   cambio: 'automatic', fipe:  86_900, preco:  89_900, compra:  76_500 },
  { foto: 'tracker',  marca: 'Chevrolet',  modelo: 'Tracker',   versao: '1.2 Turbo Premier',      anoFab: 2022, anoMod: 2023, km: 41_700, comb: 'flex',   cambio: 'automatic', fipe: 124_800, preco: 128_900, compra: 110_000 },
  { foto: 'hb20',     marca: 'Hyundai',    modelo: 'HB20S',     versao: '1.0 Comfort Plus',       anoFab: 2022, anoMod: 2022, km: 33_900, comb: 'flex',   cambio: 'manual',    fipe:  76_900, preco:  79_900, compra:  67_500 },
  { foto: 'creta',    marca: 'Hyundai',    modelo: 'Creta',     versao: '1.6 Action',             anoFab: 2023, anoMod: 2023, km: 27_300, comb: 'flex',   cambio: 'automatic', fipe: 122_700, preco: 126_900, compra: 108_500 },
  { foto: 'polo',     marca: 'Volkswagen', modelo: 'Polo',      versao: '1.0 200 TSI Highline',   anoFab: 2022, anoMod: 2022, km: 36_800, comb: 'flex',   cambio: 'automatic', fipe:  99_500, preco: 102_900, compra:  87_000 },
  { foto: 'tcross',   marca: 'Volkswagen', modelo: 'T-Cross',   versao: '1.0 200 TSI Comfortline',anoFab: 2021, anoMod: 2022, km: 58_400, comb: 'flex',   cambio: 'automatic', fipe: 116_300, preco: 119_900, compra: 102_000 },
  { foto: 'nivus',    marca: 'Volkswagen', modelo: 'Nivus',     versao: '1.0 200 TSI Highline',   anoFab: 2022, anoMod: 2023, km: 31_200, comb: 'flex',   cambio: 'automatic', fipe: 123_900, preco: 127_900, compra: 109_000 },
  { foto: 'gol',      marca: 'Volkswagen', modelo: 'Gol',       versao: '1.0 MPI',                anoFab: 2020, anoMod: 2021, km: 71_500, comb: 'flex',   cambio: 'manual',    fipe:  56_800, preco:  58_900, compra:  49_500 },
  { foto: 'argo',     marca: 'Fiat',       modelo: 'Argo',      versao: '1.3 Trekking',              anoFab: 2022, anoMod: 2022, km: 44_600, comb: 'flex',   cambio: 'manual',    fipe:  72_900, preco:  74_900, compra:  63_000 },
  { foto: 'strada',   marca: 'Fiat',       modelo: 'Strada',    versao: '1.3 Volcano Cabine Dupla',anoFab: 2023,anoMod: 2023, km: 24_800, comb: 'flex',   cambio: 'cvt',       fipe: 113_400, preco: 117_900, compra: 100_500 },
  { foto: 'toro',     marca: 'Fiat',       modelo: 'Toro',      versao: '1.3 T270 Freedom',       anoFab: 2022, anoMod: 2022, km: 49_200, comb: 'flex',   cambio: 'automatic', fipe: 139_800, preco: 143_900, compra: 122_000 },
  { foto: 'pulse',    marca: 'Fiat',       modelo: 'Pulse',     versao: '1.3 Drive',              anoFab: 2023, anoMod: 2023, km: 22_100, comb: 'flex',   cambio: 'cvt',       fipe:  98_700, preco: 101_900, compra:  86_500 },
  { foto: 'kwid',     marca: 'Renault',    modelo: 'Kwid',      versao: '1.0 Outsider',                anoFab: 2022, anoMod: 2023, km: 29_500, comb: 'flex',   cambio: 'manual',    fipe:  58_300, preco:  60_900, compra:  51_000 },
  { foto: 'duster',   marca: 'Renault',    modelo: 'Duster',    versao: '1.6 Iconic',             anoFab: 2021, anoMod: 2022, km: 62_700, comb: 'flex',   cambio: 'cvt',       fipe:  92_400, preco:  95_900, compra:  81_000 },
  { foto: 'corolla',  marca: 'Toyota',     modelo: 'Corolla',   versao: '2.0 XEi',                anoFab: 2021, anoMod: 2022, km: 57_900, comb: 'flex',   cambio: 'cvt',       fipe: 134_600, preco: 139_900, compra: 119_000 },
  { foto: 'yaris',    marca: 'Toyota',     modelo: 'Yaris',     versao: '1.5 XS CVT',                 anoFab: 2021, anoMod: 2022, km: 48_300, comb: 'flex',   cambio: 'cvt',       fipe:  91_800, preco:  94_900, compra:  80_500 },
  { foto: 'hilux',    marca: 'Toyota',     modelo: 'Hilux',     versao: '2.8 SRV 4x4',            anoFab: 2020, anoMod: 2021, km: 96_400, comb: 'diesel', cambio: 'automatic', fipe: 231_700, preco: 238_900, compra: 205_000 },
  { foto: 'hrv',      marca: 'Honda',      modelo: 'HR-V',      versao: '1.8 EXL',                anoFab: 2021, anoMod: 2021, km: 52_600, comb: 'flex',   cambio: 'cvt',       fipe: 127_300, preco: 131_900, compra: 112_000 },
  { foto: 'renegade', marca: 'Jeep',       modelo: 'Renegade',  versao: '1.3 T270 Longitude',     anoFab: 2022, anoMod: 2022, km: 43_800, comb: 'flex',   cambio: 'automatic', fipe: 118_600, preco: 122_900, compra: 104_500 },
  { foto: 'compass',  marca: 'Jeep',       modelo: 'Compass',   versao: '1.3 T270 Longitude',     anoFab: 2022, anoMod: 2023, km: 39_100, comb: 'flex',   cambio: 'automatic', fipe: 158_400, preco: 163_900, compra: 140_000 },
  { foto: 'kicks',    marca: 'Nissan',     modelo: 'Kicks',     versao: '1.6 Advance',            anoFab: 2022, anoMod: 2023, km: 35_200, comb: 'flex',   cambio: 'cvt',       fipe: 106_900, preco: 109_900, compra:  93_500 },
  { foto: 'virtus',   marca: 'Volkswagen', modelo: 'Virtus',    versao: '1.0 200 TSI Comfortline',anoFab: 2022, anoMod: 2022, km: 45_900, comb: 'flex',   cambio: 'automatic', fipe: 104_200, preco: 107_900, compra:  91_500 },
  { foto: 'mobi',     marca: 'Fiat',       modelo: 'Mobi',      versao: '1.0 Like',               anoFab: 2022, anoMod: 2023, km: 31_800, comb: 'flex',   cambio: 'manual',    fipe:  56_200, preco:  58_900, compra:  49_000 },
  { foto: 'city',     marca: 'Honda',      modelo: 'City',      versao: '1.5 EX',                 anoFab: 2023, anoMod: 2023, km: 26_400, comb: 'flex',   cambio: 'cvt',       fipe: 118_900, preco: 122_900, compra: 104_000 },
];

/**
 * Os três rascunhos, e o que falta em cada um.
 *
 * Dois estão incompletos de propósito: é o que faz a tela de estoque mostrar o
 * botão "Publicar" desabilitado com o motivo, que é justamente a
 * funcionalidade a demonstrar. O terceiro está completo, para o vendedor
 * publicar ao vivo na frente do cliente.
 */
const RASCUNHOS: Record<number, { semFoto?: boolean; semCor?: boolean; semCambio?: boolean }> = {
  12: {},                              // Fiat Pulse — completo: publicar ao vivo
  8: { semFoto: true },                // VW Gol — "falta pelo menos uma foto"
  13: { semCor: true, semCambio: true }, // Renault Kwid — "faltam cor e câmbio"
};

/* ════════════════════════════════════════════════════════════════════════
   Clientes finais (usuários globais)
   ════════════════════════════════════════════════════════════════════════ */

/**
 * As cidades saem da tabela `CITY_COORDS` da API — é ela que faz a distância
 * aparecer no mapa do painel. Cliente de cidade fora da lista vira um ponto
 * sem distância, que parece defeito.
 */
const CLIENTES = [
  { chave: 'juliana',  nome: 'Juliana Martins Prado',  cidade: 'Ribeirão Preto',        uf: 'SP' },
  { chave: 'eduardo',  nome: 'Eduardo Sampaio',        cidade: 'Ribeirão Preto',        uf: 'SP' },
  { chave: 'camila',   nome: 'Camila Rocha Bueno',     cidade: 'São José do Rio Preto', uf: 'SP' },
  { chave: 'anderson', nome: 'Anderson Freitas',       cidade: 'Campinas',              uf: 'SP' },
  { chave: 'renata',   nome: 'Renata Villela',         cidade: 'Ribeirão Preto',        uf: 'SP' },
  { chave: 'thiago',   nome: 'Thiago Nakamura',        cidade: 'São Paulo',             uf: 'SP' },
  { chave: 'priscila', nome: 'Priscila Andrade',       cidade: 'Uberlândia',            uf: 'MG' },
  { chave: 'marcelo',  nome: 'Marcelo Bastos',         cidade: 'Ribeirão Preto',        uf: 'SP' },
  { chave: 'leticia',  nome: 'Letícia Barros',         cidade: 'Sorocaba',              uf: 'SP' },
  { chave: 'fabio',    nome: 'Fábio Quintana',         cidade: 'Ribeirão Preto',        uf: 'SP' },
] as const;

type ChaveDeCliente = (typeof CLIENTES)[number]['chave'];

const emailDoCliente = (chave: string) => `${PREFIXO_CLIENTE}${chave}@${DOMINIO}`;

/* ════════════════════════════════════════════════════════════════════════
   Negócios
   ════════════════════════════════════════════════════════════════════════ */

type Passo = readonly [DealStatus, number];

interface Pagamento {
  kind: 'cash' | 'down_payment' | 'financing' | 'trade_in';
  /** Fração do valor de venda. As frações de um negócio somam 1. */
  fracao: number;
  instituicao?: string;
  parcelas?: number;
}

interface NegocioDaDemo {
  chave: string;
  veiculo: number;
  cliente: ChaveDeCliente;
  /** Desconto concedido, em reais. */
  desconto: number;
  /** `[status, dias atrás]`, em ordem. Cada passo é válido em `DEAL_TRANSITIONS`. */
  linha: readonly Passo[];
  pagamentos: Pagamento[];
  /** Garantia contratual adicional, em meses (a legal de 90 dias é sempre declarada). */
  garantiaMeses?: number;
  garantiaEscopo?: string;
  /** Emite contrato no dia do `contract_issued`. */
  contrato?: 'assinado' | 'emitido';
  motivoCancelamento?: { codigo: string; texto: string };
  /** Veículo que o cliente entregou na troca. */
  troca?: {
    marca: string; modelo: string; versao: string;
    anoFab: number; anoMod: number; km: number; cor: string;
    fipe: number; avaliado: number; aceito: number;
  };
}

const NEGOCIOS: NegocioDaDemo[] = [
  {
    chave: 'corolla-entregue',
    veiculo: 15, cliente: 'juliana', desconto: 4_000,
    linha: [['draft', 34], ['proposal', 33], ['negotiating', 31], ['contract_issued', 24], ['signed', 22], ['invoiced', 21], ['documentation', 19], ['delivered', 15]],
    pagamentos: [{ kind: 'down_payment', fracao: 0.3 }, { kind: 'financing', fracao: 0.7, instituicao: 'Banco Demonstração S.A.', parcelas: 48 }],
    garantiaMeses: 6, garantiaEscopo: 'motor, câmbio e diferencial',
    contrato: 'assinado',
  },
  {
    chave: 'yaris-entregue',
    veiculo: 16, cliente: 'eduardo', desconto: 2_900,
    linha: [['draft', 58], ['proposal', 57], ['awaiting_credit', 55], ['contract_issued', 50], ['signed', 48], ['invoiced', 47], ['documentation', 45], ['delivered', 41]],
    pagamentos: [{ kind: 'cash', fracao: 1 }],
    contrato: 'assinado',
  },
  {
    chave: 'hb20-documentacao',
    veiculo: 3, cliente: 'camila', desconto: 1_900,
    linha: [['draft', 16], ['proposal', 15], ['negotiating', 14], ['contract_issued', 11], ['signed', 10], ['invoiced', 9], ['documentation', 7]],
    pagamentos: [{ kind: 'down_payment', fracao: 0.25 }, { kind: 'financing', fracao: 0.75, instituicao: 'Banco Demonstração S.A.', parcelas: 60 }],
    contrato: 'assinado',
  },
  {
    chave: 'kicks-faturado',
    veiculo: 21, cliente: 'anderson', desconto: 3_000,
    linha: [['draft', 11], ['proposal', 10], ['awaiting_credit', 9], ['contract_issued', 6], ['signed', 5], ['invoiced', 4]],
    pagamentos: [{ kind: 'trade_in', fracao: 0.42 }, { kind: 'financing', fracao: 0.58, instituicao: 'Banco Demonstração S.A.', parcelas: 36 }],
    garantiaMeses: 3,
    contrato: 'assinado',
    troca: {
      marca: 'Volkswagen', modelo: 'Fox', versao: '1.6 Comfortline',
      anoFab: 2016, anoMod: 2017, km: 118_400, cor: 'Prata',
      fipe: 46_800, avaliado: 44_500, aceito: 44_900,
    },
  },
  {
    chave: 'tcross-assinado',
    veiculo: 6, cliente: 'renata', desconto: 4_000,
    linha: [['draft', 8], ['proposal', 7], ['negotiating', 5], ['contract_issued', 3], ['signed', 2]],
    pagamentos: [{ kind: 'down_payment', fracao: 0.35 }, { kind: 'financing', fracao: 0.65, instituicao: 'Banco Demonstração S.A.', parcelas: 48 }],
    garantiaMeses: 6, garantiaEscopo: 'motor e câmbio',
    contrato: 'assinado',
  },
  {
    chave: 'renegade-contrato',
    veiculo: 19, cliente: 'thiago', desconto: 2_900,
    linha: [['draft', 5], ['proposal', 4], ['contract_issued', 1]],
    pagamentos: [{ kind: 'cash', fracao: 1 }],
    contrato: 'emitido',
  },
  {
    chave: 'tracker-credito',
    veiculo: 2, cliente: 'priscila', desconto: 3_900,
    linha: [['draft', 6], ['proposal', 5], ['awaiting_credit', 3]],
    pagamentos: [{ kind: 'down_payment', fracao: 0.3 }],
  },
  {
    chave: 'creta-negociando',
    veiculo: 4, cliente: 'marcelo', desconto: 4_900,
    linha: [['draft', 4], ['proposal', 3], ['negotiating', 2]],
    pagamentos: [{ kind: 'down_payment', fracao: 0.28 }],
  },
  {
    chave: 'argo-proposta',
    veiculo: 9, cliente: 'leticia', desconto: 1_900,
    linha: [['draft', 2], ['proposal', 1]],
    pagamentos: [{ kind: 'down_payment', fracao: 0.3 }],
  },
  {
    chave: 'onix-rascunho',
    veiculo: 0, cliente: 'fabio', desconto: 0,
    linha: [['draft', 0]],
    pagamentos: [],
  },
  {
    chave: 'duster-cancelado',
    veiculo: 14, cliente: 'priscila', desconto: 2_900,
    linha: [['draft', 30], ['proposal', 29], ['awaiting_credit', 27], ['canceled', 23]],
    pagamentos: [],
    motivoCancelamento: {
      codigo: 'credito_reprovado',
      texto: 'Banco recusou o financiamento por comprometimento de renda.',
    },
  },
];

/* ════════════════════════════════════════════════════════════════════════
   Leads
   ════════════════════════════════════════════════════════════════════════ */

interface LeadDaDemo {
  chave: string;
  /** Minutos atrás em que o lead entrou. Define toda a linha do tempo dele. */
  entrouHaMinutos: number;
  cliente: ChaveDeCliente | null;
  /** Quando não há conta, o contato é só nome + telefone. */
  nomeAvulso?: string;
  veiculo: number | null;
  origem: LeadSource;
  status: LeadStatus;
  /** Minutos até a primeira interação de saída. `null` = ninguém falou com ele. */
  respondeuEmMinutos: number | null;
  /** O prazo estourou e o cron já avisou o gerente. */
  estourou?: boolean;
  motivoPerda?: { codigo: string; texto?: string };
  mensagem: string;
  /** Negócio que nasceu deste lead. */
  negocio?: string;
  /** Oferta de troca avaliada pelo vendedor. */
  troca?: {
    marca: string; modelo: string; versao: string;
    anoFab: number; anoMod: number; km: number; cor: string;
    esperado: number; fipe: number; avaliado: number;
  };
  /** Interações a mais, além das que o gerador escreve. */
  extras?: { kind: string; minutosApos: number; texto: string; deVendedor: boolean }[];
}

const UM_DIA = 24 * 60;

/**
 * Leads em ordem cronológica (mais antigo primeiro). **A ordem importa:** o
 * responsável é atribuído girando o anel `VENDEDORES` nesta sequência, que é
 * exatamente o que o rodízio faria se os leads tivessem chegado assim.
 */
const LEADS: LeadDaDemo[] = [
  { chave: 'l-58', entrouHaMinutos: 58 * UM_DIA - 120, cliente: 'eduardo', veiculo: 16, origem: 'website', status: 'won', respondeuEmMinutos: 6, mensagem: 'Esse Yaris ainda está disponível? Pago à vista.', negocio: 'yaris-entregue' },
  { chave: 'l-52', entrouHaMinutos: 52 * UM_DIA - 260, cliente: null, nomeAvulso: 'Sandra Kraemer', veiculo: 8, origem: 'website', status: 'archived', respondeuEmMinutos: 12, mensagem: 'Qual o valor do Gol com a entrada de 15 mil?' },
  { chave: 'l-41', entrouHaMinutos: 41 * UM_DIA - 90, cliente: null, nomeAvulso: 'Wilson Amaral', veiculo: 17, origem: 'ad', status: 'contacted', respondeuEmMinutos: 19, mensagem: 'Vi o anúncio da Hilux. Aceita troca em picape menor?' },
  { chave: 'l-34', entrouHaMinutos: 34 * UM_DIA - 400, cliente: 'thiago', veiculo: 20, origem: 'website', status: 'lost', respondeuEmMinutos: 11, motivoPerda: { codigo: 'sem_credito' }, mensagem: 'Consegue financiar o Compass em 60x?' },
  { chave: 'l-34b', entrouHaMinutos: 34 * UM_DIA - 700, cliente: 'juliana', veiculo: 15, origem: 'website', status: 'won', respondeuEmMinutos: 4, mensagem: 'Tenho interesse no Corolla. Aceita meu usado na troca?', negocio: 'corolla-entregue' },
  { chave: 'l-30', entrouHaMinutos: 30 * UM_DIA - 180, cliente: 'priscila', veiculo: 14, origem: 'phone', status: 'lost', respondeuEmMinutos: 3, motivoPerda: { codigo: 'sem_credito' }, mensagem: 'Ligou perguntando pelo Duster. Precisa de financiamento em 60x.', negocio: 'duster-cancelado' },
  { chave: 'l-27', entrouHaMinutos: 27 * UM_DIA - 320, cliente: 'marcelo', veiculo: 5, origem: 'phone', status: 'won', respondeuEmMinutos: 9, mensagem: 'Procura hatch automático até 105 mil.' },
  { chave: 'l-22', entrouHaMinutos: 22 * UM_DIA - 210, cliente: null, nomeAvulso: 'Cleber Marchetti', veiculo: 11, origem: 'referral', status: 'lost', respondeuEmMinutos: 15, motivoPerda: { codigo: 'nao_respondeu' }, mensagem: 'Indicação do Sr. Amarildo. Quer ver a Toro.' },
  { chave: 'l-18', entrouHaMinutos: 18 * UM_DIA - 140, cliente: 'leticia', veiculo: 22, origem: 'website', status: 'archived', respondeuEmMinutos: 13, mensagem: 'O Virtus tem multimídia de fábrica?' },
  { chave: 'l-16', entrouHaMinutos: 16 * UM_DIA - 260, cliente: 'camila', veiculo: 3, origem: 'walk_in', status: 'won', respondeuEmMinutos: 2, mensagem: 'Veio na loja procurando um HB20 para a filha.', negocio: 'hb20-documentacao' },
  { chave: 'l-15', entrouHaMinutos: 15 * UM_DIA - 95, cliente: null, nomeAvulso: 'Rita Bergamasco', veiculo: 24, origem: 'whatsapp', status: 'qualified', respondeuEmMinutos: 7, mensagem: 'O City 2023 tem quantos donos? Faz revisão em concessionária?' },
  { chave: 'l-11', entrouHaMinutos: 12 * UM_DIA - 310, cliente: 'anderson', veiculo: 21, origem: 'website', status: 'won', respondeuEmMinutos: 8, mensagem: 'Tenho um Fox 2017 para dar na troca do Kicks.', negocio: 'kicks-faturado' },
  { chave: 'l-12', entrouHaMinutos: 11 * UM_DIA - 180, cliente: 'fabio', veiculo: 10, origem: 'walk_in', status: 'lost', respondeuEmMinutos: 5, motivoPerda: { codigo: 'comprou_em_outra_loja' }, mensagem: 'Passou na loja para ver a Strada cabine dupla.' },
  { chave: 'l-9', entrouHaMinutos: 9 * UM_DIA - 220, cliente: 'renata', veiculo: 6, origem: 'website', status: 'won', respondeuEmMinutos: 6, mensagem: 'O T-Cross Comfortline ainda está por 119.900?', negocio: 'tcross-assinado' },
  { chave: 'l-7', entrouHaMinutos: 7 * UM_DIA - 130, cliente: null, nomeAvulso: 'Osmar Delfino', veiculo: 18, origem: 'social', status: 'lost', respondeuEmMinutos: 10, motivoPerda: { codigo: 'preco' }, mensagem: 'Vi no Instagram. Consegue fazer o HR-V por 125?' },
  { chave: 'l-6', entrouHaMinutos: 6 * UM_DIA - 240, cliente: 'priscila', veiculo: 2, origem: 'referral', status: 'negotiating', respondeuEmMinutos: 4, mensagem: 'Indicada pela Juliana. Quer o Tracker Premier.', negocio: 'tracker-credito' },
  {
    chave: 'l-5', entrouHaMinutos: 5 * UM_DIA - 160, cliente: 'leticia', veiculo: 12, origem: 'trade_in', status: 'qualified', respondeuEmMinutos: 8,
    mensagem: 'Quero trocar meu Onix 2019 pelo Pulse. Quanto vocês dão no meu?',
    troca: {
      marca: 'Chevrolet', modelo: 'Onix', versao: '1.0 LT',
      anoFab: 2019, anoMod: 2019, km: 74_300, cor: 'Branco',
      esperado: 58_000, fipe: 54_900, avaliado: 52_500,
    },
  },
  { chave: 'l-5b', entrouHaMinutos: 5 * UM_DIA - 420, cliente: 'thiago', veiculo: 19, origem: 'website', status: 'won', respondeuEmMinutos: 5, mensagem: 'Quero fechar o Renegade à vista. Qual o melhor valor?', negocio: 'renegade-contrato' },
  { chave: 'l-4', entrouHaMinutos: 4 * UM_DIA - 200, cliente: 'marcelo', veiculo: 4, origem: 'whatsapp', status: 'negotiating', respondeuEmMinutos: 3, mensagem: 'Tem Creta 2023 com menos de 30 mil km?', negocio: 'creta-negociando' },
  { chave: 'l-3', entrouHaMinutos: 3 * UM_DIA - 170, cliente: null, nomeAvulso: 'Heloísa Pontes', veiculo: 7, origem: 'website', status: 'contacted', respondeuEmMinutos: 12, mensagem: 'O Nivus Highline aceita entrada de 40 mil?' },
  {
    chave: 'l-2-estourado', entrouHaMinutos: 2 * UM_DIA - 120, cliente: null, nomeAvulso: 'Gilmar Tibúrcio', veiculo: 17, origem: 'phone', status: 'new',
    respondeuEmMinutos: null, estourou: true,
    mensagem: 'Ligou fora do horário perguntando pela Hilux 4x4. Pediu retorno.',
  },
  { chave: 'l-2b', entrouHaMinutos: 2 * UM_DIA - 350, cliente: 'leticia', veiculo: 9, origem: 'website', status: 'negotiating', respondeuEmMinutos: 7, mensagem: 'O Argo Drive 2022 tem garantia de fábrica ainda?', negocio: 'argo-proposta' },
  { chave: 'l-1', entrouHaMinutos: 1 * UM_DIA - 90, cliente: 'juliana', veiculo: 23, origem: 'whatsapp', status: 'qualified', respondeuEmMinutos: 6, mensagem: 'O Mobi é para minha mãe. Tem direção elétrica?' },
  { chave: 'l-0c', entrouHaMinutos: 460, cliente: null, nomeAvulso: 'Edson Ramalho', veiculo: 1, origem: 'walk_in', status: 'contacted', respondeuEmMinutos: 4, mensagem: 'Entrou na loja perguntando pelo Onix Plus sedan.' },
  { chave: 'l-0b', entrouHaMinutos: 190, cliente: 'fabio', veiculo: 0, origem: 'website', status: 'qualified', respondeuEmMinutos: 9, mensagem: 'Quero o Onix LT. Consigo fechar hoje?', negocio: 'onix-rascunho' },
  { chave: 'l-0', entrouHaMinutos: 11, cliente: null, nomeAvulso: 'Vanessa Okamoto', veiculo: 20, origem: 'website', status: 'new', respondeuEmMinutos: null, mensagem: 'Acabei de ver o Compass no site. Ainda está disponível?' },
];

/* ════════════════════════════════════════════════════════════════════════
   Agenda
   ════════════════════════════════════════════════════════════════════════ */

interface AgendaDaDemo {
  /** Negativo = passado; 0 = hoje; positivo = futuro. */
  dias: number;
  hora: number;
  minuto?: number;
  tipo: AppointmentType;
  status: AppointmentStatus;
  lead: string;
  veiculo: number;
  nota?: string;
  motivoCancelamento?: string;
}

const AGENDA: AgendaDaDemo[] = [
  { dias: -21, hora: 15, tipo: 'test_drive', status: 'completed', lead: 'l-34b', veiculo: 15, nota: 'Rodou pela Anhanguera. Gostou do câmbio.' },
  { dias: -19, hora: 11, tipo: 'test_drive', status: 'completed', lead: 'l-6', veiculo: 2, nota: 'Levou o marido. Gostou do porta-malas.' },
  { dias: -13, hora: 10, tipo: 'test_drive', status: 'no_show', lead: 'l-22', veiculo: 11, nota: 'Confirmou na véspera e não apareceu.' },
  { dias: -11, hora: 10, tipo: 'test_drive', status: 'completed', lead: 'l-11', veiculo: 21, nota: 'Trouxe o Fox para a avaliação da troca no mesmo dia.' },
  { dias: -8, hora: 14, minuto: 30, tipo: 'test_drive', status: 'completed', lead: 'l-16', veiculo: 3, nota: 'Veio com a filha. Fechou no mesmo dia.' },
  { dias: -6, hora: 15, tipo: 'test_drive', status: 'completed', lead: 'l-5b', veiculo: 19, nota: 'Rodou uns 20 minutos. Pediu o contrato no dia seguinte.' },
  { dias: -4, hora: 11, tipo: 'evaluation', status: 'canceled', lead: 'l-12', veiculo: 10, motivoCancelamento: 'Cliente comprou em outra loja.' },
  { dias: -2, hora: 16, tipo: 'test_drive', status: 'no_show', lead: 'l-7', veiculo: 18, nota: 'Não atendeu o telefone no dia.' },
  { dias: 0, hora: 9, minuto: 30, tipo: 'test_drive', status: 'completed', lead: 'l-9', veiculo: 6, nota: 'Test drive de hoje cedo. Saiu com a proposta na mão.' },
  { dias: 0, hora: 17, tipo: 'test_drive', status: 'confirmed', lead: 'l-4', veiculo: 4, nota: 'Confirmou por WhatsApp hoje de manhã.' },
  { dias: 1, hora: 10, tipo: 'test_drive', status: 'scheduled', lead: 'l-3', veiculo: 7, nota: 'Quer levar a esposa.' },
  { dias: 1, hora: 15, tipo: 'evaluation', status: 'confirmed', lead: 'l-5', veiculo: 12, nota: 'Traz o Onix 2019 para a avaliação presencial.' },
  { dias: 2, hora: 11, tipo: 'test_drive', status: 'scheduled', lead: 'l-15', veiculo: 24, nota: 'Pediu para ver o histórico de revisões.' },
  { dias: 3, hora: 14, tipo: 'in_person', status: 'scheduled', lead: 'l-6', veiculo: 2, nota: 'Retorno do banco sobre o financiamento.' },
  { dias: 4, hora: 9, minuto: 30, tipo: 'delivery', status: 'confirmed', lead: 'l-9', veiculo: 6, nota: 'Entrega do T-Cross com a documentação.' },
  { dias: 6, hora: 16, tipo: 'test_drive', status: 'scheduled', lead: 'l-1', veiculo: 23, nota: 'Vem com a mãe conhecer o Mobi.' },
];

/* ════════════════════════════════════════════════════════════════════════
   Conversas do chat
   ════════════════════════════════════════════════════════════════════════ */

interface MensagemDaDemo {
  de: 'cliente' | 'vendedor';
  texto?: string;
  /** Horas atrás em que a mensagem foi enviada. */
  hAtras: number;
  proposta?: {
    /** Fração do preço do veículo. */
    preco: number;
    entradaFracao: number;
    parcelas: number;
    status: 'pending' | 'accepted' | 'declined';
  };
  lidaPeloVendedor?: boolean;
}

interface ConversaDaDemo {
  cliente: ChaveDeCliente;
  vendedor: ChaveDeVendedor;
  veiculo: number;
  lead?: string;
  status: 'open' | 'closed';
  mensagens: MensagemDaDemo[];
}

const CONVERSAS: ConversaDaDemo[] = [
  {
    // A conversa que vira negócio: proposta enviada pelo vendedor e aceita.
    cliente: 'marcelo', vendedor: 'ana', veiculo: 4, lead: 'l-4', status: 'open',
    mensagens: [
      { de: 'cliente', texto: 'Boa tarde! Vi o Creta 1.6 Action de vocês. Ele é de primeira dona?', hAtras: 50, lidaPeloVendedor: true },
      { de: 'vendedor', texto: 'Boa tarde, Marcelo! É sim, único dono e com todas as revisões na concessionária. Posso te mandar o histórico.', hAtras: 49 },
      { de: 'cliente', texto: 'Perfeito. E se eu der 35 mil de entrada, fica em quanto por mês?', hAtras: 48, lidaPeloVendedor: true },
      { de: 'vendedor', texto: 'Montei uma simulação para você:', hAtras: 47, proposta: { preco: 122_000, entradaFracao: 0.287, parcelas: 48, status: 'accepted' } },
      { de: 'cliente', texto: 'Fechado! Pode preparar. Consigo passar aí amanhã no fim da tarde.', hAtras: 44, lidaPeloVendedor: true },
      { de: 'vendedor', texto: 'Combinado. Já deixei o test drive marcado para hoje às 17h e a documentação separada.', hAtras: 43 },
    ],
  },
  {
    // Conversa com mensagem não lida: alimenta o badge do painel e da sidebar.
    cliente: 'leticia', vendedor: 'rogerio', veiculo: 12, lead: 'l-5', status: 'open',
    mensagens: [
      { de: 'cliente', texto: 'Oi! Sobre a troca do meu Onix: vocês avaliaram em quanto mesmo?', hAtras: 6, lidaPeloVendedor: true },
      { de: 'vendedor', texto: 'Oi, Letícia! A avaliação inicial ficou em R$ 52.500. Amanhã às 15h a gente confirma na vistoria presencial.', hAtras: 5 },
      { de: 'cliente', texto: 'Consigo chegar 16h em vez de 15h?', hAtras: 2, lidaPeloVendedor: false },
    ],
  },
  {
    cliente: 'juliana', vendedor: 'wesley', veiculo: 23, lead: 'l-1', status: 'closed',
    mensagens: [
      { de: 'cliente', texto: 'O Mobi Like tem direção elétrica?', hAtras: 27, lidaPeloVendedor: true },
      { de: 'vendedor', texto: 'Tem sim, direção elétrica e ar-condicionado. É bem leve para a cidade.', hAtras: 26 },
      { de: 'cliente', texto: 'Ótimo, vou levar minha mãe para conhecer no sábado.', hAtras: 25, lidaPeloVendedor: true },
      { de: 'vendedor', texto: 'Perfeito, deixei agendado. Qualquer coisa me chama por aqui.', hAtras: 25 },
    ],
  },
];

/* ════════════════════════════════════════════════════════════════════════
   Execução
   ════════════════════════════════════════════════════════════════════════ */

type Tx = Prisma.TransactionClient;

/** Ids criados, para as etapas seguintes se referirem uns aos outros. */
interface Contexto {
  tenantId: string;
  branchId: string;
  usuarios: Record<string, string>;
  clientes: Record<string, string>;
  veiculos: { id: string; preco: Prisma.Decimal; entrada: Date }[];
  leads: Record<string, { id: string; vendedor: string; criadoEm: Date }>;
}

async function garantirCatalogo() {
  const modelos = new Map<string, { brandId: string; modelId: string }>();
  for (const v of ESTOQUE) {
    const chave = `${v.marca}|${v.modelo}`;
    if (modelos.has(chave)) continue;
    const marca = await prisma.vehicleBrand.upsert({
      where: { name: v.marca }, update: {}, create: { name: v.marca },
    });
    const modelo = await prisma.vehicleModel.upsert({
      where: { brandId_name: { brandId: marca.id, name: v.modelo } },
      update: {},
      create: { brandId: marca.id, name: v.modelo },
    });
    modelos.set(chave, { brandId: marca.id, modelId: modelo.id });
  }
  return modelos;
}

/**
 * Apaga a loja de demonstração e só ela.
 *
 * O tenant leva junto, por cascata, tudo o que pende dele: usuários da equipe,
 * estoque, leads, agenda, negócios, contratos e conversas. Os clientes finais
 * são globais (`tenant_id` nulo) e por isso saem numa segunda passada, pela
 * lista exata de e-mails que este arquivo cria.
 */
async function apagar(): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });

  if (tenant) {
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }

  const emails = CLIENTES.map((c) => emailDoCliente(c.chave));
  await prisma.user.deleteMany({ where: { email: { in: emails }, tenantId: null } });

  return Boolean(tenant);
}

async function criarLoja(tx: Tx) {
  const tenant = await tx.tenant.create({
    data: {
      slug: LOJA.slug,
      legalName: LOJA.legalName,
      tradeName: LOJA.tradeName,
      taxId: LOJA.taxId,
      stateRegistration: LOJA.stateRegistration,
      primaryEmail: LOJA.primaryEmail,
      primaryPhone: LOJA.primaryPhone,
      logoUrl: LOGO,
      brandColor: LOJA.brandColor,
      websiteUrl: LOJA.websiteUrl,
      timezone: FUSO,
      acceptsTradeIn: LOJA.acceptsTradeIn,
      legalRepName: LOJA.legalRep.nome,
      legalRepCpf: LOJA.legalRep.cpf,
      legalRepRole: LOJA.legalRep.cargo,
      legalRepEmail: LOJA.legalRep.email,
      createdAt: diasAtras(720, 9),
      subscription: {
        create: {
          plan: 'pro',
          status: 'active',
          seatsLimit: 10,
          currentPeriodStart: new Date(AGORA.getFullYear(), AGORA.getMonth(), 1),
          currentPeriodEnd: new Date(AGORA.getFullYear(), AGORA.getMonth() + 1, 1),
        },
      },
    },
    select: { id: true },
  });

  const branch = await tx.dealershipBranch.create({
    data: {
      tenantId: tenant.id,
      name: LOJA.filial.name,
      isHeadquarters: true,
      phone: LOJA.primaryPhone,
      email: LOJA.primaryEmail,
      addressLine: LOJA.filial.addressLine,
      addressNumber: LOJA.filial.addressNumber,
      neighborhood: LOJA.filial.neighborhood,
      city: LOJA.filial.city,
      state: LOJA.filial.state,
      postalCode: LOJA.filial.postalCode,
      country: 'BR',
      latitude: LOJA.filial.latitude,
      longitude: LOJA.filial.longitude,
      businessHours: EXPEDIENTE as unknown as Prisma.InputJsonValue,
      createdAt: diasAtras(720, 9),
    },
    select: { id: true },
  });

  return { tenantId: tenant.id, branchId: branch.id };
}

async function criarEquipe(tx: Tx, ctx: Contexto, senha: string) {
  const usuarios: Record<string, string> = {};

  for (const m of EQUIPE) {
    const entrou = diasAtras(m.entrouHaDias, 9);
    const u = await tx.user.create({
      data: {
        tenantId: ctx.tenantId,
        email: m.email,
        fullName: m.fullName,
        passwordHash: senha,
        role: m.role,
        status: 'active',
        phone: m.telefone,
        cpf: m.cpf,
        jobTitle: m.jobTitle,
        emailVerifiedAt: entrou,
        lastLoginAt: minutosAtras(rng.int(20, 600)),
        createdAt: entrou,
      },
      select: { id: true },
    });
    usuarios[m.chave] = u.id;

    // O dono não tem perfil de vendedor: ele não entra no rodízio nem tem
    // comissão, e a coluna de comissão da equipe mostra "—" para ele, que é a
    // informação correta ("ninguém informou"), não zero.
    if (m.role !== 'tenant_admin') {
      await tx.salespersonProfile.create({
        data: {
          userId: u.id,
          tenantId: ctx.tenantId,
          branchId: ctx.branchId,
          hireDate: entrou,
          commissionPct: m.comissao != null ? D(m.comissao) : null,
          presence: m.chave === 'ana' ? 'online' : m.chave === 'rogerio' ? 'busy' : 'offline',
          lastSeenAt: minutosAtras(rng.int(2, 240)),
          isAcceptingLeads: true,
          bio:
            m.role === 'manager'
              ? 'Gerente de vendas. Acompanha a equipe e o fechamento.'
              : 'Consultor de vendas de seminovos.',
        },
      });
    }
  }

  return usuarios;
}

/**
 * Ajustes de CRM da loja. A linha é criada explicitamente — e não deixada para
 * o padrão em memória — porque a demonstração mostra a tela de configuração, e
 * uma loja sem linha exibiria valores que ninguém escolheu.
 */
async function criarAjustesDeCrm(tx: Tx, ctx: Contexto, ultimoDoRodizio: string) {
  await tx.tenantCrmSettings.create({
    data: {
      tenantId: ctx.tenantId,
      rodizioAtivo: true,
      rodizioIncluiGerentes: false,
      slaPrimeiroContatoMinutos: SLA_MINUTOS,
      slaDevolveParaFila: false,
      vendedorVeTodosOsLeads: false,
      rodizioUltimoUsuarioId: ultimoDoRodizio,
      rodizioAtualizadoEm: AGORA,
    },
  });
}

async function criarMetas(tx: Tx, ctx: Contexto) {
  const metas: { chave: string | null; alvo: number; valor: number }[] = [
    { chave: null, alvo: 18, valor: 1_950_000 },
    { chave: 'ana', alvo: 7, valor: 760_000 },
    { chave: 'rogerio', alvo: 6, valor: 660_000 },
    { chave: 'wesley', alvo: 5, valor: 530_000 },
  ];

  // Mês corrente e o anterior: o seletor de período da tela de equipe precisa
  // de mais de um mês para provar que é um seletor.
  for (const mes of [0, 1]) {
    for (const m of metas) {
      await tx.salesGoal.create({
        data: {
          tenantId: ctx.tenantId,
          userId: m.chave ? ctx.usuarios[m.chave] : null,
          period: periodo(mes),
          target: m.alvo,
          targetValue: D(m.valor),
        },
      });
    }
  }
}

async function criarClientes(tx: Tx, senha: string) {
  const ids: Record<string, string> = {};
  for (const [i, c] of CLIENTES.entries()) {
    const u = await tx.user.create({
      data: {
        email: emailDoCliente(c.chave),
        fullName: c.nome,
        role: 'customer',
        status: 'active',
        passwordHash: senha,
        phone: telefoneDemo(100 + i),
        emailVerifiedAt: diasAtras(rng.int(40, 300), 9),
        createdAt: diasAtras(rng.int(40, 300), 9),
        customerProfile: {
          create: {
            city: c.cidade,
            state: c.uf,
            documentNumber: cpfDemo(100 + i),
            preferredContact: 'whatsapp',
          },
        },
      },
      select: { id: true },
    });
    ids[c.chave] = u.id;
  }
  return ids;
}

async function criarEstoque(
  tx: Tx,
  ctx: Contexto,
  modelos: Map<string, { brandId: string; modelId: string }>,
) {
  // Quando o carro entrou no estoque: antes do primeiro negócio dele, e entre
  // 20 e 120 dias atrás para os parados — é isso que dá conteúdo ao gráfico de
  // giro, que ordena por dias em estoque.
  const primeiroNegocio = new Map<number, number>();
  for (const n of NEGOCIOS) {
    const abertura = n.linha[0][1];
    primeiroNegocio.set(n.veiculo, Math.max(primeiroNegocio.get(n.veiculo) ?? 0, abertura));
  }

  const veiculos: { id: string; preco: Prisma.Decimal; entrada: Date }[] = [];

  for (const [i, e] of ESTOQUE.entries()) {
    const m = modelos.get(`${e.marca}|${e.modelo}`)!;
    const rascunho = RASCUNHOS[i];
    const fotos = FOTOS[e.foto];
    if (!fotos) throw new Error(`Sem foto cadastrada para "${e.foto}" — confira a tabela FOTOS.`);

    const diasNoEstoque = (primeiroNegocio.get(i) ?? rng.int(8, 70)) + rng.int(6, 20);
    const entrada = diasAtras(diasNoEstoque, 9, rng.int(0, 59));
    const preco = D(e.preco);

    const usarFoto = !rascunho?.semFoto;
    const imagens = usarFoto
      ? fotos.fotos.map((f, pos) => ({
          tenantId: ctx.tenantId,
          url: f.url,
          // O crédito viaja com a imagem. CC BY e CC BY-SA pedem atribuição, e
          // o `alt` é o único lugar por onde ela acompanha a foto em todas as
          // telas sem alterar o desenho de nenhuma delas.
          altText: `${e.marca} ${e.modelo} ${e.versao} — foto de ${f.autor} (Wikimedia Commons, ${f.licenca})`,
          isCover: pos === 0,
          position: pos,
          createdAt: entrada,
        }))
      : [];

    const v = await tx.vehicle.create({
      data: {
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        brandId: m.brandId,
        modelId: m.modelId,
        versionName: e.versao,
        yearMake: e.anoFab,
        yearModel: e.anoMod,
        mileageKm: e.km,
        color: rascunho?.semCor ? null : fotos.cor,
        fuel: e.comb,
        transmission: rascunho?.semCambio ? null : e.cambio,
        doors: 4,
        // Chassi de mentira, e que se anuncia como tal: ele sai impresso no
        // contrato ("chassi …"), e um VIN plausível ali seria o único campo do
        // documento capaz de coincidir com um carro de verdade.
        vin: `DEMO${String(i + 1).padStart(13, '0')}`,
        condition: e.anoMod >= 2023 ? 'semi_new' : 'used',
        status: 'available',
        price: preco,
        licensePlate: placaMercosul(),
        description:
          `${e.marca} ${e.modelo} ${e.versao} ${e.anoFab}/${e.anoMod}, ${e.km.toLocaleString('pt-BR')} km, ` +
          `${fotos.cor.toLowerCase()}. Revisões em dia, pneus com boa banda, laudo cautelar aprovado. ` +
          'Aceitamos troca e financiamos em até 60 meses.',
        listingStatus: rascunho ? 'draft' : 'published',
        publishedAt: rascunho ? null : entrada,
        createdAt: entrada,
        metadata: { demo: true, fipeReferencia: e.fipe },
        images: imagens.length ? { create: imagens } : undefined,
        acquisition: {
          create: {
            tenantId: ctx.tenantId,
            origin: rng.pick(['direct_purchase', 'trade_in', 'auction', 'direct_purchase'] as const),
            supplierName: rng.pick([
              'Leilão Pátio Central (demonstração)',
              'Compra direta de particular',
              'Troca de cliente',
            ]),
            purchaseValue: D(e.compra),
            enteredAt: entrada,
            notes: 'Dado de demonstração.',
          },
        },
        costs: {
          create: [
            { tenantId: ctx.tenantId, kind: 'preparation', value: D(rng.int(7, 19) * 100), description: 'Higienização, polimento e cristalização', incurredAt: diasAtras(Math.max(0, diasNoEstoque - 2), 14) },
            { tenantId: ctx.tenantId, kind: 'mechanical', value: D(rng.int(5, 32) * 100), description: 'Revisão, óleo e pastilhas de freio', incurredAt: diasAtras(Math.max(0, diasNoEstoque - 4), 15) },
            { tenantId: ctx.tenantId, kind: 'documentation', value: D(rng.int(3, 8) * 100), description: 'Vistoria e transferência', incurredAt: diasAtras(Math.max(0, diasNoEstoque - 6), 11) },
          ],
        },
      },
      select: { id: true },
    });

    veiculos.push({ id: v.id, preco, entrada });
  }

  return veiculos;
}

/* ── Leads ──────────────────────────────────────────────────────────────── */

const ORIGEM_EM_PALAVRAS: Record<string, string> = {
  website: 'formulário do site',
  app: 'aplicativo',
  whatsapp: 'WhatsApp',
  phone: 'telefone',
  walk_in: 'atendimento na loja',
  referral: 'indicação',
  social: 'rede social',
  ad: 'anúncio',
  trade_in: 'proposta de troca',
  other: 'outro canal',
};

/** O tipo da interação que conta como primeira resposta, por canal de origem. */
function canalDeResposta(origem: LeadSource): string {
  if (origem === 'phone' || origem === 'walk_in' || origem === 'referral') return 'call';
  if (origem === 'whatsapp' || origem === 'social' || origem === 'ad') return 'whatsapp';
  return 'whatsapp';
}

const TEXTO_DA_RESPOSTA: Record<string, string> = {
  call: 'Liguei para o cliente e apresentei o veículo.',
  whatsapp: 'Respondi pelo WhatsApp com fotos e a condição de pagamento.',
  email: 'Respondi por e-mail com a ficha do veículo.',
};

async function criarLeads(tx: Tx, ctx: Contexto) {
  const criados: Record<string, { id: string; vendedor: string; criadoEm: Date }> = {};

  for (const [i, l] of LEADS.entries()) {
    // O anel do rodízio, girando na ordem cronológica.
    const chaveDoVendedor = VENDEDORES[i % VENDEDORES.length];
    const vendedorId = ctx.usuarios[chaveDoVendedor];

    const criadoEm = minutosAtras(l.entrouHaMinutos);
    const cliente = l.cliente ? CLIENTES.find((c) => c.chave === l.cliente)! : null;
    const telefone = l.cliente
      ? telefoneDemo(100 + CLIENTES.findIndex((c) => c.chave === l.cliente))
      : telefoneDemo(200 + i);

    const prazo = calcularPrazoDeResposta(criadoEm, SLA_MINUTOS, EXPEDIENTE, FUSO);
    const respondidoEm =
      l.respondeuEmMinutos != null ? somarMinutos(criadoEm, l.respondeuEmMinutos) : null;

    const publico = l.origem === 'website' || l.origem === 'trade_in';

    const lead = await tx.lead.create({
      data: {
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        customerUserId: l.cliente ? ctx.clientes[l.cliente] : null,
        vehicleId: l.veiculo != null ? ctx.veiculos[l.veiculo].id : null,
        assignedTo: vendedorId,
        contactName: cliente?.nome ?? l.nomeAvulso ?? null,
        contactEmail: l.cliente ? emailDoCliente(l.cliente) : null,
        contactPhone: telefone,
        contactPhoneNormalized: normalizarTelefoneBr(telefone),
        source: l.origem,
        status: l.status,
        message: l.mensagem,
        score: rng.int(48, 96),
        lastActivityAt: respondidoEm ?? criadoEm,
        wonAt: l.status === 'won' ? somarMinutos(criadoEm, rng.int(2, 8) * UM_DIA) : null,
        lostReasonCode: l.motivoPerda?.codigo ?? null,
        lostReason: l.motivoPerda?.texto ?? null,
        firstResponseDueAt: prazo,
        firstRespondedAt: respondidoEm,
        slaBreachedAt: l.estourou ? (prazo ?? criadoEm) : null,
        // O consentimento LGPD só existe onde ele é de fato colhido: o
        // formulário público. Lead anotado pelo vendedor no balcão não tem
        // aceite de termo, e inventar um seria inventar prova.
        consentedAt: publico ? criadoEm : null,
        consentText: publico
          ? 'Autorizo a Aurora Seminovos a entrar em contato comigo sobre este veículo e a tratar meus dados para esse fim, nos termos da LGPD.'
          : null,
        createdAt: criadoEm,
        metadata: l.troca
          ? {
              demo: true,
              tradeIn: {
                vehicle: {
                  brandName: l.troca.marca,
                  modelName: l.troca.modelo,
                  versionName: l.troca.versao,
                  yearMake: l.troca.anoFab,
                  yearModel: l.troca.anoMod,
                  mileageKm: l.troca.km,
                  color: l.troca.cor,
                  fuel: 'flex',
                  transmission: 'manual',
                  hasDebts: false,
                  isFinanced: false,
                },
                expectedValue: l.troca.esperado,
                fipeReference: l.troca.fipe,
                appraisal: {
                  value: l.troca.avaliado,
                  note: 'Pintura original, pneus com 60%. Precisa de revisão dos amortecedores.',
                  status: 'offered',
                  evaluatedBy: vendedorId,
                  evaluatedAt: somarMinutos(criadoEm, 90).toISOString(),
                },
              },
            }
          : { demo: true },
      },
      select: { id: true },
    });

    criados[l.chave] = { id: lead.id, vendedor: vendedorId, criadoEm };

    /* ── Linha do tempo ──────────────────────────────────────────────── */
    const interacoes: Prisma.LeadInteractionCreateManyInput[] = [
      {
        leadId: lead.id, tenantId: ctx.tenantId, actorUserId: null,
        kind: 'created', content: `Lead criado — ${ORIGEM_EM_PALAVRAS[l.origem]}`,
        occurredAt: criadoEm,
      },
      {
        leadId: lead.id, tenantId: ctx.tenantId, actorUserId: null,
        kind: 'rotation', content: 'Lead distribuído automaticamente pelo rodízio',
        payload: { salesPersonId: vendedorId },
        occurredAt: criadoEm,
      },
    ];

    if (respondidoEm) {
      const canal = canalDeResposta(l.origem);
      interacoes.push({
        leadId: lead.id, tenantId: ctx.tenantId, actorUserId: vendedorId,
        kind: canal, content: TEXTO_DA_RESPOSTA[canal] ?? 'Primeiro contato realizado.',
        occurredAt: respondidoEm,
      });
    }

    if (l.estourou && prazo) {
      interacoes.push({
        leadId: lead.id, tenantId: ctx.tenantId, actorUserId: null,
        kind: 'sla_breach', content: 'Prazo de primeiro contato estourado',
        payload: { prazo: prazo.toISOString(), devolvidoAFila: false },
        occurredAt: prazo,
      });
    }

    if (l.troca) {
      interacoes.push({
        leadId: lead.id, tenantId: ctx.tenantId, actorUserId: vendedorId,
        kind: 'trade_in_appraisal',
        content: `Veículo avaliado em R$ ${l.troca.avaliado.toLocaleString('pt-BR')}`,
        payload: { value: l.troca.avaliado, status: 'offered' },
        occurredAt: somarMinutos(criadoEm, 90),
      });
    }

    for (const e of l.extras ?? []) {
      interacoes.push({
        leadId: lead.id, tenantId: ctx.tenantId,
        actorUserId: e.deVendedor ? vendedorId : null,
        kind: e.kind, content: e.texto,
        occurredAt: somarMinutos(criadoEm, e.minutosApos),
      });
    }

    if (l.status !== 'new' && respondidoEm) {
      interacoes.push({
        leadId: lead.id, tenantId: ctx.tenantId, actorUserId: vendedorId,
        kind: 'status_change',
        content: `Status alterado para "${l.status}"`,
        occurredAt: somarMinutos(respondidoEm, rng.int(30, 600)),
      });
    }

    if (l.motivoPerda) {
      interacoes.push({
        leadId: lead.id, tenantId: ctx.tenantId, actorUserId: vendedorId,
        kind: 'note',
        content: l.motivoPerda.texto ?? 'Cliente informou que não vai seguir com a compra.',
        occurredAt: somarMinutos(criadoEm, rng.int(2, 6) * UM_DIA),
      });
    }

    await tx.leadInteraction.createMany({
      // Uma interação futura seria um registro de algo que ainda não
      // aconteceu; o `occurredAt` é limitado ao agora.
      data: interacoes.map((it) => ({
        ...it,
        occurredAt: it.occurredAt && (it.occurredAt as Date) > AGORA ? AGORA : it.occurredAt,
      })),
    });
  }

  return criados;
}

/* ── Agenda ─────────────────────────────────────────────────────────────── */

async function criarAgenda(tx: Tx, ctx: Contexto) {
  for (const a of AGENDA) {
    const lead = ctx.leads[a.lead];
    if (!lead) throw new Error(`Agenda aponta para lead inexistente: ${a.lead}`);

    const inicio =
      a.dias < 0
        ? dentroDoExpediente(diasAtras(-a.dias, a.hora, a.minuto ?? 0), false)
        : a.dias === 0
          ? a.status === 'completed'
            ? minutosAtras(rng.int(90, 240))
            : hojeMaisTarde(a.hora)
          : dentroDoExpediente(diasAFrente(a.dias, a.hora, a.minuto ?? 0), true);

    const leadCompleto = await tx.lead.findUnique({
      where: { id: lead.id },
      select: { customerUserId: true, contactName: true, contactPhone: true, contactEmail: true },
    });

    await tx.appointment.create({
      data: {
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        customerUserId: leadCompleto?.customerUserId ?? null,
        contactName: leadCompleto?.customerUserId ? null : leadCompleto?.contactName,
        contactPhone: leadCompleto?.customerUserId ? null : leadCompleto?.contactPhone,
        contactEmail: leadCompleto?.customerUserId ? null : leadCompleto?.contactEmail,
        leadId: lead.id,
        salespersonId: lead.vendedor,
        vehicleId: ctx.veiculos[a.veiculo].id,
        type: a.tipo,
        status: a.status,
        scheduledStart: inicio,
        scheduledEnd: somarMinutos(inicio, a.tipo === 'delivery' ? 90 : 45),
        address: `${LOJA.filial.addressLine}, ${LOJA.filial.addressNumber} — ${LOJA.filial.city}/${LOJA.filial.state}`,
        notes: a.nota ?? null,
        cancellationReason: a.motivoCancelamento ?? null,
        createdAt: new Date(Math.min(inicio.getTime() - 2 * 86_400_000, AGORA.getTime())),
      },
    });
  }
}

/* ── Negócios, contrato e troca ─────────────────────────────────────────── */

async function criarNegocios(tx: Tx, ctx: Contexto) {
  const leadPorNegocio = new Map<string, string>();
  for (const l of LEADS) if (l.negocio) leadPorNegocio.set(l.negocio, l.chave);

  let contratos = 0;
  let faturados = 0;

  for (const n of NEGOCIOS) {
    const v = ctx.veiculos[n.veiculo];
    const leadChave = leadPorNegocio.get(n.chave);
    const lead = leadChave ? ctx.leads[leadChave] : null;
    const vendedorId = lead?.vendedor ?? ctx.usuarios[VENDEDORES[0]];
    const clienteId = ctx.clientes[n.cliente];
    const cliente = CLIENTES.find((c) => c.chave === n.cliente)!;

    const quando = (dias: number, hora: number) => diasAtras(dias, hora, rng.int(0, 59));
    const abertura = quando(n.linha[0][1], 10);
    const marco = (s: DealStatus) => {
      const p = n.linha.find(([st]) => st === s);
      return p ? quando(p[1], 16) : null;
    };

    const final = n.linha[n.linha.length - 1][0];
    const listPrice = v.preco;
    const discount = D(n.desconto);
    const saleValue = listPrice.minus(discount);

    const emitidoEm = marco('contract_issued');
    const signedAt = marco('signed');
    const invoicedAt = marco('invoiced');
    const deliveredAt = marco('delivered');
    const canceledAt = marco('canceled');

    // Faturado congela custo e margem, do mesmo jeito que o `DealStateService`.
    let vehicleCostSnapshot: Prisma.Decimal | null = null;
    let grossMargin: Prisma.Decimal | null = null;
    if (invoicedAt) {
      const [aq, custos] = await Promise.all([
        tx.vehicleAcquisition.findFirst({
          where: { tenantId: ctx.tenantId, vehicleId: v.id }, select: { purchaseValue: true },
        }),
        tx.vehicleCost.findMany({
          where: { tenantId: ctx.tenantId, vehicleId: v.id }, select: { value: true },
        }),
      ]);
      vehicleCostSnapshot = custos.reduce((a, c) => a.plus(c.value), aq!.purchaseValue);
      grossMargin = saleValue.minus(vehicleCostSnapshot);
      faturados++;
    }

    const deal = await tx.deal.create({
      data: {
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        leadId: lead?.id ?? null,
        vehicleId: v.id,
        customerUserId: clienteId,
        salespersonId: vendedorId,
        status: final,
        listPrice, discount, saleValue,
        vehicleCostSnapshot, grossMargin,
        closedAt: signedAt,
        deliveredAt,
        canceledAt,
        cancelReasonCode: n.motivoCancelamento?.codigo ?? null,
        cancelReason: n.motivoCancelamento?.texto ?? null,
        createdAt: abertura,
      },
      select: { id: true },
    });

    /* Histórico: abertura (draft→draft, como o service grava) + transições. */
    const eventos: { from: DealStatus; to: DealStatus; em: Date; motivo?: string }[] = [
      { from: 'draft', to: 'draft', em: abertura, motivo: 'Negócio aberto' },
    ];
    for (let p = 1; p < n.linha.length; p++) {
      const [st, dias] = n.linha[p];
      const exato =
        st === 'contract_issued' ? emitidoEm
        : st === 'signed' ? signedAt
        : st === 'invoiced' ? invoicedAt
        : st === 'delivered' ? deliveredAt
        : st === 'canceled' ? canceledAt
        : null;
      eventos.push({
        from: n.linha[p - 1][0],
        to: st,
        em: exato ?? quando(dias, 16),
        motivo: st === 'canceled' ? n.motivoCancelamento?.texto : undefined,
      });
    }
    await tx.dealStatusEvent.createMany({
      data: eventos.map((e) => ({
        tenantId: ctx.tenantId, dealId: deal.id,
        fromStatus: e.from, toStatus: e.to,
        actorUserId: vendedorId, reason: e.motivo ?? null,
        occurredAt: e.em,
      })),
    });

    /* Pagamentos: a composição fecha com a venda — sem isso a assinatura é
       recusada. Centavos de arredondamento entram na última parcela. */
    const confirmado = signedAt != null;
    let acumulado = D(0);
    for (const [k, p] of n.pagamentos.entries()) {
      const ultimo = k === n.pagamentos.length - 1;
      const valor = ultimo
        ? saleValue.minus(acumulado)
        : saleValue.times(D(p.fracao)).toDecimalPlaces(2);
      acumulado = acumulado.plus(valor);

      await tx.dealPayment.create({
        data: {
          tenantId: ctx.tenantId,
          dealId: deal.id,
          kind: p.kind,
          value: valor,
          institution: p.instituicao ?? null,
          installments: p.parcelas ?? null,
          installmentValue: p.parcelas
            ? valor.times(D('1.42')).dividedBy(p.parcelas).toDecimalPlaces(2)
            : null,
          status: confirmado ? 'confirmed' : 'pending',
          confirmedAt: confirmado ? signedAt : null,
          notes: p.kind === 'trade_in' ? 'Veículo do cliente aceito na troca.' : null,
          createdAt: emitidoEm ?? abertura,
        },
      });
    }

    /* Comprador identificado: sem ele o contrato não é emitido. */
    const precisaDeComprador = n.linha.some(([s]) =>
      ['contract_issued', 'signed', 'invoiced', 'documentation', 'delivered'].includes(s),
    ) || ['proposal', 'negotiating', 'awaiting_credit'].includes(final);

    const buyer = precisaDeComprador
      ? {
          fullName: cliente.nome,
          cpf: cpfDemo(100 + CLIENTES.findIndex((c) => c.chave === n.cliente)),
          rg: `${rng.int(10, 49)}.${rng.int(100, 999)}.${rng.int(100, 999)}-${rng.int(0, 9)}`,
          rgIssuer: 'SSP/SP',
          nationality: 'brasileiro(a)',
          maritalStatus: rng.pick(['solteiro(a)', 'casado(a)', 'divorciado(a)']),
          occupation: rng.pick(['analista de sistemas', 'professora', 'engenheiro civil', 'representante comercial', 'enfermeira']),
          addressLine: rng.pick(['Rua Cerqueira César', 'Av. Nove de Julho', 'Rua São Sebastião', 'Av. Independência']),
          addressNumber: String(rng.int(80, 1900)),
          neighborhood: rng.pick(['Centro', 'Jardim Paulista', 'Vila Tibério', 'Alto da Boa Vista']),
          city: cliente.cidade,
          state: cliente.uf,
          postalCode: `140${rng.int(10, 99)}-${rng.int(100, 999)}`,
          email: emailDoCliente(n.cliente),
        }
      : null;

    if (buyer) {
      await tx.dealBuyer.create({
        data: { dealId: deal.id, tenantId: ctx.tenantId, ...buyer },
      });
    }

    /* Garantia: a legal de 90 dias é constante; a contratual é opcional. */
    const garantia = {
      legalDays: 90,
      contractualMonths: n.garantiaMeses ?? null,
      contractualScope: n.garantiaEscopo ?? null,
    };
    if (emitidoEm) {
      await tx.dealWarranty.create({
        data: {
          dealId: deal.id,
          tenantId: ctx.tenantId,
          legalDays: garantia.legalDays,
          legalStartsAt: deliveredAt,
          contractualMonths: garantia.contractualMonths,
          contractualScope: garantia.contractualScope,
        },
      });
    }

    /* Troca: o usado que o cliente entregou. */
    if (n.troca) {
      await tx.tradeIn.create({
        data: {
          tenantId: ctx.tenantId,
          dealId: deal.id,
          brandName: n.troca.marca,
          modelName: n.troca.modelo,
          versionName: n.troca.versao,
          yearMake: n.troca.anoFab,
          yearModel: n.troca.anoMod,
          mileageKm: n.troca.km,
          color: n.troca.cor,
          licensePlate: placaMercosul(),
          fipeReference: String(n.troca.fipe),
          fipeValue: D(n.troca.fipe),
          appraisedValue: D(n.troca.avaliado),
          acceptedValue: D(n.troca.aceito),
          createdAt: emitidoEm ?? abertura,
        },
      });
    }

    /* Contrato: gerado com o MESMO código da API, para o hash conferir no
       download. */
    if (n.contrato && emitidoEm && buyer) {
      await emitirContrato(tx, ctx, {
        dealId: deal.id,
        emitidoEm,
        assinadoEm: n.contrato === 'assinado' ? (signedAt ?? emitidoEm) : null,
        vendedorId,
        clienteId,
        buyer,
        garantia,
        veiculoIdx: n.veiculo,
        listPrice, discount, saleValue,
        pagamentos: n.pagamentos.map((p, k) => ({
          forma: p.kind,
          valor: brl(
            k === n.pagamentos.length - 1
              ? saleValue.minus(
                  n.pagamentos
                    .slice(0, k)
                    .reduce((a, q) => a.plus(saleValue.times(D(q.fracao)).toDecimalPlaces(2)), D(0)),
                )
              : saleValue.times(D(p.fracao)).toDecimalPlaces(2),
          ),
          detalhe: [p.instituicao, p.parcelas ? `${p.parcelas}x` : null].filter(Boolean).join(' · ') || null,
        })),
      });
      contratos++;
    }

    /* Estoque: faturado vira vendido; vivo fica reservado; cancelado volta. */
    if (invoicedAt) {
      await tx.vehicle.update({
        where: { id: v.id }, data: { status: 'sold', soldAt: invoicedAt },
      });
    } else if (final !== 'canceled') {
      await tx.vehicle.update({ where: { id: v.id }, data: { status: 'reserved' } });
    }
  }

  return { contratos, faturados };
}

interface DadosDoContrato {
  dealId: string;
  emitidoEm: Date;
  assinadoEm: Date | null;
  vendedorId: string;
  clienteId: string;
  buyer: {
    fullName: string; cpf: string; rg: string | null; rgIssuer: string | null;
    nationality: string | null; maritalStatus: string | null; occupation: string | null;
    addressLine: string | null; addressNumber: string | null; neighborhood: string | null;
    city: string | null; state: string | null; postalCode: string | null;
  };
  garantia: { legalDays: number; contractualMonths: number | null; contractualScope: string | null };
  veiculoIdx: number;
  listPrice: Prisma.Decimal;
  discount: Prisma.Decimal;
  saleValue: Prisma.Decimal;
  pagamentos: { forma: string; valor: string; detalhe: string | null }[];
}

/**
 * Emite o contrato exatamente como `ContractsService.emitir` faria: mesmo
 * template, mesmo snapshot e — o que importa — o mesmo gerador de PDF, para
 * que `GET /contracts/:id/pdf` regenere o arquivo e o hash confira.
 *
 * O contrato **não** é arquivado no Supabase Storage: `storageKey` fica nulo,
 * que é o mesmo estado de uma loja sem armazenamento configurado. O download
 * continua funcionando, porque ele regenera a partir do snapshot.
 */
async function emitirContrato(tx: Tx, ctx: Contexto, d: DadosDoContrato) {
  const template = await tx.contractTemplate.upsert({
    where: { tenantId_name_version: { tenantId: ctx.tenantId, name: 'Compra e venda', version: 1 } },
    update: {},
    create: {
      tenantId: ctx.tenantId,
      name: 'Compra e venda',
      version: 1,
      blocks: TEMPLATE_PADRAO as unknown as Prisma.InputJsonValue,
    },
  });

  const e = ESTOQUE[d.veiculoIdx];
  const veiculo = await tx.vehicle.findUnique({
    where: { id: ctx.veiculos[d.veiculoIdx].id },
    select: { licensePlate: true, vin: true, mileageKm: true, yearMake: true, yearModel: true },
  });

  const endereco = `${LOJA.filial.addressLine}, ${LOJA.filial.addressNumber} — ${LOJA.filial.city} — ${LOJA.filial.state}`;

  const snapshot: SnapshotContrato = {
    emitidoEm: d.emitidoEm.toLocaleDateString('pt-BR'),
    loja: {
      nome: LOJA.tradeName,
      documento: LOJA.taxId,
      endereco,
      qualificacao: qualificarVendedor({
        legalName: LOJA.legalName,
        tradeName: LOJA.tradeName,
        taxId: LOJA.taxId,
        stateRegistration: LOJA.stateRegistration,
        endereco,
        legalRepName: LOJA.legalRep.nome,
        legalRepCpf: LOJA.legalRep.cpf,
        legalRepRole: LOJA.legalRep.cargo,
      }),
      representante: LOJA.legalRep.nome,
    },
    cliente: {
      nome: d.buyer.fullName,
      documento: formatarCpf(d.buyer.cpf),
      email: null,
      qualificacao: qualificarComprador(d.buyer),
    },
    veiculo: {
      descricao: `${e.marca} ${e.modelo} ${e.versao}`.trim(),
      anoModelo: veiculo!.yearModel,
      anoFabricacao: veiculo!.yearMake,
      placa: veiculo!.licensePlate,
      chassi: veiculo!.vin,
      km: veiculo!.mileageKm,
    },
    valores: {
      tabela: brl(d.listPrice),
      desconto: brl(d.discount),
      venda: brl(d.saleValue),
    },
    pagamentos: d.pagamentos,
    garantia: d.garantia,
  };

  const { hash } = await gerarPdfDoContrato(
    TEMPLATE_PADRAO,
    snapshot,
    d.emitidoEm,
  );

  const contrato = await tx.dealContract.create({
    data: {
      tenantId: ctx.tenantId,
      dealId: d.dealId,
      templateId: template.id,
      status: d.assinadoEm ? 'signed' : 'issued',
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      contentHash: hash,
      // Sem armazenamento privado configurado na demonstração — o download
      // regenera o PDF a partir do snapshot, que é o caminho normal.
      storageKey: null,
      issuedAt: d.emitidoEm,
      signedAt: d.assinadoEm,
      createdAt: d.emitidoEm,
    },
    select: { id: true },
  });

  await tx.dealStatusEvent.create({
    data: {
      tenantId: ctx.tenantId,
      dealId: d.dealId,
      fromStatus: 'contract_issued',
      toStatus: 'contract_issued',
      actorUserId: d.vendedorId,
      reason: `Contrato emitido (${hash.slice(0, 12)}…)`,
      occurredAt: d.emitidoEm,
    },
  });

  if (d.assinadoEm) {
    // Assinatura **interna**: a trilha é ip + user-agent + hash aceito, que é
    // o que o sistema registra quando não há provedor externo. Nenhum envio
    // para provedor de assinatura eletrônica é simulado aqui.
    await tx.contractSignature.createMany({
      data: [
        {
          tenantId: ctx.tenantId, contractId: contrato.id, role: 'dealer',
          signerUserId: d.vendedorId, signerName: LOJA.legalRep.nome,
          signerDocument: LOJA.legalRep.cpf,
          ip: '203.0.113.10', userAgent: 'Mozilla/5.0 (demonstração AutoConnect)',
          acceptedHash: hash, signedAt: d.assinadoEm,
        },
        {
          tenantId: ctx.tenantId, contractId: contrato.id, role: 'customer',
          signerUserId: d.clienteId, signerName: d.buyer.fullName,
          signerDocument: d.buyer.cpf,
          ip: '203.0.113.42', userAgent: 'Mozilla/5.0 (demonstração AutoConnect)',
          acceptedHash: hash, signedAt: somarMinutos(d.assinadoEm, 12),
        },
      ],
    });
  }
}

/* ── Conversas ──────────────────────────────────────────────────────────── */

async function criarConversas(tx: Tx, ctx: Contexto) {
  for (const c of CONVERSAS) {
    const veiculo = ctx.veiculos[c.veiculo];
    const e = ESTOQUE[c.veiculo];
    const vendedorId = ctx.usuarios[c.vendedor];
    const clienteId = ctx.clientes[c.cliente];
    const lead = c.lead ? ctx.leads[c.lead] : null;

    const instantes = c.mensagens.map((m) => minutosAtras(Math.round(m.hAtras * 60)));
    const ultima = instantes[instantes.length - 1];
    const naoLidas = c.mensagens.filter(
      (m) => m.de === 'cliente' && m.lidaPeloVendedor === false,
    ).length;

    const conversa = await tx.conversation.create({
      data: {
        tenantId: ctx.tenantId,
        customerUserId: clienteId,
        salespersonId: vendedorId,
        vehicleId: veiculo.id,
        leadId: lead?.id ?? null,
        status: c.status,
        lastMessageAt: ultima,
        unreadCountCustomer: 0,
        unreadCountSalesperson: naoLidas,
        createdAt: instantes[0],
      },
      select: { id: true },
    });

    for (const [i, m] of c.mensagens.entries()) {
      const em = instantes[i];
      const doCliente = m.de === 'cliente';

      const metadata = m.proposta
        ? {
            proposal: {
              price: m.proposta.preco,
              downPayment: Math.round(m.proposta.preco * m.proposta.entradaFracao),
              installments: m.proposta.parcelas,
              installmentValue: Math.round(
                (m.proposta.preco * (1 - m.proposta.entradaFracao) * 1.42) / m.proposta.parcelas,
              ),
              vehicleLabel: `${e.marca} ${e.modelo} ${e.versao} ${e.anoMod}`,
              status: m.proposta.status,
              respondedAt:
                m.proposta.status === 'pending' ? undefined : somarMinutos(em, 55).toISOString(),
            },
          }
        : {};

      await tx.message.create({
        data: {
          conversationId: conversa.id,
          tenantId: ctx.tenantId,
          senderUserId: doCliente ? clienteId : vendedorId,
          kind: 'text',
          body: m.texto ?? null,
          metadata: metadata as Prisma.InputJsonValue,
          deliveredAt: em,
          // Mensagem do cliente sem leitura é o que acende o contador do
          // painel; a do vendedor nasce lida pelo próprio autor.
          readAt: doCliente && m.lidaPeloVendedor === false ? null : em,
          createdAt: em,
        },
      });
    }

    if (c.lead && lead) {
      await tx.leadInteraction.create({
        data: {
          leadId: lead.id,
          tenantId: ctx.tenantId,
          actorUserId: vendedorId,
          kind: 'chat',
          content: 'Conversa iniciada pelo chat do site.',
          occurredAt: instantes[0],
        },
      });
    }
  }
}

/* ── Visualizações e favoritos ──────────────────────────────────────────── */

async function criarEngajamento(tx: Tx, ctx: Contexto) {
  const views: Prisma.VehicleViewCreateManyInput[] = [];
  const clientesIds = Object.values(ctx.clientes);

  for (const [i, v] of ctx.veiculos.entries()) {
    if (RASCUNHOS[i]) continue; // rascunho não está na vitrine: não tem visita

    const diasVisivel = Math.max(
      1,
      Math.floor((AGORA.getTime() - v.entrada.getTime()) / 86_400_000),
    );
    const total = rng.int(6, 22) + (i % 5 === 0 ? 14 : 0);

    for (let j = 0; j < total; j++) {
      const dias = rng.int(0, Math.min(59, diasVisivel));
      views.push({
        tenantId: ctx.tenantId,
        vehicleId: v.id,
        userId: rng.next() > 0.6 ? rng.pick(clientesIds) : null,
        sessionId: `demo-${i}-${j}`,
        source: rng.pick(['catalogo', 'mapa', 'pagina_loja']),
        viewedAt: diasAtras(dias, rng.int(8, 22), rng.int(0, 59)),
      });
    }
    await tx.vehicle.update({ where: { id: v.id }, data: { viewsCount: total } });
  }
  await tx.vehicleView.createMany({ data: views });

  // Favoritos: alimentam o contador de cada veículo e o painel do cliente.
  const favoritos = new Set<string>();
  for (const [i, v] of ctx.veiculos.entries()) {
    if (RASCUNHOS[i]) continue;
    const quantos = rng.int(0, 3);
    let n = 0;
    for (const clienteId of clientesIds) {
      if (n >= quantos) break;
      if (rng.next() > 0.65) {
        favoritos.add(`${clienteId}|${v.id}`);
        n++;
      }
    }
    if (n > 0) await tx.vehicle.update({ where: { id: v.id }, data: { favoritesCount: n } });
  }
  await tx.customerFavorite.createMany({
    data: [...favoritos].map((k) => {
      const [userId, vehicleId] = k.split('|');
      return { userId, vehicleId, createdAt: diasAtras(rng.int(1, 40), 20) };
    }),
    skipDuplicates: true,
  });

  return { views: views.length, favoritos: favoritos.size };
}

/* ════════════════════════════════════════════════════════════════════════
   main
   ════════════════════════════════════════════════════════════════════════ */

async function main() {
  const apagarSomente = process.env.DEMO_APAGAR === '1';
  const recriar = process.env.DEMO_RESET === '1';

  if (apagarSomente) {
    const existia = await apagar();
    console.log(existia ? '🗑  Loja de demonstração apagada.' : '⏭  Não havia loja de demonstração.');
    return;
  }

  const existente = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (existente && !recriar) {
    console.log(
      `⏭  A loja "${SLUG}" já existe — nada a fazer.\n` +
        '   DEMO_RESET=1 refaz tudo com as datas de hoje; DEMO_APAGAR=1 só apaga.',
    );
    return;
  }
  if (existente) {
    await apagar();
    console.log('♻️   Loja de demonstração anterior apagada.');
  }

  console.log(`🌱  Montando "${LOJA.tradeName}" (/c/${SLUG})…`);

  const modelos = await garantirCatalogo();
  const senhaEquipe = await bcrypt.hash(SENHA_DA_EQUIPE, 10);
  const senhaClientes = await bcrypt.hash(SENHA_DOS_CLIENTES, 10);

  // Uma transação só: ou a loja inteira existe, ou nenhuma parte dela. É o que
  // torna a marcação por slug confiável na próxima execução — metade da loja
  // seria pior que nenhuma.
  const resumo = await prisma.$transaction(
    async (tx) => {
      const { tenantId, branchId } = await criarLoja(tx);
      const ctx: Contexto = {
        tenantId, branchId,
        usuarios: {}, clientes: {}, veiculos: [], leads: {},
      };

      ctx.usuarios = await criarEquipe(tx, ctx, senhaEquipe);
      ctx.clientes = await criarClientes(tx, senhaClientes);
      ctx.veiculos = await criarEstoque(tx, ctx, modelos);
      ctx.leads = await criarLeads(tx, ctx);

      // O ponteiro do rodízio é quem recebeu o lead mais recente — o próximo a
      // chegar cai no seguinte do anel, que é o que a tela promete.
      const ultimo = VENDEDORES[(LEADS.length - 1) % VENDEDORES.length];
      await criarAjustesDeCrm(tx, ctx, ctx.usuarios[ultimo]);
      await criarMetas(tx, ctx);

      await criarAgenda(tx, ctx);
      const negocios = await criarNegocios(tx, ctx);
      await criarConversas(tx, ctx);
      const engajamento = await criarEngajamento(tx, ctx);

      return { ...negocios, ...engajamento, tenantId };
    },
    { maxWait: 20_000, timeout: 300_000 },
  );

  console.log(
    `\n✅  Pronto.\n` +
      `   ${ESTOQUE.length} veículos (${Object.keys(RASCUNHOS).length} em rascunho), ` +
      `${LEADS.length} leads, ${AGENDA.length} agendamentos,\n` +
      `   ${NEGOCIOS.length} negócios (${resumo.faturados} faturados, ${resumo.contratos} com contrato), ` +
      `${CONVERSAS.length} conversas,\n` +
      `   ${resumo.views} visualizações e ${resumo.favoritos} favoritos.\n\n` +
      `   Loja pública: /c/${SLUG}\n` +
      // A página de catálogo é endereçada pelo id do tenant, que muda a cada
      // execução — daí ela sair impressa aqui, e não no roteiro.
      `   Catálogo:     /catalogo/${resumo.tenantId}\n` +
      `   Entrar como dono:      ${EQUIPE[0].email} / ${SENHA_DA_EQUIPE}\n` +
      `   Entrar como vendedora: ${EQUIPE[2].email} / ${SENHA_DA_EQUIPE}\n` +
      `   Roteiro: docs/produto/demonstracao.md\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
