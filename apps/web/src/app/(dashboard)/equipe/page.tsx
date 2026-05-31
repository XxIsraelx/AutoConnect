'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  UserPlus, Mail, Clock, Shield, User, Trash2,
  RefreshCw, Copy, CheckCheck, X, Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';

/* ── Tipos ──────────────────────────────────────────────── */
interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
  acceptUrl?: string;
}

const ROLE_LABELS: Record<string, string> = {
  tenant_admin: 'Administrador',
  manager: 'Gerente',
  salesperson: 'Vendedor',
  receptionist: 'Recepcionista',
};

const ROLE_COLORS: Record<string, string> = {
  tenant_admin: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
  manager: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  salesperson: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  receptionist: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
};

/* ── Modal de convite ───────────────────────────────────── */
function InviteModal({ onClose, onSuccess, token }: {
  onClose: () => void;
  onSuccess: (inv: Invitation) => void;
  token: string;
}) {
  const [email, setEmail] = useState('');
  const [role,  setRole]  = useState('salesperson');
  const [loading, setLoading] = useState(false);
  const [error, setError]    = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const inv = await api<Invitation>('/invitations', { token, method: 'POST', body: { email, role } });
      onSuccess(inv);
    } catch (err: unknown) {
      setError((err as { message?: string }).message ?? 'Erro ao criar convite');
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="font-semibold">Convidar membro</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block mb-1">E-mail</label>
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="vendedor@empresa.com"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block mb-1">Função</label>
            <select
              value={role} onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="salesperson">Vendedor</option>
              <option value="manager">Gerente</option>
              <option value="receptionist">Recepcionista</option>
              <option value="tenant_admin">Administrador</option>
            </select>
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
              {loading && <Loader2 size={14} className="animate-spin" />}
              Convidar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Página principal ───────────────────────────────────── */
export default function EquipePage() {
  const { token } = useAuthStore();
  const [members,     setMembers]     = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showModal,   setShowModal]   = useState(false);
  const [copiedId,    setCopiedId]    = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [m, inv] = await Promise.all([
        api<TeamMember[]>('/users', { token }),
        api<Invitation[]>('/invitations', { token }),
      ]);
      setMembers(m);
      setInvitations(inv);
    } catch { /* ignora */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function revokeInvitation(id: string) {
    if (!token) return;
    await api(`/invitations/${id}`, { token, method: 'DELETE' });
    setInvitations((prev) => prev.filter((i) => i.id !== id));
  }

  function copyLink(inv: Invitation) {
    if (!inv.acceptUrl) return;
    navigator.clipboard.writeText(inv.acceptUrl);
    setCopiedId(inv.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function onInvited(inv: Invitation) {
    setInvitations((prev) => [inv, ...prev]);
    setShowModal(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 size={20} className="animate-spin mr-2" />
        Carregando equipe…
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Equipe</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gerencie os membros da sua concessionária</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
        >
          <UserPlus size={14} />
          Convidar
        </button>
      </div>

      {/* Membros ativos */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-semibold">Membros ativos ({members.length})</h2>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <span className="text-blue-600 dark:text-blue-400 text-sm font-bold">
                  {m.fullName?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{m.fullName}</p>
                <p className="text-xs text-slate-500 truncate">{m.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full font-medium',
                  ROLE_COLORS[m.role] ?? 'bg-slate-100 text-slate-600',
                )}>
                  {ROLE_LABELS[m.role] ?? m.role}
                </span>
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  m.status === 'active'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-slate-100 text-slate-500',
                )}>
                  {m.status === 'active' ? 'Ativo' : m.status}
                </span>
              </div>
              <div className="text-xs text-slate-400 hidden md:block w-32 text-right shrink-0">
                {m.lastLoginAt
                  ? new Date(m.lastLoginAt).toLocaleDateString('pt-BR')
                  : 'Nunca acessou'}
              </div>
            </div>
          ))}
          {members.length === 0 && (
            <div className="py-10 text-center text-slate-500 text-sm">Nenhum membro ainda</div>
          )}
        </div>
      </div>

      {/* Convites pendentes */}
      {invitations.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-sm font-semibold">Convites pendentes ({invitations.length})</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {invitations.map((inv) => {
              const expired = new Date(inv.expiresAt) < new Date();
              return (
                <div key={inv.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <Mail size={14} className="text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{inv.email}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Clock size={10} />
                      {expired ? 'Expirado' : `Expira ${new Date(inv.expiresAt).toLocaleDateString('pt-BR')}`}
                    </p>
                  </div>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-medium',
                    ROLE_COLORS[inv.role] ?? 'bg-slate-100 text-slate-600',
                  )}>
                    {ROLE_LABELS[inv.role] ?? inv.role}
                  </span>
                  <div className="flex items-center gap-1">
                    {inv.acceptUrl && (
                      <button
                        onClick={() => copyLink(inv)}
                        className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-500"
                        title="Copiar link"
                      >
                        {copiedId === inv.id ? <CheckCheck size={14} className="text-emerald-500" /> : <Copy size={14} />}
                      </button>
                    )}
                    <button
                      onClick={() => revokeInvitation(inv.id)}
                      className="p-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/20 hover:text-rose-500 transition text-slate-500"
                      title="Revogar convite"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showModal && token && (
        <InviteModal token={token} onClose={() => setShowModal(false)} onSuccess={onInvited} />
      )}
    </div>
  );
}
