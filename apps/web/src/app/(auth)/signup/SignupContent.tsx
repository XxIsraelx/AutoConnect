'use client';


import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, Check, Building2,
  User, MapPin, Lock, Ticket, AlertCircle, Loader2,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore, type AuthUser } from '@/store/auth';

// ─── Utilitários ──────────────────────────────────────────────────────────────

function fmtCNPJ(v: string) {
  return v.replace(/\D/g, '').slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}
function fmtCPF(v: string) {
  return v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
function fmtPhone(v: string) {
  return v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2');
}
function fmtCEP(v: string) {
  return v.replace(/\D/g, '').slice(0, 8)
    .replace(/(\d{5})(\d{1,3})$/, '$1-$2');
}
/**
 * Usa o valor vindo de API externa só se ele tiver conteúdo real.
 * BrasilAPI e ViaCEP devolvem STRING VAZIA (não null) para campos que não têm,
 * e `??` só cai no fallback em null/undefined — então o vazio passava adiante e
 * apagava o que o usuário já havia digitado.
 */
function ou(valor: string | null | undefined, atual: string) {
  return valor && valor.trim() ? valor.trim() : atual;
}
function toSlug(v: string) {
  return v.toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const BR_STATES = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

// ─── Tipos ─────────────────────────────────────────────────────────────────────

type CnpjStatus = 'idle' | 'loading' | 'valid' | 'inactive' | 'invalid';

type Form = {
  inviteToken: string;
  cnpj: string;
  stateRegistration: string;
  legalName: string;
  tradeName: string;
  slug: string;
  primaryEmail: string;
  adminFullName: string;
  adminEmail: string;
  adminPassword: string;
  adminCpf: string;
  adminJobTitle: string;
  adminPhone: string;
  postalCode: string;
  addressLine: string;
  addressNumber: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  branchPhone: string;
};

/** Erros por campo do formulário: { tradeName: 'Informe o nome fantasia' } */
type Errors = Partial<Record<keyof Form, string>>;

// ─── Steps config ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: 'invite',   label: 'Convite',     icon: Ticket    },
  { id: 'company',  label: 'Empresa',     icon: Building2 },
  { id: 'admin',    label: 'Responsável', icon: User      },
  { id: 'address',  label: 'Endereço',    icon: MapPin    },
  { id: 'access',   label: 'Acesso',      icon: Lock      },
];

/** Em que etapa cada campo aparece — usado para levar o usuário até o erro. */
const STEP_DO_CAMPO: Record<string, number> = {
  inviteToken: 0,
  cnpj: 1, stateRegistration: 1, legalName: 1, tradeName: 1, slug: 1, primaryEmail: 1,
  adminFullName: 2, adminCpf: 2, adminJobTitle: 2, adminPhone: 2,
  postalCode: 3, addressLine: 3, addressNumber: 3, complement: 3,
  neighborhood: 3, city: 3, state: 3, branchPhone: 3,
  adminEmail: 4, adminPassword: 4,
};

/**
 * A API responde com caminhos aninhados (`tenant.tradeName`, `branch.phone`);
 * o formulário usa nomes planos. Sem esta tradução os erros do servidor não
 * teriam como ser exibidos no campo correspondente.
 */
const CAMPO_DA_API: Record<string, keyof Form> = {
  'inviteToken': 'inviteToken',
  'tenant.cnpj': 'cnpj',
  'tenant.stateRegistration': 'stateRegistration',
  'tenant.legalName': 'legalName',
  'tenant.tradeName': 'tradeName',
  'tenant.slug': 'slug',
  'tenant.primaryEmail': 'primaryEmail',
  'admin.fullName': 'adminFullName',
  'admin.email': 'adminEmail',
  'admin.password': 'adminPassword',
  'admin.cpf': 'adminCpf',
  'admin.jobTitle': 'adminJobTitle',
  'admin.phone': 'adminPhone',
  'branch.phone': 'branchPhone',
  'branch.postalCode': 'postalCode',
  'branch.addressLine': 'addressLine',
  'branch.addressNumber': 'addressNumber',
  'branch.complement': 'complement',
  'branch.neighborhood': 'neighborhood',
  'branch.city': 'city',
  'branch.state': 'state',
};

/**
 * As mensagens padrão do Zod chegam em inglês ("String must contain at least
 * 2 character(s)"). Traduz o que é comum para não expor isso ao usuário.
 */
function traduzirErro(msg: string): string {
  const min = msg.match(/at least (\d+) character/i);
  if (min) return `Mínimo de ${min[1]} caracteres`;
  const max = msg.match(/at most (\d+) character/i);
  if (max) return `Máximo de ${max[1]} caracteres`;
  const exato = msg.match(/exactly (\d+) character/i);
  if (exato) return `Deve ter exatamente ${exato[1]} caracteres`;
  if (/invalid email/i.test(msg)) return 'E-mail inválido';
  if (/^required$/i.test(msg.trim())) return 'Campo obrigatório';
  if (/expected string/i.test(msg)) return 'Campo obrigatório';
  return msg; // já vem em português (mensagens próprias do schema)
}

// ─── Componentes auxiliares ────────────────────────────────────────────────────

const inputCls = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition';
const inputErrCls = 'w-full rounded-lg border border-red-500 dark:border-red-500 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500 transition';

function Field({
  label, value, onChange, type = 'text', placeholder, autoComplete, required = false,
  hint, maxLength, error, name,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; autoComplete?: string;
  required?: boolean; hint?: string; maxLength?: number;
  /** Mensagem de erro do campo; quando presente, destaca a borda. */
  error?: string;
  /** Usado para rolar até o campo quando a validação falha. */
  name?: string;
}) {
  return (
    <div data-field={name}>
      <label className="block text-sm font-medium mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        className={error ? inputErrCls : inputCls}
      />
      {error
        ? <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>
        : hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

// ─── Página principal ──────────────────────────────────────────────────────────

export default function SignupPage() {
  const router      = useRouter();
  const params      = useSearchParams();
  const setSession  = useAuthStore((s) => s.setSession);

  const [step, setStep]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [fieldErrors, setFieldErrors] = useState<Errors>({});

  const [cnpjStatus, setCnpjStatus] = useState<CnpjStatus>('idle');
  const [cnpjData,   setCnpjData]   = useState<{ razao_social?: string; nome_fantasia?: string; municipio?: string; uf?: string; logradouro?: string; numero?: string; bairro?: string; cep?: string } | null>(null);
  const [loadingCep, setLoadingCep] = useState(false);

  const [form, setForm] = useState<Form>({
    inviteToken: params.get('invite') ?? '',
    cnpj: '', stateRegistration: '',
    legalName: '', tradeName: '', slug: '', primaryEmail: '',
    adminFullName: '', adminEmail: '', adminPassword: '',
    adminCpf: '', adminJobTitle: '', adminPhone: '',
    postalCode: '', addressLine: '', addressNumber: '',
    complement: '', neighborhood: '', city: '', state: '',
    branchPhone: '',
  });

  function set(field: keyof Form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    // Some o erro assim que o usuário mexe no campo, em vez de deixá-lo
    // aceso enquanto ele digita a correção.
    setFieldErrors((e) => {
      if (!e[field]) return e;
      const { [field]: _, ...resto } = e;
      // Sem campos destacados, o aviso geral não faz mais sentido.
      if (!Object.keys(resto).length) setError('');
      return resto;
    });
  }

  // ── CNPJ lookup via BrasilAPI ────────────────────────────────────────────────
  const lookupCNPJ = useCallback(async (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length !== 14) { setCnpjStatus('idle'); return; }
    setCnpjStatus('loading');
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!res.ok) { setCnpjStatus('invalid'); return; }
      // A BrasilAPI devolve DOIS campos: `situacao_cadastral` é numérico
      // (2 = ativa) e `descricao_situacao_cadastral` é o texto ("ATIVA").
      // Comparar o numérico com a string reprovava todo CNPJ válido.
      const data = await res.json() as typeof cnpjData & {
        situacao_cadastral?: number | string;
        descricao_situacao_cadastral?: string;
      };

      const descricao = data.descricao_situacao_cadastral?.trim().toUpperCase();
      const codigo = Number(data.situacao_cadastral);
      const ativa = descricao ? descricao === 'ATIVA' : codigo === 2;
      const conclusivo = Boolean(descricao) || Number.isFinite(codigo);

      if (conclusivo && !ativa) {
        setCnpjStatus('inactive');
        setCnpjData(null);
        return;
      }
      setCnpjData(data);
      setCnpjStatus('valid');
      // Auto-preenche campos com dados da Receita Federal.
      // `nome_fantasia`, `logradouro` e `numero` costumam vir "" da BrasilAPI —
      // ver o helper `ou` no topo do arquivo.
      setForm((f) => {
        const legalName = ou(data.razao_social, f.legalName);
        const tradeName = ou(data.nome_fantasia, ou(data.razao_social, f.tradeName));
        return {
          ...f,
          legalName,
          tradeName,
          slug:          f.slug || toSlug(tradeName),
          city:          data.municipio?.trim()
            ? data.municipio.trim().charAt(0).toUpperCase() + data.municipio.trim().slice(1).toLowerCase()
            : f.city,
          state:         ou(data.uf, f.state),
          addressLine:   ou(data.logradouro, f.addressLine),
          addressNumber: ou(data.numero, f.addressNumber),
          neighborhood:  ou(data.bairro, f.neighborhood),
          postalCode:    data.cep?.trim() ? fmtCEP(data.cep.replace(/\D/g, '')) : f.postalCode,
        };
      });
    } catch {
      setCnpjStatus('idle');
    }
  }, []);

  useEffect(() => {
    if (form.cnpj.replace(/\D/g, '').length === 14) lookupCNPJ(form.cnpj);
  }, [form.cnpj, lookupCNPJ]);

  // ── CEP lookup ───────────────────────────────────────────────────────────────
  async function lookupCEP(cep: string) {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) return;
    setLoadingCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (!data.erro) {
        setForm((f) => ({
          ...f,
          addressLine:  ou(data.logradouro, f.addressLine),
          neighborhood: ou(data.bairro,     f.neighborhood),
          city:         ou(data.localidade, f.city),
          state:        ou(data.uf,         f.state),
        }));
      }
    } catch { /* ignora */ }
    finally { setLoadingCep(false); }
  }

  // ── Validação por etapa ───────────────────────────────────────────────────────
  /**
   * Valida TODOS os campos da etapa e devolve um erro por campo, em vez de
   * parar no primeiro. Assim o usuário corrige tudo de uma vez e vê a mensagem
   * ao lado do campo, não como um aviso solto no topo.
   */
  function validateFields(s: number): Errors {
    const e: Errors = {};
    const digits = (v: string) => v.replace(/\D/g, '');

    switch (s) {
      case 0:
        if (!form.inviteToken.trim()) e.inviteToken = 'Cole o token de convite recebido';
        break;
      case 1:
        if (digits(form.cnpj).length !== 14) e.cnpj = 'Informe os 14 dígitos do CNPJ';
        else if (cnpjStatus === 'inactive') e.cnpj = 'CNPJ sem situação ativa na Receita Federal';
        else if (cnpjStatus === 'invalid') e.cnpj = 'CNPJ não encontrado na Receita Federal';
        if (form.legalName.trim().length < 2) e.legalName = 'Informe a razão social';
        if (form.tradeName.trim().length < 2) e.tradeName = 'Informe o nome fantasia';
        if (form.slug.trim().length < 3) e.slug = 'Mínimo de 3 caracteres';
        else if (!/^[a-z0-9-]+$/.test(form.slug)) e.slug = 'Use apenas letras minúsculas, números e hífen';
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.primaryEmail)) e.primaryEmail = 'E-mail inválido';
        break;
      case 2:
        if (form.adminFullName.trim().length < 2) e.adminFullName = 'Informe o nome completo';
        // O dígito verificador é conferido pela API; aqui só o tamanho.
        if (digits(form.adminCpf).length !== 11) e.adminCpf = 'Informe os 11 dígitos do CPF';
        if (form.adminJobTitle.trim().length < 2) e.adminJobTitle = 'Informe o cargo';
        if (digits(form.adminPhone).length < 10) e.adminPhone = 'Informe DDD + número';
        break;
      case 3:
        if (digits(form.postalCode).length !== 8) e.postalCode = 'Informe os 8 dígitos do CEP';
        if (form.addressLine.trim().length < 3) e.addressLine = 'Informe o logradouro';
        if (!form.addressNumber.trim()) e.addressNumber = 'Informe o número (ou "S/N")';
        if (form.neighborhood.trim().length < 2) e.neighborhood = 'Informe o bairro';
        if (form.city.trim().length < 2) e.city = 'Informe a cidade';
        if (!form.state) e.state = 'Selecione o estado';
        if (digits(form.branchPhone).length < 10) e.branchPhone = 'Informe DDD + número';
        break;
      case 4:
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.adminEmail)) e.adminEmail = 'E-mail inválido';
        if (form.adminPassword.length < 8) e.adminPassword = 'Mínimo de 8 caracteres';
        break;
    }
    return e;
  }

  /** Marca os erros e leva o usuário até a etapa e o campo do primeiro problema. */
  function aplicarErros(errs: Errors, etapa?: number) {
    setFieldErrors(errs);
    const primeiro = Object.keys(errs)[0];
    if (!primeiro) return;

    const destino = etapa ?? STEP_DO_CAMPO[primeiro] ?? step;
    if (destino !== step) setStep(destino);

    // rola até o campo depois que a etapa renderizar
    setTimeout(() => {
      document.querySelector(`[data-field="${primeiro}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }

  function handleNext() {
    const errs = validateFields(step);
    if (Object.keys(errs).length) {
      setError('Revise os campos destacados abaixo.');
      aplicarErros(errs, step);
      return;
    }
    setError('');
    setFieldErrors({});
    setStep((s) => s + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Revalida TODAS as etapas antes de enviar — um campo inválido lá atrás
    // não pode mais explodir só no final como "Validation failed".
    const todos: Errors = {};
    for (let s = 0; s < STEPS.length; s++) Object.assign(todos, validateFields(s));
    if (Object.keys(todos).length) {
      setError('Revise os campos destacados antes de concluir.');
      aplicarErros(todos);
      return;
    }

    setError('');
    setFieldErrors({});
    setLoading(true);

    try {
      const data = await api<{ accessToken: string; user: AuthUser }>('/auth/signup-tenant', {
        method: 'POST',
        body: JSON.stringify({
          inviteToken: form.inviteToken.trim(),
          tenant: {
            cnpj:              form.cnpj,
            stateRegistration: form.stateRegistration || undefined,
            legalName:         form.legalName,
            tradeName:         form.tradeName,
            slug:              form.slug,
            primaryEmail:      form.primaryEmail,
          },
          admin: {
            fullName: form.adminFullName,
            email:    form.adminEmail,
            password: form.adminPassword,
            cpf:      form.adminCpf,
            jobTitle: form.adminJobTitle,
            phone:    form.adminPhone,
          },
          branch: {
            phone:         form.branchPhone,
            postalCode:    form.postalCode,
            addressLine:   form.addressLine,
            addressNumber: form.addressNumber,
            complement:    form.complement || undefined,
            neighborhood:  form.neighborhood,
            city:          form.city,
            state:         form.state,
          },
        }),
      });
      setSession(data.accessToken, data.user);
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) {
        // Traduz os caminhos da API para os campos do formulário e leva o
        // usuário até o primeiro problema, em vez de exibir "Validation failed".
        const errs: Errors = {};
        const semMapa: string[] = [];
        for (const fe of err.fieldErrors) {
          const campo = CAMPO_DA_API[fe.field];
          if (campo) errs[campo] = traduzirErro(fe.message);
          else semMapa.push(`${fe.field}: ${traduzirErro(fe.message)}`);
        }

        if (Object.keys(errs).length) {
          setError('Revise os campos destacados abaixo.');
          aplicarErros(errs);
        } else {
          setError(semMapa.join(' · ') || err.message);
        }
      } else {
        setError(err instanceof ApiError ? err.message : 'Erro ao criar conta');
      }
    } finally {
      setLoading(false);
    }
  }

  const CurrentIcon = STEPS[step].icon;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm w-full max-w-lg">

      {/* Cabeçalho */}
      <div className="mb-6">
        <div className="text-xl font-bold tracking-tight mb-1">AutoConnect</div>
        <h2 className="text-lg font-semibold">Cadastrar concessionária</h2>
        <p className="text-sm text-slate-500 mt-0.5">14 dias grátis, sem cartão de crédito.</p>
      </div>

      {/* Barra de progresso */}
      <div className="flex items-center gap-1.5 mb-8">
        {STEPS.map((s, i) => {
          const done    = i < step;
          const current = i === step;
          return (
            <div key={s.id} className="flex items-center gap-1.5 flex-1 min-w-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all ${
                done    ? 'bg-emerald-500 text-white' :
                current ? 'bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900' :
                          'bg-slate-100 dark:bg-slate-800 text-slate-400'
              }`}>
                {done ? <Check size={12} /> : <s.icon size={12} />}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 rounded-full ${done ? 'bg-emerald-400' : 'bg-slate-100 dark:bg-slate-800'}`} />
              )}
            </div>
          );
        })}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
            <CurrentIcon size={16} className="text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{STEPS[step].label}</h3>
        </div>

        {/* ── Step 0: Convite ───────────────────────────────────────────── */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4 text-sm text-blue-700 dark:text-blue-300">
              <p className="font-medium mb-1">Acesso por convite</p>
              <p className="text-blue-600 dark:text-blue-400 text-xs">
                O cadastro de concessionárias é restrito. Você precisar de um link de convite enviado pela equipe AutoConnect.
              </p>
            </div>
            <div data-field="inviteToken">
              <label className="block text-sm font-medium mb-1.5">
                Token de convite <span className="text-red-500">*</span>
              </label>
              <input
                value={form.inviteToken}
                onChange={(e) => set('inviteToken', e.target.value.trim())}
                placeholder="Cole o token recebido por e-mail"
                className={fieldErrors.inviteToken ? inputErrCls : inputCls}
                autoComplete="off"
                spellCheck={false}
              />
              {fieldErrors.inviteToken && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.inviteToken}</p>}
              <p className="text-xs text-slate-400 mt-1.5">
                Não tem um convite?{' '}
                <a href="mailto:contato@autoconnect.app" className="text-blue-500 hover:underline">
                  Entre em contato
                </a>
              </p>
            </div>
          </div>
        )}

        {/* ── Step 1: Empresa ───────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-4">
            {/* CNPJ com feedback em tempo real */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                CNPJ <span className="text-red-500">*</span>
              </label>
              <div className="relative" data-field="cnpj">
                <input
                  value={form.cnpj}
                  onChange={(e) => set('cnpj', fmtCNPJ(e.target.value))}
                  placeholder="00.000.000/0000-00"
                  className={fieldErrors.cnpj ? inputErrCls : inputCls}
                />
                  {fieldErrors.cnpj && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.cnpj}</p>}
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {cnpjStatus === 'loading' && <Loader2 size={14} className="animate-spin text-slate-400" />}
                  {cnpjStatus === 'valid'   && <Check size={14} className="text-emerald-500" />}
                  {cnpjStatus === 'invalid' && <AlertCircle size={14} className="text-red-500" />}
                </div>
              </div>
              {cnpjStatus === 'valid' && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                  <Check size={11} /> CNPJ ativo — dados preenchidos automaticamente
                </p>
              )}
              {cnpjStatus === 'inactive' && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle size={11} /> CNPJ com situação inativa ou suspensa na Receita Federal
                </p>
              )}
              {cnpjStatus === 'invalid' && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle size={11} /> CNPJ não encontrado
                </p>
              )}
            </div>

            <Field label="Inscrição Estadual (IE)" value={form.stateRegistration} name="stateRegistration" error={fieldErrors.stateRegistration}
              onChange={(v) => set('stateRegistration', v)}
              placeholder="000.000.000.000 ou ISENTO" hint="Deixe em branco se isento" />

            <Field label="Razão social" value={form.legalName} name="legalName" error={fieldErrors.legalName} required
              onChange={(v) => set('legalName', v)} placeholder="Minha Auto Ltda" />

            <Field label="Nome fantasia" value={form.tradeName} name="tradeName" error={fieldErrors.tradeName} required
              onChange={(v) => { set('tradeName', v); if (!form.slug) set('slug', toSlug(v)); }}
              placeholder="Minha Auto" />

            <div data-field="slug">
              <label className="block text-sm font-medium mb-1.5">
                Slug (URL pública) <span className="text-red-500">*</span>
              </label>
              <div className={`flex items-center rounded-lg border bg-white dark:bg-slate-800 overflow-hidden focus-within:ring-2 ${
                fieldErrors.slug
                  ? 'border-red-500 focus-within:ring-red-500'
                  : 'border-slate-200 dark:border-slate-700 focus-within:ring-blue-500'
              }`}>
                <span className="px-3 py-2 text-xs text-slate-400 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 select-none whitespace-nowrap">
                  autoconnect.app/c/
                </span>
                <input
                  value={form.slug}
                  onChange={(e) => set('slug', e.target.value.replace(/[^a-z0-9-]/g, ''))}
                  className="flex-1 px-3 py-2 text-sm outline-none bg-transparent"
                  placeholder="minha-auto"
                />
              </div>
              {fieldErrors.slug && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.slug}</p>}
            </div>

            <Field label="E-mail da concessionária" value={form.primaryEmail} name="primaryEmail" error={fieldErrors.primaryEmail} required
              onChange={(v) => set('primaryEmail', v)} type="email"
              placeholder="contato@minhauto.com.br" />
          </div>
        )}

        {/* ── Step 2: Responsável ───────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-4">
            <Field label="Nome completo do responsável" value={form.adminFullName} name="adminFullName" error={fieldErrors.adminFullName} required
              onChange={(v) => set('adminFullName', v)} placeholder="João Silva" autoComplete="name" />

            <div>
              <label className="block text-sm font-medium mb-1.5">
                CPF do responsável <span className="text-red-500">*</span>
              </label>
              <input
                value={form.adminCpf}
                onChange={(e) => set('adminCpf', fmtCPF(e.target.value))}
                placeholder="000.000.000-00"
                className={fieldErrors.adminCpf ? inputErrCls : inputCls}
              />
                {fieldErrors.adminCpf && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.adminCpf}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                Cargo / função <span className="text-red-500">*</span>
              </label>
              <select
                value={form.adminJobTitle}
                onChange={(e) => set('adminJobTitle', e.target.value)}
                className={inputCls}
              >
                <option value="">Selecione…</option>
                <option>Proprietário</option>
                <option>Sócio</option>
                <option>Diretor</option>
                <option>Gerente Geral</option>
                <option>Gerente Comercial</option>
                <option>Outro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                Celular pessoal <span className="text-red-500">*</span>
              </label>
              <input
                value={form.adminPhone}
                onChange={(e) => set('adminPhone', fmtPhone(e.target.value))}
                placeholder="(11) 99999-9999"
                className={fieldErrors.adminPhone ? inputErrCls : inputCls}
                type="tel"
              />
              {fieldErrors.adminPhone && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.adminPhone}</p>}
              <p className="text-xs text-slate-400 mt-1">Usado apenas para contato interno</p>
            </div>
          </div>
        )}

        {/* ── Step 3: Endereço ──────────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                CEP <span className="text-red-500">*</span>
              </label>
              <div className="relative" data-field="postalCode">
                <input
                  value={form.postalCode}
                  onChange={(e) => { const v = fmtCEP(e.target.value); set('postalCode', v); lookupCEP(v); }}
                  placeholder="00000-000"
                  className={fieldErrors.postalCode ? inputErrCls : inputCls}
                />
                  {fieldErrors.postalCode && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.postalCode}</p>}
                {loadingCep && (
                  <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />
                )}
              </div>
              {loadingCep && <p className="text-xs text-slate-400 mt-1">Buscando endereço…</p>}
            </div>

            <Field label="Logradouro" value={form.addressLine} name="addressLine" error={fieldErrors.addressLine} required
              onChange={(v) => set('addressLine', v)} placeholder="Rua, Av., etc." />

            <div className="grid grid-cols-5 gap-3" data-field="addressNumber">
              <div className="col-span-2" data-field="addressNumber">
                <label className="block text-sm font-medium mb-1.5">Número <span className="text-red-500">*</span></label>
                <input value={form.addressNumber} onChange={(e) => set('addressNumber', e.target.value)}
                  className={fieldErrors.addressNumber ? inputErrCls : inputCls} placeholder="123" />
                {fieldErrors.addressNumber && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.addressNumber}</p>}
              </div>
              <div className="col-span-3">
                <label className="block text-sm font-medium mb-1.5">Complemento</label>
                <input value={form.complement} onChange={(e) => set('complement', e.target.value)}
                  className={inputCls} placeholder="Sala, Galpão…" />
              </div>
            </div>

            <Field label="Bairro" value={form.neighborhood} name="neighborhood" error={fieldErrors.neighborhood} required
              onChange={(v) => set('neighborhood', v)} placeholder="Centro" />

            <div className="grid grid-cols-3 gap-3" data-field="city">
              <div className="col-span-2" data-field="city">
                <label className="block text-sm font-medium mb-1.5">Cidade <span className="text-red-500">*</span></label>
                <input value={form.city} onChange={(e) => set('city', e.target.value)}
                  className={fieldErrors.city ? inputErrCls : inputCls} placeholder="São Paulo" />
                {fieldErrors.city && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.city}</p>}
              </div>
              <div data-field="state">
                <label className="block text-sm font-medium mb-1.5">UF <span className="text-red-500">*</span></label>
                <select value={form.state} onChange={(e) => set('state', e.target.value)} className={fieldErrors.state ? inputErrCls : inputCls}>
                  <option value="">UF</option>
                  {BR_STATES.map((uf) => <option key={uf}>{uf}</option>)}
                </select>
                {fieldErrors.state && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.state}</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                Telefone comercial <span className="text-red-500">*</span>
              </label>
              <input
                value={form.branchPhone}
                onChange={(e) => set('branchPhone', fmtPhone(e.target.value))}
                placeholder="(11) 3000-0000"
                className={fieldErrors.branchPhone ? inputErrCls : inputCls}
                type="tel"
              />
              {fieldErrors.branchPhone && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.branchPhone}</p>}
              <p className="text-xs text-slate-400 mt-1">Número exibido para clientes no catálogo</p>
            </div>
          </div>
        )}

        {/* ── Step 4: Acesso ────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4 text-sm text-slate-600 dark:text-slate-400 space-y-1">
              <p className="font-medium text-slate-700 dark:text-slate-300">Resumo do cadastro</p>
              <p><span className="text-slate-400">CNPJ:</span> {form.cnpj}</p>
              <p><span className="text-slate-400">Empresa:</span> {form.tradeName}</p>
              <p><span className="text-slate-400">Responsável:</span> {form.adminFullName} · {form.adminJobTitle}</p>
              <p><span className="text-slate-400">Endereço:</span> {form.city}/{form.state}</p>
            </div>

            <Field label="E-mail de acesso" value={form.adminEmail} name="adminEmail" error={fieldErrors.adminEmail} required
              onChange={(v) => set('adminEmail', v)} type="email"
              placeholder="voce@minhauto.com.br" autoComplete="email"
              hint="Será seu login no painel" />

            <Field label="Senha (mín. 8 caracteres)" value={form.adminPassword} name="adminPassword" error={fieldErrors.adminPassword} required
              onChange={(v) => set('adminPassword', v)} type="password"
              placeholder="••••••••" autoComplete="new-password" />
          </div>
        )}

        {/* Erro */}
        {error && (
          <div className="mt-4 flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2.5">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Navegação */}
        <div className={`flex mt-6 ${step > 0 ? 'justify-between' : 'justify-end'}`}>
          {step > 0 && (
            <button type="button"
              onClick={() => { setError(''); setStep((s) => s - 1); }}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
              <ChevronLeft size={15} /> Voltar
            </button>
          )}

          {step < STEPS.length - 1 ? (
            <button type="button" onClick={handleNext}
              className="flex items-center gap-1.5 bg-blue-600 text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-blue-700 transition">
              Próximo <ChevronRight size={15} />
            </button>
          ) : (
            <button type="submit" disabled={loading}
              className="flex items-center gap-1.5 bg-blue-600 text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? <><Loader2 size={14} className="animate-spin" /> Criando conta…</> : <><Check size={14} /> Criar conta</>}
            </button>
          )}
        </div>
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">
        Já tem conta?{' '}
        <Link href="/login" className="text-blue-600 hover:underline font-medium">Entrar</Link>
      </p>
    </div>
  );
}
