'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, ArrowLeft, Check, CreditCard, ExternalLink, Loader2,
  Lock, QrCode, ReceiptText, RefreshCw, ShieldCheck, TriangleAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import {
  formatarBRL, MEIOS_DE_PAGAMENTO, ROTULO_FATURA, ROTULO_MEIO,
  type MeioDePagamento, type PlanoPago, type SituacaoDeCobranca, type StatusDeFatura,
} from '@autoconnect/shared';

/* ── Tipos (o que a API devolve em GET /cobranca) ────────── */

interface PlanoDaApi {
  plano: PlanoPago;
  nome: string;
  resumo: string;
  precoMensal: string;
  limiteVeiculos: number | null;
}

interface Fatura {
  id: string;
  status: StatusDeFatura;
  valor: string;
  vencimento: string;
  pagoEm: string | null;
  meio: string | null;
  urlPagamento: string | null;
  descricao: string | null;
}

interface Resumo {
  disponivel: boolean;
  provedor: string | null;
  simulado: boolean;
  sandbox: boolean;
  planos: PlanoDaApi[];
  assinatura: {
    plano: string;
    status: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    graceUntil: string | null;
    canceledAt: string | null;
    meio: string | null;
    contratada: boolean;
  } | null;
  situacao: SituacaoDeCobranca;
  somenteLeitura: boolean;
  diasRestantes: number | null;
  prazoAte: string | null;
  aviso: string | null;
  uso: {
    usados: number;
    limite: number | null;
    noLimite: boolean;
    excedido: boolean;
    faixaSugerida: PlanoPago | null;
  };
  faturas: Fatura[];
}

const data = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const CORES_DA_SITUACAO: Record<SituacaoDeCobranca, string> = {
  trial: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/25 text-blue-800 dark:text-blue-200',
  trial_terminando: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200',
  ativa: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/25 text-emerald-800 dark:text-emerald-200',
  em_carencia: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200',
  somente_leitura: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200',
};

const ROTULO_SITUACAO: Record<SituacaoDeCobranca, string> = {
  trial: 'Período de teste',
  trial_terminando: 'Teste acabando',
  ativa: 'Assinatura ativa',
  em_carencia: 'Fatura vencida',
  somente_leitura: 'Somente leitura',
};

const CORES_DA_FATURA: Record<StatusDeFatura, string> = {
  paga: 'text-emerald-600 dark:text-emerald-400',
  pendente: 'text-amber-600 dark:text-amber-400',
  vencida: 'text-rose-600 dark:text-rose-400',
  estornada: 'text-slate-500',
  cancelada: 'text-slate-500',
};

function Section({ title, icon: Icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border
                        border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 sm:px-6 py-4 border-b
                      border-slate-100 dark:border-slate-800">
        <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-500/10
                        flex items-center justify-center shrink-0">
          <Icon size={14} className="text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{title}</h2>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

/**
 * Plano e cobrança da loja.
 *
 * Tela só de `tenant_admin` (a API recusa o resto com 403, e o
 * `ErroAoCarregar` explica a quem recorrer). É a única tela do painel que
 * **continua inteira** com a loja em somente leitura: é por aqui que se sai do
 * bloqueio, e todas as rotas de `/cobranca` são `@LiberadoNoBloqueio()`.
 */
export default function PlanoECobrancaPage() {
  // `?? undefined`: o store guarda `string | null`, e o helper `api()` aceita
  // `string | undefined`.
  const token = useAuthStore((s) => s.token) ?? undefined;

  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroDeCarga, setErroDeCarga] = useState<unknown>(null);

  const [escolhido, setEscolhido] = useState<PlanoPago | null>(null);
  const [meio, setMeio] = useState<MeioDePagamento>('indefinido');
  const [acao, setAcao] = useState<'contratar' | 'atualizar' | 'cancelar' | null>(null);
  const [erroDeAcao, setErroDeAcao] = useState('');
  const [ok, setOk] = useState('');

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErroDeCarga(null);
    try {
      const r = await api<Resumo>('/cobranca', { token });
      setResumo(r);
      setEscolhido((atual) => atual ?? r.uso.faixaSugerida ?? r.planos[0]?.plano ?? null);
    } catch (e) {
      setErroDeCarga(e);
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function executar(qual: 'contratar' | 'atualizar' | 'cancelar') {
    setAcao(qual);
    setErroDeAcao('');
    setOk('');
    try {
      if (qual === 'contratar') {
        if (!escolhido) return;
        await api('/cobranca/contratar', {
          token, method: 'POST', body: JSON.stringify({ plano: escolhido, meio }),
        });
        setOk('Plano contratado. Use o link abaixo para pagar por Pix, boleto ou cartão.');
      } else if (qual === 'atualizar') {
        await api('/cobranca/fatura/atualizar', { token, method: 'POST' });
        setOk('Link de pagamento atualizado.');
      } else {
        await api('/cobranca/cancelar', { token, method: 'POST' });
        setOk('Assinatura cancelada. Seus dados continuam todos aqui.');
      }
      await carregar();
    } catch (e) {
      setErroDeAcao(textoDoErro(e));
    } finally {
      setAcao(null);
    }
  }

  /** Só com o gateway simulado: encena o que o gateway mandaria. */
  async function simular(qual: 'pagar' | 'vencer' | 'estornar' | 'cancelar') {
    setErroDeAcao('');
    try {
      await api('/cobranca/simular', { token, method: 'POST', body: JSON.stringify({ acao: qual }) });
      await carregar();
    } catch (e) {
      setErroDeAcao(textoDoErro(e));
    }
  }

  if (carregando && !resumo) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-slate-400" size={22} />
      </div>
    );
  }

  // Formulário que edita dado existente não renderiza se a carga falhou: com
  // os valores padrão na tela, "Contratar" contrataria o plano errado.
  if (erroDeCarga || !resumo) {
    return (
      <ErroAoCarregar
        erro={erroDeCarga}
        onTentarNovamente={() => void carregar()}
        carregando={carregando}
        contexto="o plano e a cobrança"
      />
    );
  }

  const faturaEmAberto = resumo.faturas.find((f) => f.status === 'pendente' || f.status === 'vencida');
  const planoAtual = resumo.planos.find((p) => p.plano === resumo.assinatura?.plano);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <Link
          href="/configuracoes"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 transition"
        >
          <ArrowLeft size={13} /> Configurações
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-1">
          Plano e cobrança
        </h1>
      </div>

      {/* ── Situação ─────────────────────────────────────── */}
      <div className={`rounded-2xl border p-5 ${CORES_DA_SITUACAO[resumo.situacao]}`}>
        <div className="flex flex-wrap items-center gap-2">
          {resumo.somenteLeitura ? <Lock size={15} /> : <ShieldCheck size={15} />}
          <span className="text-sm font-bold">{ROTULO_SITUACAO[resumo.situacao]}</span>
          {planoAtual && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/60 dark:bg-black/25">
              {planoAtual.nome}
            </span>
          )}
        </div>
        <p className="text-sm mt-2">
          {resumo.aviso ??
            (resumo.assinatura?.currentPeriodEnd
              ? `Tudo em dia. Próxima cobrança em ${data(resumo.assinatura.currentPeriodEnd)}.`
              : 'Tudo em dia.')}
        </p>
        {resumo.prazoAte && (
          <p className="text-xs mt-1 opacity-80">Prazo: {data(resumo.prazoAte)}</p>
        )}
      </div>

      {/* ── Uso do estoque ───────────────────────────────── */}
      <Section title="Estoque da sua faixa" icon={ReceiptText}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-2xl font-bold text-slate-900 dark:text-white">{resumo.uso.usados}</span>
          <span className="text-sm text-slate-500">
            {resumo.uso.limite === null
              ? 'veículos em estoque — sua faixa não tem teto'
              : `de ${resumo.uso.limite} veículos da sua faixa`}
          </span>
        </div>
        {resumo.uso.limite !== null && (
          <div className="mt-3 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                resumo.uso.excedido ? 'bg-rose-500' : resumo.uso.noLimite ? 'bg-amber-500' : 'bg-blue-500'
              }`}
              style={{ width: `${Math.min(100, (resumo.uso.usados / resumo.uso.limite) * 100)}%` }}
            />
          </div>
        )}
        <p className="text-xs text-slate-500 mt-2.5">
          {resumo.uso.excedido ? (
            <>
              Seu estoque passou da faixa. Os anúncios <strong>que já estão no ar continuam no ar</strong>,
              mas publicar um novo pede o plano de cima. Veículos arquivados não contam.
            </>
          ) : (
            <>Conta todo veículo não arquivado, inclusive os que ainda estão em rascunho.</>
          )}
        </p>
      </Section>

      {/* ── Escolher plano ───────────────────────────────── */}
      {resumo.disponivel ? (
        <Section title={resumo.assinatura?.contratada ? 'Mudar de plano' : 'Escolher um plano'} icon={CreditCard}>
          <div className="grid gap-3 sm:grid-cols-3">
            {resumo.planos.map((p) => {
              const ativo = escolhido === p.plano;
              const eOAtual = resumo.assinatura?.plano === p.plano;
              return (
                <button
                  key={p.plano}
                  type="button"
                  onClick={() => setEscolhido(p.plano)}
                  className={`text-left rounded-xl border p-4 transition ${
                    ativo
                      ? 'border-blue-500 ring-2 ring-blue-500/25 bg-blue-50/50 dark:bg-blue-500/10'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-slate-900 dark:text-white">{p.nome}</span>
                    {eOAtual && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                        atual
                      </span>
                    )}
                  </div>
                  <p className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                    {formatarBRL(p.precoMensal)}
                    <span className="text-xs font-medium text-slate-500">/mês</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {p.limiteVeiculos === null ? 'Estoque ilimitado' : `Até ${p.limiteVeiculos} veículos`}
                  </p>
                  <p className="text-xs text-slate-400 mt-1.5">{p.resumo}</p>
                </button>
              );
            })}
          </div>

          <p className="text-xs text-slate-500 mt-4">Usuários ilimitados em todos os planos.</p>

          <div className="mt-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Forma de pagamento
            </label>
            <select
              value={meio}
              onChange={(e) => setMeio(e.target.value as MeioDePagamento)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700
                         bg-white dark:bg-slate-800 px-3 py-2.5 text-sm outline-none
                         focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
            >
              {MEIOS_DE_PAGAMENTO.map((m) => (
                <option key={m} value={m}>{ROTULO_MEIO[m]}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => void executar('contratar')}
            disabled={acao !== null || !escolhido}
            className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2
                       px-5 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white
                       hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {acao === 'contratar'
              ? <><Loader2 size={14} className="animate-spin" /> Contratando…</>
              : <><CreditCard size={14} /> {resumo.assinatura?.contratada ? 'Mudar para este plano' : 'Contratar'}</>}
          </button>
        </Section>
      ) : (
        <Section title="Contratação" icon={CreditCard}>
          <p className="text-sm text-slate-500">
            A contratação online ainda não está disponível nesta instalação. Fale com a equipe do
            AutoConnect para acertar o plano da sua loja.
          </p>
        </Section>
      )}

      {/* ── Pagar ────────────────────────────────────────── */}
      {faturaEmAberto && (
        <Section title="Fatura em aberto" icon={QrCode}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-slate-900 dark:text-white">
                {formatarBRL(faturaEmAberto.valor)}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Vence em {data(faturaEmAberto.vencimento)} · {ROTULO_FATURA[faturaEmAberto.status]}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {faturaEmAberto.urlPagamento && (
                <a
                  href={faturaEmAberto.urlPagamento}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm
                             font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
                >
                  <ExternalLink size={14} /> Pagar (Pix, boleto ou cartão)
                </a>
              )}
              <button
                onClick={() => void executar('atualizar')}
                disabled={acao !== null}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                           border border-slate-200 dark:border-slate-700 hover:bg-slate-50
                           dark:hover:bg-slate-800 disabled:opacity-50 transition"
              >
                <RefreshCw size={14} className={acao === 'atualizar' ? 'animate-spin' : undefined} />
                Atualizar link
              </button>
            </div>
          </div>
        </Section>
      )}

      {/* ── Histórico ────────────────────────────────────── */}
      <Section title="Histórico de faturas" icon={ReceiptText}>
        {resumo.faturas.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma fatura ainda.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 -my-2">
            {resumo.faturas.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {formatarBRL(f.valor)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Venc. {data(f.vencimento)}
                    {f.pagoEm ? ` · pago em ${data(f.pagoEm)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-semibold ${CORES_DA_FATURA[f.status]}`}>
                    {ROTULO_FATURA[f.status]}
                  </span>
                  {f.urlPagamento && (
                    <a
                      href={f.urlPagamento}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      abrir
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── Cancelar ─────────────────────────────────────── */}
      {resumo.assinatura?.contratada && resumo.assinatura.status !== 'canceled' && (
        <Section title="Cancelar assinatura" icon={TriangleAlert}>
          <p className="text-sm text-slate-500">
            O cancelamento interrompe as próximas cobranças. <strong>Nada é apagado</strong>: seus
            veículos, leads, negócios e contratos continuam aqui, e você segue vendo e exportando
            tudo — a loja passa a modo somente leitura.
          </p>
          <button
            onClick={() => void executar('cancelar')}
            disabled={acao !== null}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold
                       border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400
                       hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 transition"
          >
            {acao === 'cancelar'
              ? <><Loader2 size={14} className="animate-spin" /> Cancelando…</>
              : 'Cancelar assinatura'}
          </button>
        </Section>
      )}

      {/* ── Só em desenvolvimento, com o gateway simulado ─ */}
      {resumo.simulado && resumo.assinatura?.contratada && (
        <Section title="Gateway simulado (desenvolvimento)" icon={AlertCircle}>
          <p className="text-sm text-slate-500">
            Nenhuma cobrança sai deste servidor. Os botões abaixo encenam o webhook que a Asaas
            mandaria, pelo mesmo caminho da entrega real.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {(['pagar', 'vencer', 'estornar', 'cancelar'] as const).map((a) => (
              <button
                key={a}
                onClick={() => void simular(a)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border
                           border-slate-200 dark:border-slate-700 hover:bg-slate-50
                           dark:hover:bg-slate-800 transition capitalize"
              >
                {a}
              </button>
            ))}
          </div>
        </Section>
      )}

      {erroDeAcao && (
        <p className="flex items-start gap-2 text-sm text-rose-600 dark:text-rose-400">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {erroDeAcao}
        </p>
      )}
      {ok && (
        <p className="flex items-start gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <Check size={14} className="mt-0.5 shrink-0" /> {ok}
        </p>
      )}
    </div>
  );
}
