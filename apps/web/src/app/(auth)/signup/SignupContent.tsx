'use client';


import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Check, AlertCircle, Loader2, Info } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { mascararTelefoneBr, cnpjValido, DURACAO_DO_TRIAL_DIAS } from '@autoconnect/shared';
import { useAuthStore, type AuthUser } from '@/store/auth';

// ─── Utilitários ──────────────────────────────────────────────────────────────

function fmtCNPJ(v: string) {
  return v.replace(/\D/g, '').slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}
/**
 * Máscara de telefone — do `@autoconnect/shared`.
 *
 * A implementação local agrupava sempre 5+4 (o formato do celular) e quebrava o
 * fixo: `3132718080` virava `(31) 32718-080` e era gravado assim. O dono via o
 * próprio telefone errado na página pública no primeiro dia.
 */
const fmtPhone = mascararTelefoneBr;
/**
 * Usa o valor vindo de API externa só se ele tiver conteúdo real.
 * BrasilAPI devolve STRING VAZIA (não null) para campos que não têm, e `??` só
 * cai no fallback em null/undefined — então o vazio passava adiante e apagava o
 * que o usuário já havia digitado.
 */
function ou(valor: string | null | undefined, atual: string) {
  return valor && valor.trim() ? valor.trim() : atual;
}

// ─── Tipos ─────────────────────────────────────────────────────────────────────

/**
 * Situação da consulta à Receita (BrasilAPI).
 *
 * `indisponivel` é o estado que faltava e que fechava a porta de entrada: antes
 * qualquer resposta não-2xx — 404 de empresa nova, 429 do limite de uso do
 * serviço gratuito, 500, manutenção — virava "CNPJ não encontrado" e **travava
 * o cadastro**. Agora a regra dura é o dígito verificador (`cnpjValido`, a
 * mesma conta que a API faz) e a consulta é enriquecimento: indisponível
 * significa "digite os dados à mão", nunca "você não pode entrar".
 */
type CnpjStatus = 'idle' | 'loading' | 'valid' | 'inactive' | 'indisponivel';

type Form = {
  inviteToken: string;
  cnpj: string;
  tradeName: string;
  adminFullName: string;
  adminEmail: string;
  adminPassword: string;
  branchPhone: string;
};

/** Erros por campo do formulário: { tradeName: 'Informe o nome da loja' } */
type Errors = Partial<Record<keyof Form, string>>;

/**
 * A API responde com caminhos aninhados (`tenant.tradeName`, `branch.phone`);
 * o formulário usa nomes planos. Sem esta tradução os erros do servidor não
 * teriam como ser exibidos no campo correspondente.
 */
const CAMPO_DA_API: Record<string, keyof Form> = {
  'inviteToken': 'inviteToken',
  'tenant.cnpj': 'cnpj',
  'tenant.tradeName': 'tradeName',
  'admin.fullName': 'adminFullName',
  'admin.email': 'adminEmail',
  'admin.password': 'adminPassword',
  'branch.phone': 'branchPhone',
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

/**
 * # Cadastro de concessionária, em autosserviço
 *
 * Eram **22 campos em 5 etapas** — e a primeira etapa pedia um token de convite
 * que só a equipe do AutoConnect emitia, enquanto a home anunciava "Criar conta
 * grátis" em cinco botões. O piloto do primeiro dia parou exatamente aqui.
 *
 * Agora são **cinco campos obrigatórios numa tela só**: CNPJ, nome da loja, seu
 * nome, e-mail e senha (mais o telefone da loja, opcional). O critério do corte
 * foi "o que a loja precisa para existir e funcionar"; o resto é pedido dentro
 * do produto, no momento em que importa — razão social e endereço em
 * `/configuracoes` (com item no checklist de primeiros passos), CPF do
 * responsável só na emissão do contrato, onde já existe "Representante legal".
 *
 * O convite continua aceito: `?invite=` na URL o traz, e a conta nasce com o
 * e-mail já verificado. Ele deixou de ser exigido, não de existir.
 */
export default function SignupPage() {
  const router      = useRouter();
  const params      = useSearchParams();
  const setSession  = useAuthStore((s) => s.setSession);

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [fieldErrors, setFieldErrors] = useState<Errors>({});

  const [cnpjStatus, setCnpjStatus] = useState<CnpjStatus>('idle');
  /** Razão social e endereço vindos da Receita: não são pedidos, mas são usados. */
  const [dadosDaReceita, setDadosDaReceita] = useState<{
    legalName?: string; postalCode?: string; addressLine?: string;
    addressNumber?: string; neighborhood?: string; city?: string; state?: string;
  }>({});

  const [form, setForm] = useState<Form>({
    inviteToken: params.get('invite') ?? '',
    cnpj: '', tradeName: '',
    adminFullName: '', adminEmail: '', adminPassword: '',
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

  // ── CNPJ: dígito verificador manda, a Receita enriquece ──────────────────────
  const lookupCNPJ = useCallback(async (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length !== 14) { setCnpjStatus('idle'); return; }
    setCnpjStatus('loading');
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      // Qualquer resposta não-2xx é **indisponibilidade**, não reprovação:
      // empresa recém-aberta dá 404 e o limite de uso do serviço gratuito dá
      // 429. Nenhum dos dois diz nada sobre o CNPJ ser válido.
      if (!res.ok) { setCnpjStatus('indisponivel'); return; }
      // A BrasilAPI devolve DOIS campos: `situacao_cadastral` é numérico
      // (2 = ativa) e `descricao_situacao_cadastral` é o texto ("ATIVA").
      // Comparar o numérico com a string reprovava todo CNPJ válido.
      const data = await res.json() as {
        razao_social?: string; nome_fantasia?: string; municipio?: string; uf?: string;
        logradouro?: string; numero?: string; bairro?: string; cep?: string;
        situacao_cadastral?: number | string;
        descricao_situacao_cadastral?: string;
      };

      const descricao = data.descricao_situacao_cadastral?.trim().toUpperCase();
      const codigo = Number(data.situacao_cadastral);
      const ativa = descricao ? descricao === 'ATIVA' : codigo === 2;
      const conclusivo = Boolean(descricao) || Number.isFinite(codigo);

      if (conclusivo && !ativa) {
        setCnpjStatus('inactive');
        setDadosDaReceita({});
        return;
      }
      setCnpjStatus('valid');

      const razao = data.razao_social?.trim();
      const cidade = data.municipio?.trim();
      // Guardado, não exibido: a razão social e o endereço da Receita vão junto
      // do cadastro para a loja não nascer sem eles — mas nenhum dos dois é um
      // campo que a pessoa precise preencher para entrar.
      setDadosDaReceita({
        legalName:     razao || undefined,
        postalCode:    data.cep?.replace(/\D/g, '') || undefined,
        addressLine:   data.logradouro?.trim() || undefined,
        addressNumber: data.numero?.trim() || undefined,
        neighborhood:  data.bairro?.trim() || undefined,
        city:          cidade ? cidade.charAt(0).toUpperCase() + cidade.slice(1).toLowerCase() : undefined,
        state:         data.uf?.trim() || undefined,
      });

      // Preenche o nome da loja só se estiver vazio — o que a pessoa digitou
      // vale mais que o que a Receita tem registrado.
      setForm((f) => {
        const sugerido = ou(data.nome_fantasia, ou(razao, ''));
        if (!sugerido || f.tradeName.trim()) return f;
        return { ...f, tradeName: sugerido };
      });
      // O nome preenchido sozinho não pode deixar aceso um "Informe o nome da
      // loja" ao lado de um campo que agora está preenchido.
      setFieldErrors((e) => {
        if (!e.tradeName) return e;
        const { tradeName: _, ...resto } = e;
        return resto;
      });
    } catch {
      // BrasilAPI fora do ar: mesmo tratamento do 4xx/5xx. Só não autopreenche.
      setCnpjStatus('indisponivel');
    }
  }, []);

  useEffect(() => {
    if (form.cnpj.replace(/\D/g, '').length === 14) lookupCNPJ(form.cnpj);
    else setCnpjStatus('idle');
  }, [form.cnpj, lookupCNPJ]);

  // ── Validação ────────────────────────────────────────────────────────────────
  /**
   * Valida TODOS os campos e devolve um erro por campo, em vez de parar no
   * primeiro. Assim o usuário corrige tudo de uma vez e vê a mensagem ao lado
   * do campo, não como um aviso solto no topo.
   */
  function validateFields(): Errors {
    const e: Errors = {};
    const digits = (v: string) => v.replace(/\D/g, '');

    // O dígito verificador é a regra dura, e é a MESMA conta que a API faz.
    // `cnpjStatus` não entra aqui de propósito: a Receita não decide se o
    // cadastro segue.
    if (digits(form.cnpj).length !== 14) e.cnpj = 'Informe os 14 dígitos do CNPJ';
    else if (!cnpjValido(form.cnpj)) e.cnpj = 'CNPJ inválido — confira os dígitos';
    else if (cnpjStatus === 'inactive') e.cnpj = 'CNPJ sem situação ativa na Receita Federal';

    if (form.tradeName.trim().length < 2) e.tradeName = 'Informe o nome da loja';
    if (form.adminFullName.trim().length < 2) e.adminFullName = 'Informe seu nome';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.adminEmail)) e.adminEmail = 'E-mail inválido';
    if (form.adminPassword.length < 8) e.adminPassword = 'Mínimo de 8 caracteres';
    if (form.branchPhone.trim() && digits(form.branchPhone).length < 10) {
      e.branchPhone = 'Informe DDD + número, ou deixe em branco';
    }
    return e;
  }

  /** Marca os erros e rola até o primeiro problema. */
  function aplicarErros(errs: Errors) {
    setFieldErrors(errs);
    const primeiro = Object.keys(errs)[0];
    if (!primeiro) return;
    setTimeout(() => {
      document.querySelector(`[data-field="${primeiro}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errs = validateFields();
    if (Object.keys(errs).length) {
      setError('Revise os campos destacados abaixo.');
      aplicarErros(errs);
      return;
    }

    setError('');
    setFieldErrors({});
    setLoading(true);

    const telefone = form.branchPhone.trim();
    // O endereço vem da Receita quando ela responde, e fica vazio quando não —
    // em nenhum dos dois casos ele é pedido. O checklist de primeiros passos
    // cobra o endereço quando ele passa a importar (vitrine, mapa, agenda).
    const branch = telefone || dadosDaReceita.addressLine
      ? {
          ...(telefone ? { phone: telefone } : {}),
          ...(dadosDaReceita.postalCode?.length === 8 ? { postalCode: dadosDaReceita.postalCode } : {}),
          ...(dadosDaReceita.addressLine && dadosDaReceita.addressLine.length >= 3
            ? { addressLine: dadosDaReceita.addressLine } : {}),
          ...(dadosDaReceita.addressNumber ? { addressNumber: dadosDaReceita.addressNumber } : {}),
          ...(dadosDaReceita.neighborhood && dadosDaReceita.neighborhood.length >= 2
            ? { neighborhood: dadosDaReceita.neighborhood } : {}),
          ...(dadosDaReceita.city && dadosDaReceita.city.length >= 2 ? { city: dadosDaReceita.city } : {}),
          ...(dadosDaReceita.state?.length === 2 ? { state: dadosDaReceita.state } : {}),
        }
      : undefined;

    try {
      const data = await api<{ accessToken: string; user: AuthUser }>('/auth/signup-tenant', {
        method: 'POST',
        body: JSON.stringify({
          ...(form.inviteToken.trim() ? { inviteToken: form.inviteToken.trim() } : {}),
          tenant: {
            cnpj:      form.cnpj,
            tradeName: form.tradeName.trim(),
            ...(dadosDaReceita.legalName ? { legalName: dadosDaReceita.legalName } : {}),
          },
          admin: {
            fullName: form.adminFullName.trim(),
            email:    form.adminEmail.trim(),
            password: form.adminPassword,
          },
          ...(branch ? { branch } : {}),
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

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm w-full max-w-lg">

      {/* Cabeçalho */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Cadastrar concessionária</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {DURACAO_DO_TRIAL_DIAS} dias grátis, sem cartão de crédito. Leva um minuto.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* O convite deixou de ser exigido, mas quem chega com um continua
            entrando por ele — e a conta nasce com o e-mail já verificado. */}
        {form.inviteToken && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
            <Check size={13} className="shrink-0 mt-0.5" />
            <span>Convite reconhecido — seu e-mail já entra confirmado.</span>
          </div>
        )}

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
              inputMode="numeric"
              className={fieldErrors.cnpj ? inputErrCls : inputCls}
            />
            <div className="absolute right-3 top-[19px] -translate-y-1/2">
              {cnpjStatus === 'loading' && <Loader2 size={14} className="animate-spin text-slate-400" />}
              {cnpjStatus === 'valid'   && <Check size={14} className="text-emerald-500" />}
              {cnpjStatus === 'inactive' && <AlertCircle size={14} className="text-red-500" />}
            </div>
          </div>
          {fieldErrors.cnpj && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.cnpj}</p>}
          {!fieldErrors.cnpj && cnpjStatus === 'valid' && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
              <Check size={11} /> CNPJ ativo na Receita Federal
            </p>
          )}
          {!fieldErrors.cnpj && cnpjStatus === 'inactive' && (
            <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
              <AlertCircle size={11} /> CNPJ com situação inativa ou suspensa na Receita Federal
            </p>
          )}
          {/* Indisponível NÃO é reprovação: a mensagem diz isso em voz alta,
              porque antes este caso fechava a porta sem explicação. */}
          {!fieldErrors.cnpj && cnpjStatus === 'indisponivel' && (
            <p className="text-xs text-slate-500 mt-1 flex items-start gap-1">
              <Info size={11} className="shrink-0 mt-0.5" />
              Não conseguimos consultar a Receita agora — pode seguir normalmente.
            </p>
          )}
        </div>

        <Field label="Nome da loja" value={form.tradeName} name="tradeName" error={fieldErrors.tradeName} required
          onChange={(v) => set('tradeName', v)} placeholder="Garagem Central"
          hint="É como sua loja aparece para os clientes. Dá para mudar depois." />

        <div className="pt-1 border-t border-slate-100 dark:border-slate-800" />

        <Field label="Seu nome" value={form.adminFullName} name="adminFullName" error={fieldErrors.adminFullName} required
          onChange={(v) => set('adminFullName', v)} placeholder="João Silva" autoComplete="name" />

        <Field label="E-mail" value={form.adminEmail} name="adminEmail" error={fieldErrors.adminEmail} required
          onChange={(v) => set('adminEmail', v)} type="email"
          placeholder="voce@suaempresa.com.br" autoComplete="email"
          hint="Será seu login no painel." />

        <Field label="Senha" value={form.adminPassword} name="adminPassword" error={fieldErrors.adminPassword} required
          onChange={(v) => set('adminPassword', v)} type="password"
          placeholder="Mínimo de 8 caracteres" autoComplete="new-password" />

        <div data-field="branchPhone">
          <label className="block text-sm font-medium mb-1.5">Telefone da loja</label>
          <input
            value={form.branchPhone}
            onChange={(e) => set('branchPhone', fmtPhone(e.target.value))}
            placeholder="(11) 3000-0000"
            className={fieldErrors.branchPhone ? inputErrCls : inputCls}
            type="tel"
            autoComplete="tel"
          />
          {fieldErrors.branchPhone
            ? <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.branchPhone}</p>
            : <p className="text-xs text-slate-400 mt-1">Opcional. Aparece no catálogo quando você publicar um carro.</p>}
        </div>

        {/* Erro */}
        {error && (
          <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2.5">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full flex items-center justify-center gap-1.5 bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? <><Loader2 size={14} className="animate-spin" /> Criando conta…</> : <><Check size={14} /> Criar conta grátis</>}
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-slate-400">
        O resto — endereço, horário e logo — você preenche dentro do painel, quando quiser.
      </p>

      <p className="mt-3 text-center text-xs text-slate-400">
        Ao criar a conta, você concorda com os{' '}
        <Link href="/termos" className="text-blue-600 hover:underline">Termos de Uso</Link> e a{' '}
        <Link href="/privacidade" className="text-blue-600 hover:underline">Política de Privacidade</Link>.
      </p>

      <p className="mt-5 text-center text-sm text-slate-500">
        Já tem conta?{' '}
        <Link href="/login" className="text-blue-600 hover:underline font-medium">Entrar</Link>
      </p>
    </div>
  );
}
