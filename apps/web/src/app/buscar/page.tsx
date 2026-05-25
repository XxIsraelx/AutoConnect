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

/* Leaflet só roda no browser — fundo escuro igual ao dark map */
const MapClient = dynamic(() => import('./MapClient'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center bg-[#0f172a]">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="animate-spin text-blue-500" size={36} />
        <span className="text-sm">Carregando mapa…</span>
      </div>
    </div>
  ),
});

export default function BuscarPage() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  const [pins, setPins] = useState<DealershipPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DealershipPin | null>(null);

  /* Mobile: alterna entre "map" e "list" */
  const [mobileView, setMobileView] = useState<'map' | 'list'>('map');

  /* Dropdown do usuário */
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    api<DealershipPin[]>('/map/dealerships')
      .then(setPins)
      .catch((err: unknown) =>
        setFetchError(err instanceof Error ? err.message : 'Erro ao carregar mapa'),
      )
      .finally(() => setLoading(false));
  }, []);

  function handleSelectPin(pin: DealershipPin | null) {
    setSelected(pin);
    // No mobile, ao selecionar pin pelo mapa → mostra o painel
    if (pin) setMobileView('list');
  }

  const withCoords = pins.filter((p) => p.latitude !== null && p.longitude !== null);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50">

      {/* ────────────────── HEADER ────────────────── */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-4 shrink-0 shadow-sm z-50">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <MapPin size={14} className="text-white" />
          </div>
          <span className="font-extrabold text-slate-800 text-base tracking-tight hidden sm:block">
            AutoConnect
          </span>
        </Link>

        {/* Título da página */}
        <div className="hidden md:flex items-center gap-1.5 text-sm text-slate-500">
          <span className="text-slate-300">/</span>
          <span className="font-medium text-slate-700">Buscar concessionárias</span>
        </div>

        {/* Badge de resultado */}
        <div className="hidden sm:flex items-center gap-1.5 text-xs bg-slate-100 text-slate-500 rounded-full px-3 py-1 select-none">
          {loading ? (
            <><Loader2 size={11} className="animate-spin" /> Carregando…</>
          ) : (
            <><MapPin size={11} className="text-blue-500" />
              {withCoords.length} no mapa · {pins.length} total</>
          )}
        </div>

        <div className="flex-1" />

        {/* Toggle mobile mapa/lista */}
        <div className="flex md:hidden items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => setMobileView('map')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all
              ${mobileView === 'map' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
          >
            <MapIcon size={13} /> Mapa
          </button>
          <button
            onClick={() => setMobileView('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all
              ${mobileView === 'list' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
          >
            <List size={13} /> Lista
          </button>
        </div>

        {/* Área do usuário */}
        {user ? (
          <div className="relative shrink-0">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors text-sm"
            >
              <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                <User size={13} className="text-blue-600" />
              </div>
              <span className="font-medium text-slate-700 hidden sm:block max-w-[120px] truncate">
                {user.fullName.split(' ')[0]}
              </span>
              <ChevronDown size={13} className="text-slate-400" />
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 w-52 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden py-1">
                  <div className="px-4 py-2.5 border-b border-slate-100">
                    <p className="text-xs font-semibold text-slate-800 truncate">{user.fullName}</p>
                    <p className="text-xs text-slate-400 truncate">{user.email}</p>
                  </div>
                  {user.role !== 'customer' && (
                    <Link
                      href="/dashboard"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <LayoutDashboard size={14} className="text-slate-400" />
                      Dashboard
                    </Link>
                  )}
                  <button
                    onClick={() => { clear(); setUserMenuOpen(false); }}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors w-full text-left"
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
              className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors font-medium"
            >
              Entrar
            </Link>
            <Link
              href="/cadastrar"
              className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 transition-colors font-semibold"
            >
              Criar conta
            </Link>
          </div>
        )}
      </header>

      {/* ────────────────── CORPO ────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── SIDEBAR (desktop sempre visível; mobile toggle) ── */}
        <aside
          className={`
            w-full md:w-[380px] md:shrink-0
            bg-white border-r border-slate-200
            flex flex-col overflow-hidden
            ${mobileView === 'list' ? 'flex' : 'hidden md:flex'}
          `}
        >
          {fetchError ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
              <div>
                <p className="text-red-500 font-medium text-sm mb-2">{fetchError}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Tentar novamente
                </button>
              </div>
            </div>
          ) : (
            <Sidebar
              pins={pins}
              loading={loading}
              selected={selected}
              onSelect={handleSelectPin}
            />
          )}
        </aside>

        {/* ── MAPA ── */}
        <main
          className={`
            flex-1 relative overflow-hidden
            ${mobileView === 'map' ? 'flex' : 'hidden md:flex'}
            flex-col
          `}
        >
          {fetchError ? (
            <div className="h-full flex items-center justify-center bg-slate-100">
              <p className="text-slate-500 text-sm">Erro ao carregar mapa</p>
            </div>
          ) : (
            <MapClient
              pins={pins}
              selectedId={selected?.id ?? null}
              onSelect={handleSelectPin}
            />
          )}

          {/* Floating: sem concessionárias no mapa */}
          {!loading && !fetchError && withCoords.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-[900] bg-[#0f172a]/90 backdrop-blur-sm">
              <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 shadow-2xl text-center max-w-xs mx-4">
                <MapPin size={40} className="text-slate-600 mx-auto mb-3" />
                <h3 className="font-bold text-slate-200 mb-1">Ainda sem pins no mapa</h3>
                <p className="text-sm text-slate-400 leading-relaxed mb-5">
                  Concessionárias precisam informar cidade e estado para aparecer aqui.
                </p>
                <Link
                  href="/signup"
                  className="inline-block bg-blue-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-900"
                >
                  Cadastrar minha concessionária
                </Link>
              </div>
            </div>
          )}

          {/* Botão flutuante: abrir sidebar no mobile quando vê mapa */}
          {mobileView === 'map' && !loading && pins.length > 0 && (
            <button
              onClick={() => setMobileView('list')}
              className="
                absolute bottom-6 left-1/2 -translate-x-1/2
                md:hidden z-[1000]
                flex items-center gap-2
                bg-slate-900 text-white text-sm font-semibold
                px-5 py-3 rounded-2xl shadow-lg
                hover:bg-slate-800 transition-colors
              "
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
