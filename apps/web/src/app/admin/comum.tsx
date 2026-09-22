'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { cn } from '@/lib/utils';

/**
 * Peças compartilhadas pelas abas do painel do super admin.
 *
 * Cada aba carrega os próprios dados com `useCarga` e mostra o próprio
 * `ErroAoCarregar` — antes uma falha virava um toast de 3 segundos sobre uma
 * tela vazia, indistinguível de "não há nada".
 */

export type Chamar = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

/** Contexto que o `page.tsx` passa a cada aba. */
export interface PropsDaAba {
  chamar: Chamar;
  avisar: (msg: string, kind?: 'success' | 'error') => void;
  /** Muda quando o botão "atualizar" do cabeçalho é clicado. */
  sinal: number;
}

export function criarChamar(token: string): Chamar {
  return (path, init) => api(path, { token, ...(init ?? {}) });
}

/**
 * Carrega ao montar, de novo a cada `sinal` ou mudança de `chave` (o filtro
 * aplicado), e sob demanda. A resposta de uma carga antiga nunca sobrescreve a
 * mais nova.
 */
export function useCarga<T>(buscar: () => Promise<T>, sinal: number, chave = '') {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [carregando, setCarregando] = useState(true);
  const ultima = useRef(0);
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;

  const recarregar = useCallback(async () => {
    const minha = ++ultima.current;
    setCarregando(true);
    setErro(null);
    try {
      const r = await buscarRef.current();
      if (minha === ultima.current) setDados(r);
    } catch (e) {
      if (minha === ultima.current) setErro(e);
    } finally {
      if (minha === ultima.current) setCarregando(false);
    }
  }, []);

  useEffect(() => { void recarregar(); }, [recarregar, sinal, chave]);

  return { dados, setDados, erro, carregando, recarregar };
}

/** Mensagem de erro de uma ação (toast) — a da API quando houver. */
export function mensagemDaAcao(e: unknown, padrao: string): string {
  if (e instanceof ApiError) {
    return e.fieldErrors[0]?.message ?? (e.status >= 500 ? padrao : e.message);
  }
  return textoDoErro(e) || padrao;
}

/* ── Formatação ─────────────────────────────────────────────── */

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** "há 3 dias" — para última atividade, onde a data exata importa menos que a distância. */
export function fmtRelativo(iso: string | null | undefined) {
  if (!iso) return 'sem atividade';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return fmtDate(iso);
}

export const ROLE_LABEL: Record<string, string> = {
  tenant_admin: 'Admin', manager: 'Gerente', salesperson: 'Vendedor', customer: 'Cliente', super_admin: 'Super Admin',
};

export const PLAN_COLOR: Record<string, string> = {
  trial: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
  starter: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400',
  pro: 'bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400',
  enterprise: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
};

export const inputCls =
  'w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 ' +
  'px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition';

export const cartaoCls = 'bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800';

export const botaoPrimarioCls =
  'inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium ' +
  'rounded-xl hover:bg-blue-700 transition disabled:opacity-50';

export const botaoIconeCls =
  'p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-400';

/* ── Componentes ────────────────────────────────────────────── */

export function Toast({ msg, kind }: { msg: string; kind: 'success' | 'error' }) {
  return (
    <div
      role="status"
      className={cn(
        'fixed z-[2200] bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm',
        'flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white',
        kind === 'success' ? 'bg-emerald-600' : 'bg-rose-600',
      )}
    >
      {kind === 'success' ? <CheckCircle2 size={15} className="shrink-0" /> : <AlertCircle size={15} className="shrink-0" />}
      <span className="min-w-0 break-words">{msg}</span>
    </div>
  );
}

export function StatCard({ label, value, icon: Icon, accent, sub, destaque, dinheiro }: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  accent: string;
  sub?: React.ReactNode;
  /** Borda e fundo de alerta — para o que custa dinheiro à plataforma. */
  destaque?: boolean;
  /** Valor em reais: fonte menor, para "R$ 4.812.345,67" caber sem quebrar no meio. */
  dinheiro?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-2xl border p-4 sm:p-5 min-w-0',
      destaque
        ? 'bg-amber-50/60 dark:bg-amber-500/5 border-amber-300 dark:border-amber-500/40'
        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800',
    )}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accent}`}>
          <Icon size={17} />
        </div>
        <ArrowUpRight size={13} className="text-slate-300 dark:text-slate-600" />
      </div>
      <p className={cn(
        'font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-white break-words',
        dinheiro ? 'text-2xl' : 'text-2xl sm:text-3xl',
      )}>
        {value}
      </p>
      <p className="text-xs font-medium text-slate-500 mt-1">{label}</p>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export function Carregando() {
  return (
    <div className="py-16 flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-slate-400" />
    </div>
  );
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return <div className="py-16 text-center text-slate-400 text-sm">{children}</div>;
}

export function Secao({ titulo, children, extra }: { titulo: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{titulo}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}
