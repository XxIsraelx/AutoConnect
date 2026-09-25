import * as ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { z } from 'zod';
import {
  agendamentoDaLojaSchema,
  agendamentoDoClienteSchema,
  assignLeadSchema,
  atualizarAgendamentoSchema,
  createAcquisitionSchema,
  createDealPaymentSchema,
  createDealSchema,
  createLeadInteractionSchema,
  createLeadSchema,
  createVehicleCostSchema,
  createVehicleSchema,
  dadosDoCompradorSchema,
  inviteUserSchema,
  leadManualSchema,
  leadPublicoSchema,
  loginSchema,
  plantaoSchema,
  reenviarVerificacaoSchema,
  signupCustomerSchema,
  signupTenantSchema,
  transitionDealSchema,
  updateCrmSettingsSchema,
  updateDealSchema,
  updateLeadSchema,
  updateTenantSchema,
  updateBranchSchema,
  updateVehicleSchema,
} from '@autoconnect/shared';
import { acceptInviteSchema } from '../modules/invitations/invitations.controller';
import { anularSchema, assinarSchema } from '../modules/contracts/contracts.controller';
import { simularSchema } from '../modules/contracts/assinatura/assinatura-externa.controller';
import {
  contratarSchema, simularCobrancaSchema,
} from '../modules/cobranca/cobranca.controller';
import { consultarSchema } from '../modules/consultas/consultas.controller';
import { tradeInSchema } from '../modules/catalog/trade-in.schema';
import { importVehiclesSchema } from '../modules/vehicles/import.schema';

/**
 * # O corpo que a tela manda é o corpo que a API aceita
 *
 * `mass-assignment.e2e-spec.ts` prova que campo **proibido** não chega ao
 * banco. Nada provava o outro lado: que os campos que o `apps/web` de fato
 * envia são reconhecidos pelo schema da rota.
 *
 * Três se perderam assim de uma vez — `businessHours`, `primaryPhone` e
 * `acceptsTradeIn`. O Zod descartava em silêncio, o Prisma nunca via o campo, e
 * a tela mostrava "salvo!". O horário nunca salvo levou junto o relógio do SLA
 * (que passou a rodar no expediente padrão do shared) e um item do onboarding
 * que nunca ficava verde; a chave da troca desligou uma funcionalidade inteira,
 * com tabela, rota e tela prontas.
 *
 * Este teste lê o código do `apps/web`, acha toda chamada `api(...)` com método
 * de escrita, extrai as chaves do corpo e confere contra o schema da rota. É
 * estático de propósito: roda em milissegundos, não precisa de banco e não
 * depende de alguém lembrar de exercitar a tela.
 *
 * ## O que ele NÃO faz
 *
 * Não valida valores — só nomes de campo. Valor errado é o que o Zod já pega em
 * tempo de execução e o que os e2e cobrem; o que não tinha guarda nenhuma era o
 * campo **inexistente**.
 *
 * ## Quando ele quebrar
 *
 * - "rota não declarada": você acrescentou uma chamada de escrita nova. Declare
 *   a rota em `ROTAS` com o schema dela (ou com o motivo de não ter um).
 * - "campo que o schema não conhece": ou o schema esqueceu o campo (o defeito
 *   original), ou a tela manda algo que a API não grava. As duas coisas
 *   precisam de decisão — nenhuma pode ficar em silêncio.
 */

/* ── Onde a rota é validada ───────────────────────────────── */

type Declaracao =
  /** A rota valida o corpo com este schema Zod. */
  | { schema: z.ZodTypeAny }
  /** A rota não recebe corpo nenhum. */
  | { semCorpo: true }
  /**
   * A rota ainda valida o corpo só por **anotação de TypeScript** — a
   * armadilha nº 3 do CLAUDE.md, viva. Cada linha aqui é dívida declarada,
   * não permissão: a lista só deve encolher.
   */
  | { semSchema: string };

const ROTAS: Record<string, Declaracao> = {
  /* Autenticação */
  'POST /auth/login': { schema: loginSchema },
  'POST /auth/signup-tenant': { schema: signupTenantSchema },
  'POST /auth/signup-customer': { schema: signupCustomerSchema },
  'POST /auth/reset-password': { semSchema: 'corpo `{ token, password }` só anotado' },
  'POST /auth/forgot-password': { semSchema: 'corpo `{ email: string }` só anotado' },
  'POST /auth/resend-verification': { schema: reenviarVerificacaoSchema },

  /* Agendamentos */
  'POST /appointments': { schema: agendamentoDoClienteSchema },
  'POST /appointments/dealer': { schema: agendamentoDaLojaSchema },
  'PATCH /appointments/:p': { schema: atualizarAgendamentoSchema },
  'PATCH /appointments/:p/cancel': { semCorpo: true },

  /* Catálogo público */
  'POST /catalog/trade-in': { schema: tradeInSchema },
  'POST /catalog/favorites/:p': { semCorpo: true },
  'POST /catalog/views/:p': { semCorpo: true },
  'PATCH /catalog/saved-searches/:p/viewed': { semCorpo: true },
  'POST /catalog/saved-searches': { semSchema: 'corpo `{ name, filters }` só anotado' },
  'POST /catalog/price-alerts': { semSchema: 'corpo `{ vehicleId, targetPrice }` só anotado' },
  'POST /catalog/brands': {
    semSchema:
      'corpo `{ name }` só anotado, e a rota não tem @Roles — catálogo global de marcas (B15 do piloto do primeiro dia)',
  },
  'POST /catalog/brands/:p/models': {
    semSchema: 'mesmo caso de POST /catalog/brands — dado global, sem papel e sem Zod',
  },

  /* Leads */
  'POST /leads': { schema: createLeadSchema },
  'POST /leads/public': { schema: leadPublicoSchema },
  'POST /leads/manual': { schema: leadManualSchema },
  'PATCH /leads/:p': { schema: updateLeadSchema },
  'PATCH /leads/:p/assign': { schema: assignLeadSchema },
  'POST /leads/:p/interactions': { schema: createLeadInteractionSchema },
  'POST /leads/:p/trade-in/appraisal': {
    semSchema: 'corpo `{ value, note, status }` só anotado, em leads.controller.ts',
  },

  /* Negócios e contrato */
  'POST /deals': { schema: createDealSchema },
  'PATCH /deals/:p': { schema: updateDealSchema },
  'PUT /deals/:p/buyer': { schema: dadosDoCompradorSchema },
  'POST /deals/:p/payments': { schema: createDealPaymentSchema },
  'POST /deals/:p/transition': { schema: transitionDealSchema },
  'POST /deals/:p/contract': { semCorpo: true },
  'POST /contracts/:p/sign': { schema: assinarSchema },
  'POST /contracts/:p/void': { schema: anularSchema },
  'POST /contracts/:p/assinatura-externa': { semCorpo: true },
  'POST /contracts/:p/assinatura-externa/cancelar': { semCorpo: true },
  'POST /contracts/:p/assinatura-externa/simular': { schema: simularSchema },

  /* Plano e cobrança */
  'POST /cobranca/contratar': { schema: contratarSchema },
  'POST /cobranca/fatura/atualizar': { semCorpo: true },
  'POST /cobranca/cancelar': { semCorpo: true },
  'POST /cobranca/simular': { schema: simularCobrancaSchema },

  /* Veículos */
  'POST /vehicles': { schema: createVehicleSchema },
  'PATCH /vehicles/:p': { schema: updateVehicleSchema },
  'POST /vehicles/import': { schema: importVehiclesSchema },
  'POST /vehicles/:p/:p': { semCorpo: true },
  'PATCH /vehicles/:p/images/:p/cover': { semCorpo: true },
  'POST /vehicles/:p/images': {
    semSchema: 'corpo `{ url, isCover?, altText? }` só anotado, em vehicles.controller.ts',
  },
  'POST /vehicles/:p/acquisition': { schema: createAcquisitionSchema },
  'POST /vehicles/:p/costs': { schema: createVehicleCostSchema },
  'POST /vehicle-queries': { schema: consultarSchema },

  /* Equipe, convites e usuários */
  'POST /invitations': { schema: inviteUserSchema },
  'POST /invitations/:p/resend': { semCorpo: true },
  'POST /public/invitations/accept': { schema: acceptInviteSchema },
  'PATCH /team/members/:p/plantao': { schema: plantaoSchema },
  'POST /team/goals': { semSchema: 'corpo `{ userId, period, target }` só anotado' },
  'PATCH /team/members/:p/commission': { semSchema: 'corpo `{ commissionPct }` só anotado' },
  'PATCH /users/me': { semSchema: 'corpo do perfil só anotado, em users.controller.ts' },
  'POST /users/me/password': { semSchema: 'corpo `{ currentPassword, newPassword }` só anotado' },
  'PATCH /users/:p/role': { semSchema: 'corpo `{ role }` só anotado' },
  'PATCH /users/:p/status': { semSchema: 'corpo `{ status }` só anotado' },

  /* Loja */
  'PATCH /tenant/me': { schema: updateTenantSchema },
  'PATCH /tenant/branch/:p': { schema: updateBranchSchema },
  'PATCH /crm/settings': { schema: updateCrmSettingsSchema },

  /* Conversas */
  'POST /conversations': { semSchema: 'corpo `{ tenantId, vehicleId?, leadId? }` só anotado' },
  'POST /conversations/from-lead': { semSchema: 'corpo `{ leadId }` só anotado' },
  'PATCH /conversations/:p/close': { semCorpo: true },
};

/* ── Varredura do apps/web ────────────────────────────────── */

const WEB = join(__dirname, '..', '..', '..', 'web', 'src');

interface ChamadaDeEscrita {
  chave: string;
  arquivo: string;
  linha: number;
  /** `null` quando o corpo não é um objeto literal (veio de variável). */
  chaves: string[] | null;
  /** Há `...spread` no corpo: as chaves listadas são um subconjunto. */
  parcial: boolean;
}

function arquivosDoWeb(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosDoWeb(caminho, acc);
    else if (/\.tsx?$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

/** `/tenant/branch/${id}` → `/tenant/branch/:p`. */
function rotaDe(no: ts.Expression): string | null {
  if (ts.isStringLiteralLike(no)) return no.text;
  if (ts.isTemplateExpression(no)) {
    return no.templateSpans.reduce((s, span) => s + ':p' + span.literal.text, no.head.text);
  }
  return null;
}

/** Aceita tanto `body: { … }` quanto `body: JSON.stringify({ … })`. */
function objetoDoCorpo(no: ts.Expression): ts.ObjectLiteralExpression | null {
  if (ts.isObjectLiteralExpression(no)) return no;
  if (
    ts.isCallExpression(no) &&
    ts.isPropertyAccessExpression(no.expression) &&
    no.expression.name.text === 'stringify'
  ) {
    const arg = no.arguments[0];
    if (arg && ts.isObjectLiteralExpression(arg)) return arg;
  }
  return null;
}

function varrerWeb(): ChamadaDeEscrita[] {
  const achados: ChamadaDeEscrita[] = [];

  for (const arquivo of arquivosDoWeb(WEB)) {
    const fonte = ts.createSourceFile(
      arquivo,
      readFileSync(arquivo, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    const visitar = (no: ts.Node): void => {
      if (ts.isCallExpression(no) && ts.isIdentifier(no.expression) && no.expression.text === 'api') {
        const opcoes = no.arguments[1];
        if (opcoes && ts.isObjectLiteralExpression(opcoes)) {
          let metodo: string | null = null;
          let corpo: ts.Expression | null = null;
          let corpoIndireto = false;

          for (const p of opcoes.properties) {
            if (ts.isShorthandPropertyAssignment(p) && p.name.text === 'body') {
              corpoIndireto = true;
              continue;
            }
            if (!ts.isPropertyAssignment(p)) continue;
            const nome = p.name.getText().replace(/['"]/g, '');
            if (nome === 'method' && ts.isStringLiteralLike(p.initializer)) metodo = p.initializer.text;
            if (nome === 'body') corpo = p.initializer;
          }

          if (metodo && ['POST', 'PATCH', 'PUT'].includes(metodo)) {
            const rota = rotaDe(no.arguments[0]);
            const objeto = corpo ? objetoDoCorpo(corpo) : null;
            const indefinido = !corpo && !corpoIndireto;

            achados.push({
              chave: `${metodo} ${rota ?? '(rota dinâmica)'}`,
              arquivo: relative(WEB, arquivo),
              linha: fonte.getLineAndCharacterOfPosition(no.getStart()).line + 1,
              chaves: indefinido ? [] : objeto ? nomesDe(objeto) : null,
              parcial: objeto ? objeto.properties.some(ts.isSpreadAssignment) : false,
            });
          }
        }
      }
      ts.forEachChild(no, visitar);
    };

    visitar(fonte);
  }

  return achados;
}

function nomesDe(objeto: ts.ObjectLiteralExpression): string[] {
  return objeto.properties
    .filter((p): p is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p),
    )
    .map((p) => p.name.getText().replace(/['"]/g, ''));
}

/* ── Chaves que um schema Zod reconhece ───────────────────── */

/** `null` = o schema aceita qualquer chave (record). */
function chavesDoSchema(schema: z.ZodTypeAny, profundidade = 0): Set<string> | null {
  if (profundidade > 10) return null;
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const tipo = def?.typeName as string | undefined;

  switch (tipo) {
    case 'ZodObject':
      return new Set(Object.keys((schema as z.ZodObject<z.ZodRawShape>).shape));
    // `.refine`, `.superRefine` e `.transform` embrulham o objeto.
    case 'ZodEffects':
      return chavesDoSchema(def.schema as z.ZodTypeAny, profundidade + 1);
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
      return chavesDoSchema(def.innerType as z.ZodTypeAny, profundidade + 1);
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const opcoes = (def.options as z.ZodTypeAny[]) ?? [];
      const uniao = new Set<string>();
      for (const o of opcoes) {
        const k = chavesDoSchema(o, profundidade + 1);
        if (k === null) return null;
        k.forEach((n) => uniao.add(n));
      }
      return uniao;
    }
    case 'ZodIntersection': {
      const esq = chavesDoSchema(def.left as z.ZodTypeAny, profundidade + 1);
      const dir = chavesDoSchema(def.right as z.ZodTypeAny, profundidade + 1);
      if (esq === null || dir === null) return null;
      return new Set([...esq, ...dir]);
    }
    default:
      return null;
  }
}

/* ── Os casos ─────────────────────────────────────────────── */

const chamadas = varrerWeb();

describe('corpos que o apps/web envia', () => {
  it('a varredura acha as chamadas de escrita — senão o resto é vácuo', () => {
    expect(chamadas.length).toBeGreaterThan(50);
    // As duas rotas do defeito original têm que estar entre as achadas.
    expect(chamadas.map((c) => c.chave)).toEqual(
      expect.arrayContaining(['PATCH /tenant/me', 'PATCH /tenant/branch/:p']),
    );
    // Nenhuma rota montada por variável: se aparecer, a chave vira
    // "(rota dinâmica)" e o teste abaixo não teria como conferir nada.
    expect(chamadas.filter((c) => c.chave.includes('(rota dinâmica)'))).toEqual([]);
  });

  it('toda rota de escrita está declarada em ROTAS', () => {
    const naoDeclaradas = [
      ...new Set(
        chamadas
          .filter((c) => !(c.chave in ROTAS))
          .map((c) => `${c.chave}  (${c.arquivo}:${c.linha})`),
      ),
    ];

    expect(naoDeclaradas).toEqual([]);
  });

  it('todo campo enviado é reconhecido pelo schema da rota', () => {
    const desconhecidos: string[] = [];

    for (const c of chamadas) {
      const decl = ROTAS[c.chave];
      if (!decl || !('schema' in decl)) continue;
      if (c.chaves === null) continue; // corpo indireto: nada a conferir

      const aceitas = chavesDoSchema(decl.schema);
      if (aceitas === null) continue; // schema aceita qualquer chave

      for (const chave of c.chaves) {
        if (!aceitas.has(chave)) {
          desconhecidos.push(`${c.chave} → "${chave}" (${c.arquivo}:${c.linha})`);
        }
      }
    }

    expect(desconhecidos).toEqual([]);
  });

  it('rota declarada "sem corpo" não recebe corpo da tela', () => {
    const comCorpo = chamadas
      .filter((c) => {
        const decl = ROTAS[c.chave];
        return decl && 'semCorpo' in decl && (c.chaves === null || c.chaves.length > 0);
      })
      .map((c) => `${c.chave} (${c.arquivo}:${c.linha})`);

    expect(comCorpo).toEqual([]);
  });

  it('ROTAS não acumula entrada morta — rota declarada que ninguém chama', () => {
    const chamadasUnicas = new Set(chamadas.map((c) => c.chave));
    const mortas = Object.keys(ROTAS).filter((r) => !chamadasUnicas.has(r));

    expect(mortas).toEqual([]);
  });

  it('cada dívida declarada tem motivo escrito', () => {
    const semMotivo = Object.entries(ROTAS)
      .filter(([, d]) => 'semSchema' in d && d.semSchema.trim().length < 10)
      .map(([r]) => r);

    expect(semMotivo).toEqual([]);
  });

  it('o extrator de chaves enxerga schemas embrulhados em refine/superRefine', () => {
    // `leadPublicoSchema` é `z.object(...).refine(...)` e
    // `updateLeadSchema` é `z.object(...).superRefine(...)`: sem desembrulhar o
    // ZodEffects o teste principal passaria sem conferir nada.
    expect(chavesDoSchema(leadPublicoSchema)).toContain('consentText');
    expect(chavesDoSchema(updateLeadSchema)).toContain('vehicleId');
    expect(chavesDoSchema(updateBranchSchema)).toContain('businessHours');
  });
});
