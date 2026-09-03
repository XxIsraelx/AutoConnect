'use client';

import { useEffect, useState } from 'react';
import {
  Building2, Phone, Globe, Palette, MapPin,
  Mail, Hash, Check, Loader2, AlertCircle, Save, Clock, Repeat,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import {
  type BusinessHours, defaultBusinessHours, hasBusinessHours, WEEKDAYS_LONG,
} from '@/lib/businessHours';

/* ── Tipos ───────────────────────────────────────────────── */

interface Branch {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  addressNumber: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  businessHours?: unknown;
}

interface TenantFull {
  id: string;
  tradeName: string;
  legalName: string;
  slug: string;
  primaryEmail: string;
  primaryPhone: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  websiteUrl: string | null;
  legalRepName: string | null;
  legalRepCpf: string | null;
  legalRepRole: string | null;
  acceptsTradeIn: boolean;
  branches: Branch[];
  subscription: { plan: string; status: string } | null;
}

/* ── Helpers ─────────────────────────────────────────────── */

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

const input = `w-full rounded-xl border border-slate-200 dark:border-slate-700
               bg-white dark:bg-slate-800 px-3 py-2.5 text-sm
               outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500
               transition-all placeholder-slate-400 dark:placeholder-slate-500`;

/* ── Seção wrapper ───────────────────────────────────────── */

function Section({ title, icon: Icon, children }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border
                        border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="flex items-center gap-2.5 px-6 py-4 border-b
                      border-slate-100 dark:border-slate-800">
        <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-500/10
                        flex items-center justify-center">
          <Icon size={14} className="text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{title}</h2>
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </section>
  );
}

/* ── Toast ───────────────────────────────────────────────── */

function Toast({ type, msg }: { type: 'ok' | 'err'; msg: string }) {
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                     flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-xl
                     text-sm font-semibold animate-in slide-in-from-bottom duration-300
                     ${type === 'ok'
                       ? 'bg-emerald-600 text-white'
                       : 'bg-rose-600 text-white'}`}>
      {type === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />}
      {msg}
    </div>
  );
}

/* ── Editor de horário de funcionamento ──────────────────── */

function BusinessHoursEditor({
  value, onChange,
}: { value: BusinessHours; onChange: (bh: BusinessHours) => void }) {
  const setDay = (d: number, patch: Partial<BusinessHours[string]>) => {
    onChange({ ...value, [d]: { ...value[d], ...patch } });
  };

  const copyToWeekdays = (d: number) => {
    const src = value[d];
    const next = { ...value };
    for (let i = 1; i <= 5; i++) next[i] = { ...src };
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      {WEEKDAYS_LONG.map((label, d) => {
        const day = value[d] ?? { closed: true, open: '09:00', close: '18:00' };
        return (
          <div key={d}
               className="flex items-center gap-3 py-1.5 px-3 rounded-xl
                          hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
            <span className="w-20 text-sm font-medium text-slate-700 dark:text-slate-300 shrink-0">
              {label}
            </span>

            {/* Toggle aberto/fechado */}
            <button
              type="button"
              onClick={() => setDay(d, { closed: !day.closed })}
              className={`relative w-10 h-5.5 rounded-full transition-colors shrink-0
                ${day.closed ? 'bg-slate-300 dark:bg-slate-700' : 'bg-emerald-500'}`}
              style={{ height: 22 }}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all
                ${day.closed ? 'left-0.5' : 'left-[22px]'}`} />
            </button>

            {day.closed ? (
              <span className="text-sm text-slate-400 italic">Fechado</span>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="time" value={day.open}
                  onChange={e => setDay(d, { open: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700
                             bg-white dark:bg-slate-800 px-2 py-1 text-sm outline-none
                             focus:border-blue-500"
                />
                <span className="text-slate-400 text-xs">às</span>
                <input
                  type="time" value={day.close}
                  onChange={e => setDay(d, { close: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700
                             bg-white dark:bg-slate-800 px-2 py-1 text-sm outline-none
                             focus:border-blue-500"
                />
              </div>
            )}

            {/* Replicar seg–sex (só na segunda) */}
            {d === 1 && !day.closed && (
              <button
                type="button"
                onClick={() => copyToWeekdays(d)}
                className="ml-auto text-xs font-medium text-blue-600 dark:text-blue-400
                           hover:underline shrink-0"
              >
                Aplicar a seg–sex
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Página ───────────────────────────────────────────────── */

export default function ConfiguracoesPage() {
  const token = useAuthStore(s => s.token);

  const [tenant, setTenant]   = useState<TenantFull | null>(null);
  const [loading, setLoading] = useState(true);

  /* Forms separados para cada seção */
  const [tenantForm, setTenantForm] = useState({
    tradeName: '', primaryPhone: '', brandColor: '', websiteUrl: '', logoUrl: '',
    legalRepName: '', legalRepCpf: '', legalRepRole: '',
    acceptsTradeIn: false,
  });
  const [branchForm, setBranchForm] = useState({
    name: '', phone: '', email: '',
    addressLine: '', addressNumber: '', complement: '',
    neighborhood: '', city: '', state: '', postalCode: '',
  });
  const [hours, setHours] = useState<BusinessHours>(defaultBusinessHours());

  const [savingTenant, setSavingTenant] = useState(false);
  const [savingBranch, setSavingBranch] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  function showToast(type: 'ok' | 'err', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }

  /* Carrega dados */
  useEffect(() => {
    if (!token) return;
    api<{ tenant: TenantFull }>('/tenant/me', { token })
      .then(({ tenant: t }) => {
        setTenant(t);
        setTenantForm({
          tradeName:    t.tradeName    ?? '',
          primaryPhone: t.primaryPhone ?? '',
          brandColor:   t.brandColor   ?? '#3b82f6',
          websiteUrl:   t.websiteUrl   ?? '',
          legalRepName: t.legalRepName ?? '',
          legalRepCpf:  t.legalRepCpf  ?? '',
          legalRepRole: t.legalRepRole ?? '',
          logoUrl:      t.logoUrl      ?? '',
          acceptsTradeIn: t.acceptsTradeIn ?? false,
        });
        const b = t.branches[0];
        if (b) {
          setBranchForm({
            name:         b.name          ?? '',
            phone:        b.phone         ?? '',
            email:        b.email         ?? '',
            addressLine:  b.addressLine   ?? '',
            addressNumber:b.addressNumber ?? '',
            complement:   b.complement    ?? '',
            neighborhood: b.neighborhood  ?? '',
            city:         b.city          ?? '',
            state:        b.state         ?? '',
            postalCode:   b.postalCode    ?? '',
          });
          setHours(hasBusinessHours(b.businessHours) ? b.businessHours : defaultBusinessHours());
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  async function saveTenant(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSavingTenant(true);
    try {
      const updated = await api<TenantFull>('/tenant/me', {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          tradeName:    tenantForm.tradeName    || undefined,
          primaryPhone: tenantForm.primaryPhone || undefined,
          brandColor:   tenantForm.brandColor   || undefined,
          websiteUrl:   tenantForm.websiteUrl   || undefined,
          logoUrl:      tenantForm.logoUrl      || undefined,
          acceptsTradeIn: tenantForm.acceptsTradeIn,
          legalRepName: tenantForm.legalRepName || undefined,
          legalRepCpf:  tenantForm.legalRepCpf  || undefined,
          legalRepRole: tenantForm.legalRepRole || undefined,
        }),
      });
      setTenant(updated);
      showToast('ok', 'Dados da concessionária salvos!');
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSavingTenant(false);
    }
  }

  async function saveBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !tenant?.branches[0]) return;
    setSavingBranch(true);
    try {
      await api(`/tenant/branch/${tenant.branches[0].id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          name:          branchForm.name          || undefined,
          phone:         branchForm.phone         || undefined,
          email:         branchForm.email         || undefined,
          addressLine:   branchForm.addressLine   || undefined,
          addressNumber: branchForm.addressNumber || undefined,
          complement:    branchForm.complement    || undefined,
          neighborhood:  branchForm.neighborhood  || undefined,
          city:          branchForm.city          || undefined,
          state:         branchForm.state         || undefined,
          postalCode:    branchForm.postalCode    || undefined,
          businessHours: hours,
        }),
      });
      showToast('ok', 'Endereço salvo!');
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSavingBranch(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  const setT = (k: string, v: string | boolean) => setTenantForm(f => ({ ...f, [k]: v }));
  const setB = (k: string, v: string) => setBranchForm(f => ({ ...f, [k]: v }));

  return (
    <div className="p-8 max-w-3xl">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Configurações</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Gerencie os dados da sua concessionária
        </p>
      </div>

      <div className="space-y-6">

        {/* ── Identidade da concessionária ─────────────── */}
        <form onSubmit={saveTenant}>
          <Section title="Identidade da concessionária" icon={Building2}>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Nome fantasia">
                <input className={input} value={tenantForm.tradeName}
                       onChange={e => setT('tradeName', e.target.value)}
                       placeholder="Ex: AutoPrime Veículos" />
              </Field>
              <Field label="Telefone principal">
                <div className="relative">
                  <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className={`${input} pl-9`} value={tenantForm.primaryPhone}
                         onChange={e => setT('primaryPhone', e.target.value)}
                         placeholder="(11) 99999-9999" />
                </div>
              </Field>
            </div>

            {/* Representante legal — quem assina os contratos pela loja. Sem
                ele a emissão do contrato é recusada, porque o documento não
                diria quem se obrigou. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Representante legal" hint="quem assina os contratos pela loja">
                <input className={input} value={tenantForm.legalRepName}
                       onChange={e => setT('legalRepName', e.target.value)}
                       placeholder="Nome completo" />
              </Field>
              <Field label="CPF do representante">
                <input className={input} value={tenantForm.legalRepCpf}
                       onChange={e => setT('legalRepCpf', e.target.value)}
                       inputMode="numeric" placeholder="000.000.000-00" />
              </Field>
              <Field label="Cargo">
                <input className={input} value={tenantForm.legalRepRole}
                       onChange={e => setT('legalRepRole', e.target.value)}
                       placeholder="sócio-administrador" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Site" hint="URL completa com https://">
                <div className="relative">
                  <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className={`${input} pl-9`} value={tenantForm.websiteUrl}
                         onChange={e => setT('websiteUrl', e.target.value)}
                         placeholder="https://autoprime.com.br" />
                </div>
              </Field>
              <Field label="URL do logo" hint="Link público de uma imagem">
                <input className={input} value={tenantForm.logoUrl}
                       onChange={e => setT('logoUrl', e.target.value)}
                       placeholder="https://..." />
              </Field>
            </div>

            <Field label="Cor da marca" hint="Usada no catálogo público">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={tenantForm.brandColor || '#3b82f6'}
                  onChange={e => setT('brandColor', e.target.value)}
                  className="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700
                             cursor-pointer p-0.5 bg-white dark:bg-slate-800"
                />
                <div className="relative flex-1">
                  <Palette size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className={`${input} pl-9 font-mono`}
                         value={tenantForm.brandColor}
                         onChange={e => setT('brandColor', e.target.value)}
                         placeholder="#3b82f6" />
                </div>
              </div>
            </Field>

            {/* Aceita troca */}
            <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
                  <Repeat size={16} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Aceitar veículo na troca</p>
                  <p className="text-xs text-slate-500 mt-0.5 max-w-sm">
                    Quando ativo, clientes podem oferecer o próprio carro para abater do valor da compra. As propostas chegam como leads de troca.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={tenantForm.acceptsTradeIn}
                onClick={() => setT('acceptsTradeIn', !tenantForm.acceptsTradeIn)}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 mt-0.5
                  ${tenantForm.acceptsTradeIn ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform
                  ${tenantForm.acceptsTradeIn ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            {/* Info somente leitura */}
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Field label="Razão social">
                <div className="flex items-center gap-2 rounded-xl border border-slate-100
                                dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5">
                  <Building2 size={13} className="text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-500 truncate">{tenant?.legalName}</span>
                </div>
              </Field>
              <Field label="Slug (URL)">
                <div className="flex items-center gap-2 rounded-xl border border-slate-100
                                dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5">
                  <Hash size={13} className="text-slate-400 shrink-0" />
                  <span className="text-sm font-mono text-slate-500 truncate">{tenant?.slug}</span>
                </div>
              </Field>
            </div>

            <div className="flex justify-end pt-2">
              <button type="submit" disabled={savingTenant}
                      className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white
                                 text-sm font-semibold rounded-xl hover:bg-blue-500
                                 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                                 shadow-sm shadow-blue-600/25">
                {savingTenant
                  ? <><Loader2 size={14} className="animate-spin" /> Salvando…</>
                  : <><Save size={14} /> Salvar</>}
              </button>
            </div>
          </Section>
        </form>

        {/* ── Endereço da filial ────────────────────────── */}
        {tenant?.branches[0] && (
          <form onSubmit={saveBranch}>
            <Section title="Endereço e contato da filial" icon={MapPin}>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Nome da filial">
                  <input className={input} value={branchForm.name}
                         onChange={e => setB('name', e.target.value)}
                         placeholder="Loja Principal" />
                </Field>
                <Field label="Telefone da filial">
                  <div className="relative">
                    <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className={`${input} pl-9`} value={branchForm.phone}
                           onChange={e => setB('phone', e.target.value)}
                           placeholder="(11) 99999-9999" />
                  </div>
                </Field>
              </div>

              <Field label="E-mail da filial" hint="Usado para receber notificações de leads">
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="email" className={`${input} pl-9`} value={branchForm.email}
                         onChange={e => setB('email', e.target.value)}
                         placeholder="contato@autoprime.com.br" />
                </div>
              </Field>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <Field label="Logradouro">
                    <input className={input} value={branchForm.addressLine}
                           onChange={e => setB('addressLine', e.target.value)}
                           placeholder="Av. Paulista" />
                  </Field>
                </div>
                <Field label="Número">
                  <input className={input} value={branchForm.addressNumber}
                         onChange={e => setB('addressNumber', e.target.value)}
                         placeholder="1000" />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Complemento">
                  <input className={input} value={branchForm.complement}
                         onChange={e => setB('complement', e.target.value)}
                         placeholder="Sala 12" />
                </Field>
                <Field label="Bairro">
                  <input className={input} value={branchForm.neighborhood}
                         onChange={e => setB('neighborhood', e.target.value)}
                         placeholder="Bela Vista" />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-1">
                  <Field label="CEP">
                    <input className={input} value={branchForm.postalCode}
                           onChange={e => setB('postalCode', e.target.value)}
                           placeholder="01310-100" />
                  </Field>
                </div>
                <div className="col-span-1">
                  <Field label="Cidade">
                    <input className={input} value={branchForm.city}
                           onChange={e => setB('city', e.target.value)}
                           placeholder="São Paulo" />
                  </Field>
                </div>
                <div className="col-span-1">
                  <Field label="Estado (UF)">
                    <input className={input} value={branchForm.state}
                           onChange={e => setB('state', e.target.value.toUpperCase())}
                           maxLength={2}
                           placeholder="SP" />
                  </Field>
                </div>
              </div>

              {/* Horário de funcionamento */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 mb-3 mt-2">
                  <Clock size={14} className="text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    Horário de funcionamento
                  </span>
                  <span className="text-xs text-slate-400">
                    aparece para os clientes na busca
                  </span>
                </div>
                <BusinessHoursEditor value={hours} onChange={setHours} />
              </div>

              <div className="flex justify-end pt-2">
                <button type="submit" disabled={savingBranch}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white
                                   text-sm font-semibold rounded-xl hover:bg-blue-500
                                   transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                                   shadow-sm shadow-blue-600/25">
                  {savingBranch
                    ? <><Loader2 size={14} className="animate-spin" /> Salvando…</>
                    : <><Save size={14} /> Salvar filial</>}
                </button>
              </div>
            </Section>
          </form>
        )}

        {/* ── Plano ─────────────────────────────────────── */}
        <Section title="Plano" icon={Hash}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white capitalize">
                {tenant?.subscription?.plan ?? 'Trial'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5 capitalize">
                Status: {tenant?.subscription?.status ?? 'ativo'}
              </p>
            </div>
            <span className="text-xs font-bold px-3 py-1.5 rounded-full
                             bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400
                             border border-blue-100 dark:border-blue-500/20">
              {tenant?.subscription?.plan === 'pro' ? 'Pro' : 'Trial'}
            </span>
          </div>
        </Section>

      </div>

      {/* Toast */}
      {toast && <Toast type={toast.type} msg={toast.msg} />}
    </div>
  );
}
