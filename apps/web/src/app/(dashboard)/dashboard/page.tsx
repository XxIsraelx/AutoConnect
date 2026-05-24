'use client';

import { useQuery } from '@tanstack/react-query';
import { Car, Users, MessageSquare, CalendarDays, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface TenantData {
  tenant: {
    id: string;
    tradeName: string;
    legalName: string;
    slug: string;
    primaryEmail: string;
    subscription: { plan: string; status: string } | null;
  } | null;
}

const placeholderStats = [
  { label: 'Veículos no estoque', value: '—', icon: Car, href: '/veiculos' },
  { label: 'Leads hoje', value: '—', icon: Users, href: '/leads' },
  { label: 'Conversas abertas', value: '—', icon: MessageSquare, href: '/chat' },
  { label: 'Agendamentos hoje', value: '—', icon: CalendarDays, href: '/agendamentos' },
];

export default function DashboardPage() {
  const { token, user } = useAuthStore();

  const { data, isLoading } = useQuery({
    queryKey: ['tenant-me'],
    queryFn: () => api<TenantData>('/tenant/me', { token: token! }),
    enabled: !!token,
  });

  const tenant = data?.tenant;

  const firstName = user?.fullName?.split(' ')[0] ?? 'lá';

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Olá, {firstName} 👋</h1>
        {isLoading ? (
          <p className="text-slate-500 text-sm mt-1">Carregando…</p>
        ) : tenant ? (
          <p className="text-slate-500 text-sm mt-1">
            {tenant.tradeName} ·{' '}
            <span className="capitalize">
              {tenant.subscription?.plan ?? 'trial'} ({tenant.subscription?.status ?? 'ativo'})
            </span>
          </p>
        ) : null}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {placeholderStats.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5"
          >
            <div className="flex items-center gap-2 text-slate-400 mb-3">
              <Icon size={16} />
              <span className="text-xs font-medium">{label}</span>
            </div>
            <p className="text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {/* Next steps */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
        <h2 className="font-semibold mb-4">Próximos passos</h2>
        <div className="space-y-3">
          {[
            { label: 'Cadastrar primeiro veículo no estoque', href: '/veiculos', done: false },
            { label: 'Convidar vendedores para a equipe', href: '/configuracoes', done: false },
            { label: 'Configurar perfil da concessionária', href: '/configuracoes', done: false },
          ].map(({ label, href, done }) => (
            <Link
              key={label}
              href={href}
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition group"
            >
              <span
                className={`w-5 h-5 rounded-full border-2 shrink-0 ${
                  done
                    ? 'bg-green-500 border-green-500'
                    : 'border-slate-300 dark:border-slate-600'
                }`}
              />
              <span className={`text-sm ${done ? 'line-through text-slate-400' : ''}`}>
                {label}
              </span>
              <ArrowRight
                size={14}
                className="ml-auto text-slate-300 group-hover:text-slate-500 transition"
              />
            </Link>
          ))}
        </div>
      </div>

      {/* Tenant info */}
      {tenant && (
        <div className="mt-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
          <h2 className="font-semibold mb-4">Dados da concessionária</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-slate-400">Razão social</dt>
              <dd className="font-medium mt-0.5">{tenant.legalName}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Nome fantasia</dt>
              <dd className="font-medium mt-0.5">{tenant.tradeName}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Slug</dt>
              <dd className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded mt-0.5 inline-block">
                {tenant.slug}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">E-mail</dt>
              <dd className="font-medium mt-0.5">{tenant.primaryEmail}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
