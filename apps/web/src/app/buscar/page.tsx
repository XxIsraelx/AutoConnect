'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import type { DealershipPin } from './types';
import {
  MapPin, List, Map as MapIcon, LogOut,
  LayoutDashboard, Loader2, ChevronDown, User,
} from 'lucide-react';
import Sidebar from './Sidebar';

/* Leaflet só roda no browser */
const MapClient = dynamic(() => import('./MapClient'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center bg-[#0f172a]">
      <div className="flex flex-col items-center gap-3 text-slate-600">
        <Loader2 className="animate-spin text-blue-500" size={36} />
        <span className="text-sm">Carregando mapa…</span>
      </div>
    </div>
  ),
});

export default function BuscarPage() {
  const user  = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  const [pins, setPins]           = useState<DealershipPin[]>([]);
  const [loading, setLoading]     = useState(true);
  const [fetchError, setError]    = useState<string | null>(null);
  const [selected, setSelected]   = useState<DealershipPin | null>(null);
  const [mobileView, setMobile]   = useState<'map' | 'list'>('map');
  const [menuOpen, setMenuOpen]   = useState(false);

  useEffect(() => {
    api<DealershipPin[]>('/map/dealerships')
      .then(setPins)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Erro ao carregar'))
      .finally(() => setLoading(false));
  }, []);

  function handleSelect(pin: DealershipPin | null) {
    setSelected(pin);
    if (pin) setMobile('list');
  }

  const withCoords = pins.filter(p => p.latitude !== null && p.longitude !== null);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0f172a]">

      {/* ── HEADER ─────────────────────────────────────────── */}
      <header className="h-14 bg-[#0f172a] border-b border-white/[.06] flex items-center px-4 gap-3 shrink-0 z-50">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/50">
            <MapPin size={14} className="text-white" />
          </div>
          <span className="font-extrabold text-white text-base tracking-tight hidden sm:block">
            AutoConnect
          </span>
        </Link>

        {/* Breadcrumb */}
        <div className="hidden md:flex items-center gap-1.5 text-sm">
          <span className="text-slate-700">/</span>
          <span className="font-medium text-slate-500">Buscar concessionárias</span>
        </div>

        {/* Badge de contagem */}
        <div className="hidden sm:flex items-center gap-1.5 text-xs bg-white/[.05] text-slate-500 rounded-full px-3 py-1 select-none">
          {loading ? (
            <><Loader2 size={11} className="animate-spin" /> Carregando…</>
          ) : (
            <><MapPin size={11} className="text-blue-500" />
              {withCoords.length} no mapa · {pins.length} total</>
          )}
        </div>

        <div className="flex-1" />

        {/* Toggle mobile */}
        <div className="flex md:hidden bg-white/[.06] rounded-lg p-0.5 gap-0.5">
          {(['map', 'list'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setMobile(v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all
                ${mobileView === v
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'}`}
            >
              {v === 'map' ? <><MapIcon size={12}/> Mapa</> : <><List size={12}/> Lista</>}
            </button>
          ))}
        </div>

        {/* Área do usuário */}
        {user ? (
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl
                         border border-white/[.08] bg-white/[.05]
                         hover:bg-white/[.08] hover:border-white/20
                         transition-all text-sm"
            >
              <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                <User size={12} className="text-blue-400" />
              </div>
              <span className="font-medium text-slate-300 hidden sm:block max-w-[120px] truncate">
                {user.fullName.split(' ')[0]}
              </span>
              <ChevronDown size={12} className="text-slate-600" />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 w-56 bg-[#1e293b] rounded-xl
                                border border-white/[.08] shadow-2xl z-50 overflow-hidden py-1">
                  <div className="px-4 py-2.5 border-b border-white/[.06]">
                    <p className="text-xs font-semibold text-white truncate">{user.fullName}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                  {user.role !== 'customer' && (
                    <Link
                      href="/dashboard"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-300
                                 hover:bg-white/[.05] hover:text-white transition-colors"
                    >
                      <LayoutDashboard size={14} className="text-slate-600" />
                      Dashboard
                    </Link>
                  )}
                  <button
                    onClick={() => { clear(); setMenuOpen(false); }}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-rose-400
                               hover:bg-rose-500/10 transition-colors w-full text-left"
                  >
                    <LogOut size={14} />
                    Sair da conta
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/entrar"
              className="text-sm text-slate-400 hover:text-white px-3 py-1.5
                         rounded-lg hover:bg-white/[.06] transition-all font-medium"
            >
              Entrar
            </Link>
            <Link
              href="/cadastrar"
              className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg
                         hover:bg-blue-500 transition-colors font-semibold
                         shadow-lg shadow-blue-900/50"
            >
              Criar conta
            </Link>
          </div>
        )}
      </header>

      {/* ── CORPO ──────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Sidebar — desktop sempre visível, mobile toggle */}
        <aside
          className={`
            w-full md:w-[380px] md:shrink-0
            border-r border-white/[.08]
            flex flex-col overflow-hidden
            ${mobileView === 'list' ? 'flex' : 'hidden md:flex'}
          `}
        >
          {fetchError ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center bg-[#0f172a]">
              <div>
                <p className="text-rose-400 font-medium text-sm mb-2">{fetchError}</p>
                <button onClick={() => window.location.reload()}
                        className="text-xs text-blue-400 hover:text-blue-300">
                  Tentar novamente
                </button>
              </div>
            </div>
          ) : (
            <Sidebar
              pins={pins}
              loading={loading}
              selected={selected}
              onSelect={handleSelect}
            />
          )}
        </aside>

        {/* Mapa */}
        <main
          className={`flex-1 relative overflow-hidden flex-col
            ${mobileView === 'map' ? 'flex' : 'hidden md:flex'}`}
        >
          {fetchError ? (
            <div className="h-full flex items-center justify-center bg-[#0f172a]">
              <p className="text-slate-600 text-sm">Erro ao carregar mapa</p>
            </div>
          ) : (
            <MapClient
              pins={pins}
              selectedId={selected?.id ?? null}
              onSelect={handleSelect}
            />
          )}

          {/* Empty state (sem coords) */}
          {!loading && !fetchError && withCoords.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-[900] bg-[#0f172a]/90 backdrop-blur-sm">
              <div className="bg-[#1e293b] border border-white/[.08] rounded-2xl p-8 shadow-2xl text-center max-w-xs mx-4">
                <MapPin size={40} className="text-white/10 mx-auto mb-3" />
                <h3 className="font-bold text-white mb-1">Ainda sem pins no mapa</h3>
                <p className="text-sm text-slate-500 leading-relaxed mb-5">
                  Concessionárias precisam informar cidade e estado.
                </p>
                <Link href="/signup"
                      className="inline-block bg-blue-600 text-white text-sm font-bold
                                 px-5 py-2.5 rounded-xl hover:bg-blue-500 transition
                                 shadow-lg shadow-blue-900/50">
                  Cadastrar concessionária
                </Link>
              </div>
            </div>
          )}

          {/* Botão flutuante mobile */}
          {mobileView === 'map' && !loading && pins.length > 0 && (
            <button
              onClick={() => setMobile('list')}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 md:hidden z-[1000]
                         flex items-center gap-2
                         bg-[#1e293b] text-white text-sm font-bold
                         px-5 py-3 rounded-2xl shadow-2xl border border-white/[.1]
                         hover:bg-[#334155] transition-colors"
            >
              <List size={15} />
              Ver {pins.length} concessionária{pins.length !== 1 ? 's' : ''}
            </button>
          )}
        </main>
      </div>
    </div>
  );
}
