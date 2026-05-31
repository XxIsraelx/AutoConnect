'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import type { DealershipPin } from './types';
import {
  MapPin, List, Map as MapIcon, LogOut,
  LayoutDashboard, Loader2, ChevronDown, User, UserCircle,
  LocateFixed, X,
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

  /* ── Geolocalização ─────────────────────────────────────── */
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geoLoading, setGeoLoading]     = useState(false);
  const [geoBannerDismissed, setGeoBannerDismissed] = useState(false);

  /* ── Busca global de veículos — IDs de tenants com match ── */
  const [matchingTenantIds, setMatchingTenantIds] = useState<Set<string> | null>(null);

  /* ── Raio de busca (km) ─────────────────────────────────── */
  const [radiusKm, setRadiusKm] = useState<number | null>(null);

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

  /** Solicita GPS ao navegador e, ao receber, atualiza userLocation */
  function handleLocate() {
    if (!navigator.geolocation) {
      alert('Geolocalização não é suportada neste navegador.');
      return;
    }
    // Se já temos localização, limpar (toggle)
    if (userLocation) {
      setUserLocation(null);
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoLoading(false);
      },
      (err) => {
        console.warn('Geolocation error:', err.message);
        setGeoLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          alert('Permissão de localização negada. Habilite nas configurações do navegador.');
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  const handleMatchingTenantsChange = useCallback((ids: Set<string> | null) => {
    setMatchingTenantIds(ids);
  }, []);

  const handleRadiusChange = useCallback((km: number | null) => {
    setRadiusKm(km);
  }, []);

  /* ── Deep link: /buscar?dealer=ID ──────────────────────── */
  useEffect(() => {
    if (pins.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const dealerId = params.get('dealer');
    if (dealerId) {
      const pin = pins.find(p => p.id === dealerId);
      if (pin) {
        setSelected(pin);
        setMobile('list');
      }
    }
  }, [pins]);

  const withCoords = pins.filter(p => p.latitude !== null && p.longitude !== null);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0f172a]">

      {/* ── HEADER ─────────────────────────────────────────── */}
      <header className="h-14 bg-[#0f172a] border-b border-white/[.06] flex items-center px-4 gap-3 shrink-0 relative z-[900]">

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
                <div className="fixed inset-0 z-[1000]" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 w-56 bg-[#1e293b] rounded-xl
                                border border-white/[.08] shadow-2xl z-[1001] overflow-hidden py-1">
                  <div className="px-4 py-2.5 border-b border-white/[.06]">
                    <p className="text-xs font-semibold text-white truncate">{user.fullName}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                  {user.role === 'customer' && (
                    <Link
                      href="/perfil"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-300
                                 hover:bg-white/[.05] hover:text-white transition-colors"
                    >
                      <UserCircle size={14} className="text-slate-600" />
                      Meu Perfil
                    </Link>
                  )}
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

      {/* ── Banner de geolocalização (discreto) ────────────── */}
      {!userLocation && !geoBannerDismissed && (
        <div className="bg-blue-600/10 border-b border-blue-500/20 px-4 py-2 flex items-center gap-3 shrink-0">
          <MapPin size={14} className="text-blue-400 shrink-0" />
          <p className="text-xs text-slate-300 flex-1">
            Quer ver as lojas e veículos <span className="font-semibold text-white">mais perto de você</span>?
          </p>
          <button
            onClick={handleLocate}
            disabled={geoLoading}
            className="flex items-center gap-1.5 text-xs font-semibold bg-blue-600 text-white px-3 py-1.5
                       rounded-lg hover:bg-blue-500 transition disabled:opacity-50 shrink-0"
          >
            {geoLoading ? <Loader2 size={12} className="animate-spin" /> : <LocateFixed size={12} />}
            Usar minha localização
          </button>
          <button
            onClick={() => setGeoBannerDismissed(true)}
            className="text-slate-500 hover:text-slate-300 transition shrink-0"
            title="Dispensar"
          >
            <X size={14} />
          </button>
        </div>
      )}

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
              userLocation={userLocation}
              geoLoading={geoLoading}
              onLocate={handleLocate}
              onMatchingTenantsChange={handleMatchingTenantsChange}
              onRadiusChange={handleRadiusChange}
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
              userLocation={userLocation}
              matchingTenantIds={matchingTenantIds}
              radiusKm={radiusKm}
            />
          )}

          {/* Empty state (sem coords) */}
          {!loading && !fetchError && withCoords.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-[900] bg-[#0f172a]/90 backdrop-blur-sm">
              <div className="bg-[#1e293b] border border-white/[.08] rounded-2xl p-8 shadow-2xl text-center max-w-xs mx-4">
                <MapPin size={40} className="text-white/10 mx-auto mb-3" />
                <h3 className="font-bold text-white mb-1">Ainda sem pins no mapa</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Nenhuma concessionária com localização por aqui ainda. Volte em breve!
                </p>
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
