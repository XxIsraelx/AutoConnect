'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Car, Users, TrendingUp, ArrowRight, ArrowUpRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import dynamic from 'next/dynamic';
import type { GalaxyCustomer } from './GalaxyMap';

const GalaxyMap = dynamic(() => import('./GalaxyMap'), { ssr: false });

interface TenantData {
  tenant: {
    id: string;
    tradeName: string;
    legalName: string;
    slug: string;
    primaryEmail: string;
    subscription: { plan: string; status: string } | null;
    branches: { id: string; city: string | null; state: string | null }[];
  } | null;
}

interface DashStats {
  vehiclesCount: number;
  leadsToday: number;
  leadsNew: number;
}

interface ProximityData {
  interested: GalaxyCustomer[];
  registered: GalaxyCustomer[];
  dealerCity: string | null;
  dealerState: string | null;
}

function StatCard({
  label,
  value,
  icon: Icon,
  href,
  loading,
  accent,
  badge,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  href: string;
  loading: boolean;
  accent?: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="group relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200
                 dark:border-slate-800 p-5 hover:border-blue-300 dark:hover:border-blue-700
                 hover:shadow-md transition-all duration-200 overflow-hidden"
    >
      {/* Glow sutil no hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-blue-500/0
                      group-hover:from-blue-500/[.03] group-hover:to-transparent
                      transition-all duration-300 pointer-events-none" />

      <div className="flex items-start justify-between mb-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center
          ${accent ?? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
          <Icon size={17} />
        </div>
        {badge !== undefined && badge > 0 && (
          <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5
                           bg-blue-600 text-white text-[10px] font-bold rounded-full">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        <ArrowUpRight size={14} className="text-slate-300 dark:text-slate-700
                                           group-hover:text-blue-400 transition-colors" />
      </div>

      {loading ? (
        <div className="h-8 w-16 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse mb-1" />
      ) : (
        <p className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {value}
        </p>
      )}
      <p className="text-xs font-medium text-slate-500 mt-1">{label}</p>
    </Link>
  );
}

export default function DashboardPage() {
  const { token, user } = useAuthStore();

  const { data: tenantData, isLoading: loadingTenant } = useQuery({
    queryKey: ['tenant-me'],
    queryFn: () => api<TenantData>('/tenant/me', { token: token! }),
    enabled: !!token,
  });

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['tenant-stats'],
    queryFn: () => api<DashStats>('/tenant/stats', { token: token! }),
    enabled: !!token,
    refetchInterval: 60_000,
  });

  const { data: proximity } = useQuery({
    queryKey: ['users-proximity'],
    queryFn: () => api<ProximityData>('/tenant/users-proximity', { token: token! }),
    enabled: !!token,
    staleTime: 5 * 60_000,
  });

  const [galaxyMode, setGalaxyMode] = useState<'interested' | 'registered'>('interested');

  const tenant    = tenantData?.tenant;
  const firstName = user?.fullName?.split(' ')[0] ?? 'lá';
  const location  = tenant?.branches[0]
    ? [tenant.branches[0].city, tenant.branches[0].state].filter(Boolean).join(', ')
    : null;

  const statCards = [
    {
      label:   'Veículos disponíveis',
      value:   stats?.vehiclesCount ?? '—',
      icon:    Car,
      href:    '/veiculos',
      accent:  'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400',
    },
    {
      label:   'Leads hoje',
      value:   stats?.leadsToday ?? '—',
      icon:    TrendingUp,
      href:    '/leads',
      accent:  'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
    {
      label:   'Aguardando resposta',
      value:   stats?.leadsNew ?? '—',
      icon:    Users,
      href:    '/leads',
      accent:  stats?.leadsNew
        ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
      badge:   stats?.leadsNew,
    },
  ];

  return (
    <div className="p-8 max-w-5xl">

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Olá, {firstName} 👋
          </h1>
        </div>
        {loadingTenant ? (
          <div className="h-4 w-48 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
        ) : tenant ? (
          <p className="text-sm text-slate-500">
            {tenant.tradeName}
            {location && <span className="text-slate-400"> · {location}</span>}
            <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold
                             bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400
                             px-2 py-0.5 rounded-full capitalize">
              <Sparkles size={9} />
              {tenant.subscription?.plan ?? 'trial'}
            </span>
          </p>
        ) : null}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {statCards.map(({ label, value, icon, href, accent, badge }) => (
          <StatCard
            key={label}
            label={label}
            value={value}
            icon={icon}
            href={href}
            loading={loadingStats}
            accent={accent}
            badge={badge}
          />
        ))}
      </div>

      {/* Atalhos rápidos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Link
          href="/veiculos/novo"
          className="group flex items-center gap-4 p-5 bg-white dark:bg-slate-900
                     rounded-2xl border border-slate-200 dark:border-slate-800
                     hover:border-blue-300 dark:hover:border-blue-700
                     hover:shadow-md transition-all duration-200"
        >
          <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center shrink-0
                          shadow-lg shadow-blue-600/25 group-hover:scale-105 transition-transform">
            <Car size={20} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white">Adicionar veículo</p>
            <p className="text-xs text-slate-500 mt-0.5">Cadastrar novo veículo no estoque</p>
          </div>
          <ArrowRight size={16} className="ml-auto text-slate-300 group-hover:text-blue-500
                                           group-hover:translate-x-0.5 transition-all shrink-0" />
        </Link>

        <Link
          href="/leads"
          className="group flex items-center gap-4 p-5 bg-white dark:bg-slate-900
                     rounded-2xl border border-slate-200 dark:border-slate-800
                     hover:border-blue-300 dark:hover:border-blue-700
                     hover:shadow-md transition-all duration-200"
        >
          <div className="relative w-11 h-11 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0
                          shadow-lg shadow-emerald-500/25 group-hover:scale-105 transition-transform">
            <Users size={20} className="text-white" />
            {(stats?.leadsNew ?? 0) > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-600 text-white
                               text-[10px] font-bold rounded-full flex items-center justify-center
                               border-2 border-white dark:border-slate-900">
                {stats!.leadsNew > 9 ? '9+' : stats!.leadsNew}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white">Ver leads</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {(stats?.leadsNew ?? 0) > 0
                ? `${stats!.leadsNew} novo${stats!.leadsNew !== 1 ? 's' : ''} aguardando resposta`
                : 'Gerenciar contatos de clientes'}
            </p>
          </div>
          <ArrowRight size={16} className="ml-auto text-slate-300 group-hover:text-blue-500
                                           group-hover:translate-x-0.5 transition-all shrink-0" />
        </Link>
      </div>

      {/* Bottom row: Dados + Galaxy Map */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Dados da concessionária */}
        {tenant && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200
                          dark:border-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-900 dark:text-white">
                Dados da concessionária
              </h2>
              <Link
                href="/configuracoes"
                className="text-xs text-blue-500 hover:text-blue-600 font-medium transition-colors"
              >
                Editar →
              </Link>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-400 mb-0.5">Razão social</dt>
                <dd className="font-medium truncate">{tenant.legalName}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400 mb-0.5">Nome fantasia</dt>
                <dd className="font-medium truncate">{tenant.tradeName}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400 mb-0.5">Slug</dt>
                <dd className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded inline-block">
                  {tenant.slug}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400 mb-0.5">E-mail</dt>
                <dd className="font-medium truncate">{tenant.primaryEmail}</dd>
              </div>
            </dl>
          </div>
        )}

        {/* Galaxy Map */}
        <div className="rounded-2xl border border-blue-900/40 overflow-hidden relative
                        shadow-lg shadow-blue-950/30"
             style={{
               minHeight: 400,
               background:
                 'linear-gradient(140deg, #0b1120 0%, #0f1830 38%, #13203f 68%, #1a1d4a 100%)',
             }}>
          {/* Glow superior decorativo */}
          <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full
                          bg-blue-600/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-16 w-64 h-64 rounded-full
                          bg-indigo-600/10 blur-3xl pointer-events-none" />
          {/* Header */}
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between
                          gap-3 px-5 pt-4 pb-2 pointer-events-none">
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0">
                <h2 className="text-sm font-semibold text-white leading-tight">Alcance de clientes</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {proximity
                    ? `${proximity.dealerCity ?? 'Sua loja'}${proximity.dealerState ? '/' + proximity.dealerState : ''}`
                    : 'Carregando…'}
                </p>
              </div>

              {/* Toggle de modo: interesse × cadastrados */}
              {proximity && (
                <div className="pointer-events-auto flex items-center gap-1
                                bg-slate-900/70 backdrop-blur-sm rounded-full p-1
                                border border-white/[.08]">
                  {([
                    { key: 'interested', label: 'Com interesse', count: proximity.interested.length },
                    { key: 'registered', label: 'Cadastrados',   count: proximity.registered.length },
                  ] as const).map((m) => {
                    const active = galaxyMode === m.key;
                    return (
                      <button
                        key={m.key}
                        onClick={() => setGalaxyMode(m.key)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px]
                                    font-semibold transition-all whitespace-nowrap
                          ${active
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        {m.label}
                        <span className={`flex items-center justify-center min-w-[16px] h-[15px] px-1
                                          rounded-full text-[9px]
                          ${active ? 'bg-blue-500/60 text-white' : 'bg-white/[.06] text-slate-500'}`}>
                          {m.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider
                               hidden sm:inline">
                ao vivo
              </span>
            </div>
          </div>

          {/* Canvas area */}
          <div className="pt-12 w-full" style={{ height: 400 }}>
            {proximity ? (
              <GalaxyMap
                interested={proximity.interested}
                registered={proximity.registered}
                mode={galaxyMode}
                dealerInitials={
                  tenant?.tradeName
                    ? tenant.tradeName.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
                    : '??'
                }
              />
            ) : (
              /* skeleton */
              <div className="h-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-14 h-14 rounded-full bg-slate-800 animate-pulse" />
                  <div className="w-28 h-3 bg-slate-800 rounded-full animate-pulse" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
