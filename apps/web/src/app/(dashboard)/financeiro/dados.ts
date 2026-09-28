import { api } from '@/lib/api';

/**
 * Os tipos que a tela do financeiro consome, espelhando o que
 * `financeiro.service.ts` devolve.
 *
 * **Dinheiro é `string` em todos eles.** Não é descuido de tipagem: é o
 * `Decimal(14,2)` do banco atravessando a fronteira sem passar por `number`.
 * Quem formata é `formatarBRL`; quem soma no navegador soma em centavos.
 */

export interface ContaFinanceira {
  id: string;
  kind: 'caixa' | 'banco' | 'adquirente' | 'outro';
  name: string;
  bankName: string | null;
  openingBalance: string;
  active: boolean;
  /** Derivado: saldo inicial + entradas pagas − saídas pagas. */
  saldo?: string;
}

export interface CategoriaFinanceira {
  id: string;
  direction: 'entrada' | 'saida';
  group: 'veiculos' | 'operacao' | 'pessoal' | 'impostos' | 'financeiro' | 'outros';
  name: string;
  active: boolean;
}

export interface Lancamento {
  id: string;
  direction: 'entrada' | 'saida';
  status: 'previsto' | 'pago' | 'cancelado';
  value: string;
  dueDate: string;
  paidAt: string | null;
  description: string;
  supplierName: string | null;
  documentNumber: string | null;
  notes: string | null;
  categoria: { id: string; name: string; group: string; direction: string } | null;
  conta: { id: string; name: string } | null;
  filial: { id: string; name: string } | null;
  /** Preenchido quando o lançamento nasceu de um negócio ou veículo. */
  origem: { dealId: string | null; vehicleId: string | null; dealPaymentId: string | null } | null;
  recurrenceId: string | null;
  cancelReason: string | null;
  atrasado: boolean;
}

export interface PaginaDeLancamentos {
  itens: Lancamento[];
  total: number;
  page: number;
  perPage: number;
  /** Soma do filtro inteiro, não da página — é o número do topo da tela. */
  somaEntradas: string;
  somaSaidas: string;
}

export interface ResumoFinanceiro {
  saldoTotal: string;
  contas: { contaId: string; nome: string; kind: string; saldo: string }[];
  proximos7Dias: { aReceber: string; aPagar: string; quantidade: number };
  atrasado: { aReceber: string; aPagar: string; quantidade: number };
  mesCorrente: { recebido: string; pago: string; resultado: string };
  temCategorias: boolean;
}

/**
 * Os caminhos vão **literais** em cada chamada, sem `const base`.
 *
 * Não é repetição por descuido: `corpos-do-web.spec.ts` lê estes arquivos com o
 * compilador do TypeScript para cruzar cada escrita do `apps/web` com o schema
 * Zod da rota, e um caminho montado a partir de variável chega nele como
 * `:p/contas`. O teto contra "o Zod descartou e a tela comemorou" vale mais que
 * a economia de uma constante.
 */

export const buscarResumo = (token: string) =>
  api<ResumoFinanceiro>(`/financeiro/resumo`, { token });

export const buscarContas = (token: string) =>
  api<ContaFinanceira[]>(`/financeiro/contas`, { token });

export const buscarCategorias = (token: string) =>
  api<CategoriaFinanceira[]>(`/financeiro/categorias`, { token });

export const buscarLancamentos = (token: string, query: string) =>
  api<PaginaDeLancamentos>(`/financeiro/lancamentos?${query}`, { token });

export const semearCategorias = (token: string) =>
  api<{ criadas: number }>(`/financeiro/categorias/padrao`, { method: 'POST', token, body: {} });

export const criarConta = (token: string, body: unknown) =>
  api<ContaFinanceira>(`/financeiro/contas`, { method: 'POST', token, body });

export const criarLancamento = (token: string, body: unknown) =>
  api<{ criados: number; recurrenceId: string | null; lancamentos: Lancamento[] }>(
    `/financeiro/lancamentos`, { method: 'POST', token, body },
  );

export const darBaixa = (token: string, id: string, body: unknown) =>
  api<Lancamento>(`/financeiro/lancamentos/${id}/baixa`, { method: 'POST', token, body });

export const cancelarLancamento = (token: string, id: string, motivo: string) =>
  api<Lancamento>(`/financeiro/lancamentos/${id}/cancelar`, { method: 'POST', token, body: { motivo } });

/*
 * Fechar e reabrir mês **não** têm helper aqui ainda, e é de propósito: a API
 * tem as rotas desde a Fase 1 e a tela chega na Fase 4. Um helper exportado que
 * ninguém chama é código morto que o `noUnusedLocals` não pega — e fez
 * `corpos-do-web.spec.ts` acusar chamada sem tela, que é exatamente a armadilha
 * nº 1 do CLAUDE.md pelo avesso.
 */
