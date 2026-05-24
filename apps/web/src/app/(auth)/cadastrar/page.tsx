'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, ChevronLeft, Check } from 'lucide-react';
import { api } from '@/lib/api';

const steps = ['Acesso', 'Dados pessoais', 'Endereço'];

type Form = {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone: string;
  cpf: string;
  birthDate: string;
  postalCode: string;
  addressLine: string;
  addressNumber: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
};

function formatCpf(v: string) {
  return v
    .replace(/\D/g, '')
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function formatPhone(v: string) {
  return v
    .replace(/\D/g, '')
    .slice(0, 11)
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2');
}

function formatCep(v: string) {
  return v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d{1,3})$/, '$1-$2');
}

export default function CustomerSignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingCep, setLoadingCep] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState<Form>({
    fullName: '', email: '', password: '', confirmPassword: '',
    phone: '', cpf: '', birthDate: '',
    postalCode: '', addressLine: '', addressNumber: '',
    complement: '', neighborhood: '', city: '', state: '',
  });

  function set(field: keyof Form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function buscarCep(cep: string) {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) return;
    setLoadingCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm((f) => ({
          ...f,
          addressLine: data.logradouro ?? f.addressLine,
          neighborhood: data.bairro ?? f.neighborhood,
          city: data.localidade ?? f.city,
          state: data.uf ?? f.state,
        }));
      }
    } catch {
      // ignora erros de CEP
    } finally {
      setLoadingCep(false);
    }
  }

  function validateStep(): string {
    if (step === 0) {
      if (!form.fullName.trim()) return 'Nome é obrigatório';
      if (!form.email.includes('@')) return 'E-mail inválido';
      if (form.password.length < 8) return 'Senha deve ter no mínimo 8 caracteres';
      if (form.password !== form.confirmPassword) return 'As senhas não coincidem';
    }
    if (step === 1) {
      const cpfDigits = form.cpf.replace(/\D/g, '');
      if (form.cpf && cpfDigits.length !== 11) return 'CPF inválido';
    }
    return '';
  }

  function handleNext() {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError('');
    setStep((s) => s + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateStep();
    if (err) { setError(err); return; }
    setError('');
    setLoading(true);
    try {
      await api('/auth/signup-customer', {
        method: 'POST',
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email,
          password: form.password,
          phone: form.phone || undefined,
          cpf: form.cpf || undefined,
          birthDate: form.birthDate || undefined,
          postalCode: form.postalCode.replace(/\D/g, '') || undefined,
          addressLine: form.addressLine || undefined,
          addressNumber: form.addressNumber || undefined,
          complement: form.complement || undefined,
          neighborhood: form.neighborhood || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
        }),
      });
      router.replace('/verifique-seu-email');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta');
    } finally {
      setLoading(false);
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm w-full max-w-md">
      {/* Header */}
      <div className="mb-6">
        <div className="text-xl font-bold tracking-tight mb-1">AutoConnect</div>
        <h2 className="text-lg font-semibold">Criar sua conta</h2>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-2 mb-7">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition ${
              i < step ? 'bg-green-500 text-white' : i === step ? 'bg-brand-accent text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
            }`}>
              {i < step ? <Check size={13} /> : i + 1}
            </div>
            <span className={`text-xs hidden sm:block ${i === step ? 'font-medium text-slate-700 dark:text-slate-200' : 'text-slate-400'}`}>
              {label}
            </span>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px ${i < step ? 'bg-green-400' : 'bg-slate-100 dark:bg-slate-800'}`} />
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Etapa 1 — Acesso */}
        {step === 0 && (
          <div className="space-y-4">
            {step === 0 && (
              <a
                href={`${apiUrl}/api/v1/auth/google`}
                className="flex items-center justify-center gap-3 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2.5 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              >
                <svg width="16" height="16" viewBox="0 0 48 48" fill="none">
                  <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 2.9l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.9z"/>
                  <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.1 7.9 2.9l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8H6.2C9.5 35.6 16.3 44 24 44z"/>
                  <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41.1 36.2 44 30.6 44 24c0-1.3-.1-2.7-.4-3.9z"/>
                </svg>
                Cadastrar com Google
              </a>
            )}
            <div className="relative flex items-center">
              <div className="flex-1 border-t border-slate-100 dark:border-slate-800" />
              <span className="px-3 text-xs text-slate-400">ou com e-mail</span>
              <div className="flex-1 border-t border-slate-100 dark:border-slate-800" />
            </div>
            <Field label="Nome completo *" value={form.fullName} onChange={(v) => set('fullName', v)} placeholder="Seu nome completo" autoComplete="name" />
            <Field label="E-mail *" type="email" value={form.email} onChange={(v) => set('email', v)} placeholder="seu@email.com" autoComplete="email" />
            <Field label="Senha *" type="password" value={form.password} onChange={(v) => set('password', v)} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
            <Field label="Confirmar senha *" type="password" value={form.confirmPassword} onChange={(v) => set('confirmPassword', v)} placeholder="Repita a senha" autoComplete="new-password" />
          </div>
        )}

        {/* Etapa 2 — Dados pessoais */}
        {step === 1 && (
          <div className="space-y-4">
            <Field label="Celular" value={form.phone}
              onChange={(v) => set('phone', formatPhone(v))}
              placeholder="(11) 99999-9999" autoComplete="tel" />
            <Field label="CPF" value={form.cpf}
              onChange={(v) => set('cpf', formatCpf(v))}
              placeholder="000.000.000-00" />
            <Field label="Data de nascimento" type="date" value={form.birthDate}
              onChange={(v) => set('birthDate', v)} />
          </div>
        )}

        {/* Etapa 3 — Endereço */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">CEP</label>
              <input
                type="text"
                value={form.postalCode}
                onChange={(e) => {
                  const v = formatCep(e.target.value);
                  set('postalCode', v);
                  buscarCep(v);
                }}
                placeholder="00000-000"
                className={inputCls}
              />
              {loadingCep && <p className="text-xs text-slate-400 mt-1">Buscando endereço…</p>}
            </div>
            <Field label="Logradouro" value={form.addressLine} onChange={(v) => set('addressLine', v)} placeholder="Rua, Av., etc." />
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="block text-sm font-medium mb-1.5">Número</label>
                <input type="text" value={form.addressNumber} onChange={(e) => set('addressNumber', e.target.value)} className={inputCls} placeholder="123" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1.5">Complemento</label>
                <input type="text" value={form.complement} onChange={(e) => set('complement', e.target.value)} className={inputCls} placeholder="Apto, Bloco…" />
              </div>
            </div>
            <Field label="Bairro" value={form.neighborhood} onChange={(v) => set('neighborhood', v)} placeholder="Bairro" />
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1.5">Cidade</label>
                <input type="text" value={form.city} onChange={(e) => set('city', e.target.value)} className={inputCls} placeholder="São Paulo" />
              </div>
              <div className="col-span-1">
                <label className="block text-sm font-medium mb-1.5">UF</label>
                <input type="text" maxLength={2} value={form.state}
                  onChange={(e) => set('state', e.target.value.toUpperCase())}
                  className={inputCls} placeholder="SP" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Navegação */}
        <div className={`flex mt-6 ${step > 0 ? 'justify-between' : 'justify-end'}`}>
          {step > 0 && (
            <button type="button" onClick={() => { setError(''); setStep((s) => s - 1); }}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition">
              <ChevronLeft size={15} /> Voltar
            </button>
          )}
          {step < steps.length - 1 ? (
            <button type="button" onClick={handleNext}
              className="flex items-center gap-1.5 bg-brand-accent text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-blue-600 transition">
              Próximo <ChevronRight size={15} />
            </button>
          ) : (
            <button type="submit" disabled={loading}
              className="flex items-center gap-1.5 bg-brand-accent text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-blue-600 transition disabled:opacity-50">
              {loading ? 'Criando conta…' : 'Criar conta'}
              {!loading && <Check size={15} />}
            </button>
          )}
        </div>
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">
        Já tem conta?{' '}
        <Link href="/entrar" className="text-brand-accent hover:underline font-medium">Entrar</Link>
      </p>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent';

function Field({
  label, value, onChange, type = 'text', placeholder, autoComplete,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={inputCls}
      />
    </div>
  );
}
