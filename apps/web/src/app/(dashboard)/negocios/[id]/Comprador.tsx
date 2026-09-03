'use client';

import { useState } from 'react';
import { Contact, Check, Loader2 } from 'lucide-react';
import { formatarCpf } from '@autoconnect/shared';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { useSalvarComprador, type Comprador as Dados, type DealResumo } from '../dados';

/**
 * Qualificação do comprador para o contrato.
 *
 * O contrato não é emitido sem ela: um documento que diz "portador(a) do
 * documento ____" parece contrato e não identifica a parte. Os campos ficam no
 * negócio, não no perfil do cliente — se o cliente mudar o endereço depois, o
 * contrato assinado não muda junto.
 */
export default function Comprador({
  negocio, editavel,
}: {
  negocio: DealResumo;
  editavel: boolean;
}) {
  const salvar = useSalvarComprador(negocio.id);
  const b = negocio.buyer;

  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Dados>({
    // Prefill com o que já se sabe: o nome do cliente vinculado poupa digitação
    // e reduz divergência entre a conta e o contrato.
    fullName: b?.fullName ?? negocio.customer?.fullName ?? '',
    cpf: b?.cpf ?? '',
    rg: b?.rg ?? '', rgIssuer: b?.rgIssuer ?? '',
    nationality: b?.nationality ?? 'brasileiro(a)',
    maritalStatus: b?.maritalStatus ?? '', occupation: b?.occupation ?? '',
    addressLine: b?.addressLine ?? '', addressNumber: b?.addressNumber ?? '',
    neighborhood: b?.neighborhood ?? '', city: b?.city ?? '',
    state: b?.state ?? '', postalCode: b?.postalCode ?? '',
  });

  const campo = 'text-sm bg-transparent border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5';
  const set = (k: keyof Dados) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 md:col-span-2">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <Contact size={12} /> Qualificação do comprador
        </p>
        {editavel && (
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className="text-xs text-brand-accent"
          >
            {aberto ? 'fechar' : b ? 'editar' : 'preencher'}
          </button>
        )}
      </div>

      {!aberto && (
        b ? (
          <p className="text-sm">
            {b.fullName}
            <span className="text-slate-500"> · CPF {formatarCpf(b.cpf)}</span>
            {b.rg && <span className="text-slate-500"> · RG {b.rg}{b.rgIssuer ? ` ${b.rgIssuer}` : ''}</span>}
            {b.city && <span className="block text-xs text-slate-400 mt-0.5">
              {[b.addressLine, b.addressNumber].filter(Boolean).join(', ')}
              {b.neighborhood ? ` — ${b.neighborhood}` : ''} — {b.city}/{b.state}
            </span>}
          </p>
        ) : (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Sem estes dados o contrato não pode ser emitido: ele precisa identificar
            a parte compradora.
          </p>
        )
      )}

      {aberto && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={form.fullName} onChange={set('fullName')} placeholder="Nome completo *" className={campo} />
            <input value={form.cpf} onChange={set('cpf')} placeholder="CPF *" inputMode="numeric" className={campo} />
            <input value={form.rg ?? ''} onChange={set('rg')} placeholder="RG" className={campo} />
            <input value={form.rgIssuer ?? ''} onChange={set('rgIssuer')} placeholder="Órgão emissor (ex.: SSP/SP)" className={campo} />
            <input value={form.nationality ?? ''} onChange={set('nationality')} placeholder="Nacionalidade" className={campo} />
            <input value={form.maritalStatus ?? ''} onChange={set('maritalStatus')} placeholder="Estado civil" className={campo} />
            <input value={form.occupation ?? ''} onChange={set('occupation')} placeholder="Profissão" className={campo} />
            <input value={form.postalCode ?? ''} onChange={set('postalCode')} placeholder="CEP" className={campo} />
          </div>
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
            <input value={form.addressLine ?? ''} onChange={set('addressLine')} placeholder="Logradouro" className={campo} />
            <input value={form.addressNumber ?? ''} onChange={set('addressNumber')} placeholder="Número" className={campo} />
          </div>
          <div className="grid gap-2 sm:grid-cols-[2fr_2fr_1fr]">
            <input value={form.neighborhood ?? ''} onChange={set('neighborhood')} placeholder="Bairro" className={campo} />
            <input value={form.city ?? ''} onChange={set('city')} placeholder="Cidade" className={campo} />
            <input value={form.state ?? ''} onChange={set('state')} placeholder="UF" maxLength={2} className={campo} />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() =>
                salvar.mutate(
                  // Campos vazios saem do payload: o backend valida tamanho
                  // mínimo, e "" seria recusado onde `undefined` é aceito.
                  Object.fromEntries(
                    Object.entries(form).filter(([, v]) => String(v ?? '').trim() !== ''),
                  ) as Dados,
                  { onSuccess: () => setAberto(false) },
                )
              }
              disabled={salvar.isPending}
              className="text-sm bg-brand-accent text-white px-3 py-1.5 rounded-lg font-medium
                         hover:bg-blue-600 transition disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {salvar.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Salvar
            </button>
            <span className="text-xs text-slate-400">* obrigatórios</span>
          </div>
        </div>
      )}

      {salvar.error && (
        <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{textoDoErro(salvar.error)}</p>
      )}
    </div>
  );
}
