'use client';

import { useMemo, useState } from 'react';
import {
  Ban, CheckCircle2, ChevronRight, ExternalLink, X, Search, UserCheck, UserX, MailWarning, Loader2,
} from 'lucide-react';
import { SUBSCRIPTION_PLANS, deCentavos, formatarBRL } from '@autoconnect/shared';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import {
  Carregando, PLAN_COLOR, ROLE_LABEL, Vazio, botaoIconeCls, cartaoCls, fmtDate, fmtRelativo,
  inputCls, mensagemDaAcao, useCarga, type PropsDaAba,
} from './comum';
import { urlDoSite } from './AbaConvites';
import type { MetricasDaLoja, Tenant, TenantDetail } from './tipos';

const brlDeCentavos = (c: number) => formatarBRL(deCentavos(BigInt(c)));

/** Representante legal: sem nome o contrato não sai; sem e-mail a assinatura externa não sai. */
function SeloRepresentante({ rep }: { rep: { configured: boolean; hasEmail: boolean } }) {
  if (!rep.configured) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400">
        <UserX size={10} /> Sem representante
      </span>
    );
  }
  if (!rep.hasEmail) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <MailWarning size={10} /> Representante sem e-mail
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
      <UserCheck size={10} /> Representante ok
    </span>
  );
}

function LinhaDeMetricas({ m }: { m: MetricasDaLoja }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-500">
      <span>
        Faturado 30d: <b className="text-slate-700 dark:text-slate-200">{formatarBRL(m.gmv30d)}</b> ({m.invoicedDeals30d})
      </span>
      <span className={m.vehicleQuerySpendMonthCents > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>
        Consultas no mês: {brlDeCentavos(m.vehicleQuerySpendMonthCents)} ({m.vehicleQueriesMonth})
      </span>
      <span>Atividade: {fmtRelativo(m.lastActivityAt)}</span>
    </div>
  );
}

export function AbaConcessionarias({ chamar, avisar, sinal }: PropsDaAba) {
  const { dados, setDados, erro, carregando, recarregar } =
    useCarga(() => chamar<Tenant[]>('/admin/tenants'), sinal);
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<TenantDetail | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q || !dados) return dados;
    return dados.filter((t) =>
      [t.tradeName, t.legalName, t.taxId ?? '', t.primaryEmail, t.slug].some((v) => v.toLowerCase().includes(q)));
  }, [busca, dados]);

  async function abrir(id: string) {
    setAbrindo(id);
    try {
      setAberta(await chamar<TenantDetail>(`/admin/tenants/${id}`));
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao carregar detalhes'), 'error');
    } finally {
      setAbrindo(null);
    }
  }

  async function mudarPlano(tenantId: string, plan: string) {
    try {
      const sub = await chamar<{ plan: string; status: string }>(`/admin/tenants/${tenantId}/plan`, { method: 'PATCH', body: { plan } });
      const aplicar = <T extends { id: string; subscription: Tenant['subscription'] }>(t: T): T =>
        t.id === tenantId ? { ...t, subscription: { ...(t.subscription ?? {}), plan: sub.plan, status: sub.status } } : t;
      setAberta((t) => (t ? aplicar(t) : t));
      setDados((p) => (p ?? []).map(aplicar));
      avisar(`Plano alterado para ${plan}`);
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao alterar plano'), 'error');
    }
  }

  async function estenderTrial(tenantId: string, days: number) {
    try {
      const sub = await chamar<{ trialEndsAt: string | null }>(`/admin/tenants/${tenantId}/extend-trial`, { method: 'PATCH', body: { days } });
      setAberta((t) => (t && t.id === tenantId && t.subscription ? { ...t, subscription: { ...t.subscription, trialEndsAt: sub.trialEndsAt } } : t));
      avisar(`Trial estendido por +${days} dias`);
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao estender trial'), 'error');
    }
  }

  async function impersonar(tenantId: string) {
    try {
      const data = await chamar<{ token: string; user: unknown }>(`/admin/impersonate/${tenantId}`, { method: 'POST' });
      const url = `${urlDoSite()}/impersonate?token=${data.token}&user=${encodeURIComponent(JSON.stringify(data.user))}`;
      window.open(url, '_blank');
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao impersonar'), 'error');
    }
  }

  async function alternarAtiva(id: string) {
    try {
      const atualizada = await chamar<{ isActive: boolean }>(`/admin/tenants/${id}/toggle`, { method: 'PATCH' });
      setDados((p) => (p ?? []).map((t) => t.id === id ? { ...t, isActive: atualizada.isActive } : t));
      avisar(atualizada.isActive ? 'Concessionária ativada' : 'Concessionária desativada');
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao alterar a concessionária'), 'error');
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Filtrar por nome, CNPJ, e-mail ou slug…"
          className={`${inputCls} pl-9`}
        />
      </div>

      <div className={`${cartaoCls} overflow-hidden`}>
        {erro ? (
          <ErroAoCarregar erro={erro} onTentarNovamente={recarregar} carregando={carregando} contexto="as concessionárias" />
        ) : !filtradas ? (
          <Carregando />
        ) : filtradas.length === 0 ? (
          <Vazio>{busca ? 'Nenhuma concessionária encontrada' : 'Nenhuma concessionária'}</Vazio>
        ) : filtradas.map((t, i) => (
          <div key={t.id} className={`flex items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition ${i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : ''}`}>
            <div className="hidden sm:flex w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/10 items-center justify-center shrink-0">
              <span className="text-blue-600 font-bold text-sm">{t.tradeName.charAt(0)}</span>
            </div>
            <button onClick={() => abrir(t.id)} className="flex-1 min-w-0 text-left">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="font-medium text-sm truncate max-w-full">{t.tradeName}</p>
                {!t.isActive && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">Inativa</span>}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize ${PLAN_COLOR[t.subscription?.plan ?? 'trial'] ?? PLAN_COLOR.trial}`}>{t.subscription?.plan ?? 'trial'}</span>
                <SeloRepresentante rep={t.legalRep} />
              </div>
              <div className="flex flex-wrap gap-x-3 mt-0.5 text-xs text-slate-400">
                {t.taxId && <span>{t.taxId}</span>}
                {t.branches[0]?.city && <span>{t.branches[0].city}/{t.branches[0].state}</span>}
                <span>Desde {fmtDate(t.createdAt)}</span>
              </div>
              <LinhaDeMetricas m={t.metrics} />
            </button>
            <div className="flex gap-0.5 shrink-0">
              <button onClick={() => abrir(t.id)} title="Ver detalhes" aria-label="Ver detalhes" className={`${botaoIconeCls} hover:text-blue-600`}>
                {abrindo === t.id ? <Loader2 size={15} className="animate-spin" /> : <ChevronRight size={15} />}
              </button>
              <button onClick={() => alternarAtiva(t.id)} title={t.isActive ? 'Desativar' : 'Ativar'} aria-label={t.isActive ? 'Desativar' : 'Ativar'}
                className={`p-2 rounded-lg transition text-slate-400 ${t.isActive ? 'hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-500' : 'hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-500'}`}>
                {t.isActive ? <Ban size={15} /> : <CheckCircle2 size={15} />}
              </button>
            </div>
          </div>
        ))}
      </div>

      {aberta && (
        <GavetaDaLoja
          loja={aberta}
          onFechar={() => setAberta(null)}
          onPlano={(p) => mudarPlano(aberta.id, p)}
          onTrial={(d) => estenderTrial(aberta.id, d)}
          onImpersonar={() => impersonar(aberta.id)}
        />
      )}
    </div>
  );
}

function GavetaDaLoja({ loja, onFechar, onPlano, onTrial, onImpersonar }: {
  loja: TenantDetail;
  onFechar: () => void;
  onPlano: (plan: string) => void;
  onTrial: (days: number) => void;
  onImpersonar: () => void;
}) {
  const m = loja.metrics;
  return (
    <>
      {/* !mt-0: a gaveta é filha do `space-y-4` da aba, que lhe daria margem no topo. */}
      <div onClick={onFechar} className="fixed inset-0 !mt-0 z-[2000] bg-black/40 backdrop-blur-sm" aria-hidden />
      <aside
        role="dialog" aria-modal="true" aria-label={loja.tradeName}
        className="fixed top-0 right-0 !mt-0 z-[2001] h-full w-full max-w-lg bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
      >
        <div className="shrink-0 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-lg truncate">{loja.tradeName}</h3>
            <p className="text-xs text-slate-500 truncate">{loja.legalName}</p>
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="p-2 -mr-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: 'Veículos', value: loja.vehicleCount, color: 'text-blue-600' },
              { label: 'Leads', value: loja.leadCount, color: 'text-emerald-600' },
              { label: 'Leads novos', value: loja.leadNewCount, color: 'text-amber-600' },
            ].map((s) => (
              <div key={s.label} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 text-center min-w-0">
                <p className={`text-xl sm:text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Vendas e custo</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 min-w-0">
                <p className="text-xs text-slate-400">Faturado — 30 dias</p>
                <p className="text-lg font-bold break-words">{formatarBRL(m.gmv30d)}</p>
                <p className="text-[11px] text-slate-400">{m.invoicedDeals30d} negócio(s)</p>
              </div>
              <div className="rounded-xl bg-amber-50/70 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/30 p-3 min-w-0">
                <p className="text-xs text-amber-700 dark:text-amber-400">Consulta veicular — mês</p>
                <p className="text-lg font-bold break-words">{brlDeCentavos(m.vehicleQuerySpendMonthCents)}</p>
                <p className="text-[11px] text-slate-400">{m.vehicleQueriesMonth} consulta(s)</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">Última atividade da equipe: {fmtRelativo(m.lastActivityAt)}</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Representante legal</h4>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <SeloRepresentante rep={loja.legalRep} />
              {loja.legalRep.name && (
                <span className="text-slate-600 dark:text-slate-300 min-w-0 break-words">
                  {loja.legalRep.name}{loja.legalRep.role ? ` · ${loja.legalRep.role}` : ''}
                </span>
              )}
            </div>
            {!loja.legalRep.configured && (
              <p className="text-xs text-slate-400 mt-1.5">Sem representante a loja não emite contrato.</p>
            )}
            {loja.legalRep.configured && !loja.legalRep.hasEmail && (
              <p className="text-xs text-slate-400 mt-1.5">Sem e-mail a loja não envia contrato para assinatura eletrônica.</p>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Dados</h4>
            <dl className="space-y-2 text-sm">
              {[
                ['CNPJ', loja.taxId ?? '—'],
                ['IE', loja.stateRegistration ?? '—'],
                ['E-mail', loja.primaryEmail],
                ['Telefone', loja.primaryPhone ?? '—'],
                ['Cadastro', fmtDate(loja.createdAt)],
                ['Cidade', loja.branches[0]?.city ? `${loja.branches[0].city}/${loja.branches[0].state}` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-slate-400 shrink-0">{k}</dt>
                  <dd className="font-medium text-right min-w-0 break-all">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Plano</h4>
            <div className="flex gap-2 flex-wrap">
              {SUBSCRIPTION_PLANS.map((p) => (
                <button key={p} onClick={() => onPlano(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition capitalize ${
                    loja.subscription?.plan === p
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}>
                  {p}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <p className="text-xs text-slate-400 mb-2">
                Estender trial{loja.subscription?.trialEndsAt ? ` (hoje até ${fmtDate(loja.subscription.trialEndsAt)})` : ''} por:
              </p>
              <div className="flex gap-2 flex-wrap">
                {[7, 14, 30].map((d) => (
                  <button key={d} onClick={() => onTrial(d)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                    +{d} dias
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              Equipe ({loja.users.length})
            </h4>
            <div className="space-y-2">
              {loja.users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
                    <span className="text-blue-600 text-xs font-bold">{u.fullName.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.fullName}</p>
                    <p className="text-xs text-slate-400 truncate">{u.email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium">{ROLE_LABEL[u.role] ?? u.role}</p>
                    <p className={`text-[10px] ${u.status === 'suspended' ? 'text-rose-500 font-semibold' : 'text-slate-400'}`}>
                      {u.status === 'suspended' ? 'Suspenso' : u.lastLoginAt ? `Último: ${fmtDate(u.lastLoginAt)}` : 'Nunca entrou'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="shrink-0 p-4 sm:px-6 border-t border-slate-200 dark:border-slate-800">
          <button onClick={onImpersonar}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
            <ExternalLink size={14} /> Entrar como admin da loja
          </button>
        </div>
      </aside>
    </>
  );
}
