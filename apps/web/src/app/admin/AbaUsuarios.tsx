'use client';

import { useState } from 'react';
import { Key, Ban, CheckCircle2, Building2, Briefcase } from 'lucide-react';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import {
  Carregando, ROLE_LABEL, Vazio, botaoIconeCls, botaoPrimarioCls, cartaoCls, fmtDate, inputCls,
  mensagemDaAcao, useCarga, type PropsDaAba,
} from './comum';
import type { UserRow } from './tipos';

export function AbaUsuarios({ chamar, avisar, sinal }: PropsDaAba) {
  const [busca, setBusca] = useState('');
  const [papel, setPapel] = useState('');
  // O filtro só vale ao clicar em "Filtrar" (ou Enter): é o que vai para a API.
  const [filtro, setFiltro] = useState({ busca: '', papel: '' });

  const { dados, setDados, erro, carregando, recarregar } = useCarga(() => {
    const params = new URLSearchParams();
    if (filtro.papel) params.set('role', filtro.papel);
    if (filtro.busca) params.set('search', filtro.busca);
    const qs = params.toString();
    return chamar<UserRow[]>(`/admin/users${qs ? `?${qs}` : ''}`);
  }, sinal, `${filtro.papel}|${filtro.busca}`);

  function filtrar() {
    const novo = { busca: busca.trim(), papel };
    // Mesmo filtro de novo: a chave não muda, então recarrega explicitamente.
    if (novo.busca === filtro.busca && novo.papel === filtro.papel) void recarregar();
    else setFiltro(novo);
  }

  async function alternarSuspensao(id: string) {
    try {
      const u = await chamar<UserRow>(`/admin/users/${id}/suspend`, { method: 'PATCH' });
      setDados((p) => (p ?? []).map((x) => x.id === id ? { ...x, status: u.status } : x));
      avisar(u.status === 'suspended' ? 'Usuário suspenso' : 'Usuário reativado');
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao alterar o usuário'), 'error');
    }
  }

  async function enviarReset(id: string) {
    try {
      const { message } = await chamar<{ message: string }>(`/admin/users/${id}/reset-password`, { method: 'POST' });
      avisar(message);
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao enviar a redefinição'), 'error');
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap gap-2 sm:gap-3">
        <input
          value={busca} onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && filtrar()}
          placeholder="Buscar por nome ou e-mail…"
          className={`${inputCls} flex-1 basis-full sm:basis-auto`}
        />
        <select value={papel} onChange={(e) => setPapel(e.target.value)} className={`${inputCls} flex-1 sm:flex-none sm:w-44`}>
          <option value="">Todos os papéis</option>
          <option value="tenant_admin">Admin</option>
          <option value="manager">Gerente</option>
          <option value="salesperson">Vendedor</option>
          <option value="customer">Cliente</option>
        </select>
        <button onClick={filtrar} className={botaoPrimarioCls}>Filtrar</button>
      </div>

      <div className={`${cartaoCls} overflow-hidden`}>
        {erro ? (
          <ErroAoCarregar erro={erro} onTentarNovamente={recarregar} carregando={carregando} contexto="os usuários" />
        ) : !dados || carregando ? (
          <Carregando />
        ) : dados.length === 0 ? (
          <Vazio>Nenhum usuário</Vazio>
        ) : dados.map((u, i) => (
          <div key={u.id} className={`flex items-start gap-3 p-4 ${i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : ''}`}>
            <div className="hidden sm:flex w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 items-center justify-center shrink-0">
              <span className="text-sm font-bold text-slate-500">{u.fullName.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="font-medium text-sm truncate max-w-full">{u.fullName}</p>
                {u.status === 'suspended' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-500/10 text-rose-500">Suspenso</span>}
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">{ROLE_LABEL[u.role] ?? u.role}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-slate-400">
                <span className="break-all">{u.email}</span>
                {u.tenant && <span className="inline-flex items-center gap-1"><Building2 size={11} />{u.tenant.tradeName}</span>}
                {u.jobTitle && <span className="inline-flex items-center gap-1"><Briefcase size={11} />{u.jobTitle}</span>}
                <span>Último acesso: {fmtDate(u.lastLoginAt)}</span>
              </div>
            </div>
            <div className="flex gap-0.5 shrink-0">
              <button onClick={() => enviarReset(u.id)} title="Enviar redefinição de senha" aria-label="Enviar redefinição de senha" className={`${botaoIconeCls} hover:text-blue-600`}>
                <Key size={14} />
              </button>
              <button onClick={() => alternarSuspensao(u.id)} title={u.status === 'suspended' ? 'Reativar' : 'Suspender'} aria-label={u.status === 'suspended' ? 'Reativar' : 'Suspender'}
                className={`p-2 rounded-lg transition text-slate-400 ${u.status === 'suspended' ? 'hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-500' : 'hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-500'}`}>
                {u.status === 'suspended' ? <CheckCircle2 size={14} /> : <Ban size={14} />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
