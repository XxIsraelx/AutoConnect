'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import type { DealershipPin } from './types';
import {
  MapPin, List, Map as MapIcon, LogOut,
  LayoutDashboard, Loader2, ChevronDown, User, UserCircle,
  LocateFixed, X,
} from 'lucide-react';
import Sidebar, { directionsUrl } from './Sidebar';
import HeaderActions from './HeaderActions';

const DEALER_ROLES = ['tenant_admin', 'manager', 'salesperson'];

/* Leaflet só roda no browser */
const MapClient = dynamic(() => import('./MapClient'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center sup-base">
      <div className="flex flex-col items-center gap-3 txt-tenue">
        <Loader2 className="animate-spin text-blue-500" size={36} />
        <span className="text-sm">Carregando mapa…</span>
      </div>
    </div>
  ),
});

export default function BuscarPage() {
  const user   = useAuthStore((s) => s.user);
  const clear  = useAuthStore((s) => s.clear);
  const router = useRouter();

  useEffect(() => {
    if (user && DEALER_ROLES.includes(user.role)) {
      router.replace('/dashboard');
    }
  }, [user, router]);

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

  /* ── Animação de rota (Como chegar) ─────────────────────── */
  const [routeTo, setRouteTo] = useState<DealershipPin | null>(null);

  /* ── Prompt "compartilhar localização" (sem GPS) ────────── */
  const [routePrompt, setRoutePrompt] = useState<DealershipPin | null>(null);
  const [sharingLoc, setSharingLoc] = useState(false);

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

  /* ── Rota: anima no mapa se houver GPS, senão pergunta ──── */
  const handleRoute = useCallback((pin: DealershipPin) => {
    if (userLocation && pin.latitude !== null && pin.longitude !== null) {
      setRouteTo(pin);
    } else {
      // Sem GPS: pergunta se quer compartilhar a localização na rota
      setRoutePrompt(pin);
    }
  }, [userLocation]);

  /** Pede GPS e abre o Google Maps com a rota a partir do usuário */
  function shareLocationAndRoute() {
    const pin = routePrompt;
    if (!pin) return;
    if (!navigator.geolocation) {
      window.open(directionsUrl(pin), '_blank', 'noopener,noreferrer');
      setRoutePrompt(null);
      return;
    }
    setSharingLoc(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(origin);
        window.open(directionsUrl(pin, origin), '_blank', 'noopener,noreferrer');
        setSharingLoc(false);
        setRoutePrompt(null);
      },
      () => {
        // Negou/erro: abre sem origem
        window.open(directionsUrl(pin), '_blank', 'noopener,noreferrer');
        setSharingLoc(false);
        setRoutePrompt(null);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  /** Abre o Google Maps sem compartilhar localização */
  function routeWithoutLocation() {
    if (routePrompt) window.open(directionsUrl(routePrompt), '_blank', 'noopener,noreferrer');
    setRoutePrompt(null);
  }

  const handleRouteDone = useCallback(() => {
    setRouteTo((pin) => {
      if (pin) window.open(directionsUrl(pin), '_blank', 'noopener,noreferrer');
      return null;
    });
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
    <div className="h-screen flex flex-col overflow-hidden sup-base">

      {/* ── HEADER ─────────────────────────────────────────── */}
      <header className="h-14 sup-base/85 backdrop-blur-xl border-b borda flex items-center px-4 gap-3 shrink-0 relative z-[900]">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0 group">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center
                          shadow-lg shadow-blue-900/60 ring-1 ring-slate-200 dark:ring-white/20
                          group-hover:shadow-blue-700/60 group-hover:scale-105 transition-all">
            <MapPin size={14} className="txt-forte" />
          </div>
          <span className="font-extrabold txt-forte text-base tracking-tight hidden sm:block">
            Auto<span className="text-blue-400">Connect</span>
          </span>
        </Link>

        {/* Breadcrumb */}
        <div className="hidden md:flex items-center gap-1.5 text-sm">
          <span className="text-slate-700">/</span>
          <span className="font-medium text-slate-500">Buscar concessionárias</span>
        </div>

        {/* Badge de contagem — com dot "ao vivo" */}
        <div className="hidden sm:flex items-center gap-2 text-xs sup-fraca border borda txt-fraco rounded-full px-3 py-1 select-none">
          {loading ? (
            <><Loader2 size={11} className="animate-spin" /> Carregando…</>
          ) : (
            <>
              <span className="relative flex w-1.5 h-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-emerald-400" />
              </span>
              <span className="font-semibold txt-medio">{withCoords.length}</span> no mapa
              <span className="txt-tenue">·</span>
              <span className="font-semibold txt-medio">{pins.length}</span> total
            </>
          )}
        </div>

        <div className="flex-1" />

        {/* Toggle mobile */}
        <div className="flex md:hidden sup-fraca rounded-lg p-0.5 gap-0.5">
          {(['map', 'list'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setMobile(v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all
                ${mobileView === v
                  ? 'sup-media txt-forte shadow-sm'
                  : 'text-slate-500 hover:txt-medio'}`}
            >
              {v === 'map' ? <><MapIcon size={12}/> Mapa</> : <><List size={12}/> Lista</>}
            </button>
          ))}
        </div>

        {/* Ações do cliente (favoritos, notificações, chat) */}
        <HeaderActions />

        {/* Área do usuário */}
        {user ? (
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl
                         border borda sup-fraca
                         hover:sup-media hover:borda-forte
                         transition-all text-sm"
            >
              <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                <User size={12} className="text-blue-400" />
              </div>
              <span className="font-medium txt-medio hidden sm:block max-w-[120px] truncate">
                {user.fullName.split(' ')[0]}
              </span>
              <ChevronDown size={12} className="txt-tenue" />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-[1000]" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 w-56 sup-card rounded-xl
                                border borda shadow-2xl z-[1001] overflow-hidden py-1">
                  <div className="px-4 py-2.5 border-b borda">
                    <p className="text-xs font-semibold txt-forte truncate">{user.fullName}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                  {user.role === 'customer' && (
                    <Link
                      href="/perfil"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm txt-medio
                                 hover:sup-fraca hover:txt-forte transition-colors"
                    >
                      <UserCircle size={14} className="txt-tenue" />
                      Meu Perfil
                    </Link>
                  )}
                  {user.role !== 'customer' && (
                    <Link
                      href="/dashboard"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm txt-medio
                                 hover:sup-fraca hover:txt-forte transition-colors"
                    >
                      <LayoutDashboard size={14} className="txt-tenue" />
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
              className="text-sm txt-fraco hover:txt-forte px-3 py-1.5
                         rounded-lg hover:sup-fraca transition-all font-medium"
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
        <div className="bg-gradient-to-r from-blue-600/15 via-blue-600/[.07] to-transparent
                        border-b border-blue-500/20 px-4 py-2 flex items-center gap-3 shrink-0">
          <div className="w-6 h-6 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
            <LocateFixed size={12} className="text-blue-400" />
          </div>
          <p className="text-xs txt-medio flex-1">
            Quer ver as lojas e veículos <span className="font-semibold txt-forte">mais perto de você</span>?
          </p>
          <button
            onClick={handleLocate}
            disabled={geoLoading}
            className="flex items-center gap-1.5 text-xs font-semibold
                       bg-gradient-to-r from-blue-600 to-blue-500 text-white px-3.5 py-1.5
                       rounded-lg hover:from-blue-500 hover:to-blue-400
                       shadow-md shadow-blue-900/40 transition-all disabled:opacity-50 shrink-0"
          >
            {geoLoading ? <Loader2 size={12} className="animate-spin" /> : <LocateFixed size={12} />}
            Usar minha localização
          </button>
          <button
            onClick={() => setGeoBannerDismissed(true)}
            className="text-slate-500 hover:txt-medio transition shrink-0"
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
            border-r borda
            flex flex-col overflow-hidden
            ${mobileView === 'list' ? 'flex' : 'hidden md:flex'}
          `}
        >
          {fetchError ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center sup-base">
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
              onRoute={handleRoute}
            />
          )}
        </aside>

        {/* Mapa */}
        <main
          className={`flex-1 relative overflow-hidden flex-col
            ${mobileView === 'map' ? 'flex' : 'hidden md:flex'}`}
        >
          {fetchError ? (
            <div className="h-full flex items-center justify-center sup-base">
              <p className="txt-tenue text-sm">Erro ao carregar mapa</p>
            </div>
          ) : (
            <MapClient
              pins={pins}
              selectedId={selected?.id ?? null}
              onSelect={handleSelect}
              userLocation={userLocation}
              matchingTenantIds={matchingTenantIds}
              radiusKm={radiusKm}
              routeTo={routeTo}
              onRouteDone={handleRouteDone}
            />
          )}

          {/* Empty state (sem coords) */}
          {!loading && !fetchError && withCoords.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-[900] sup-base/90 backdrop-blur-sm">
              <div className="sup-card/90 backdrop-blur border borda rounded-2xl p-8 shadow-2xl text-center max-w-xs mx-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-700/10
                                ring-1 ring-blue-500/20 flex items-center justify-center mx-auto mb-4">
                  <MapPin size={28} className="text-blue-400/70" />
                </div>
                <h3 className="font-bold txt-forte mb-1">Ainda sem pins no mapa</h3>
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
                         bg-gradient-to-r from-blue-600 to-blue-500 text-white text-sm font-bold
                         px-5 py-3 rounded-full shadow-2xl shadow-blue-900/60
                         ring-1 ring-slate-200 dark:ring-white/20 backdrop-blur
                         hover:from-blue-500 hover:to-blue-400 active:scale-95 transition-all"
            >
              <List size={15} />
              Ver {pins.length} concessionária{pins.length !== 1 ? 's' : ''}
            </button>
          )}
        </main>
      </div>

      {/* ── Modal: compartilhar localização na rota ─────────── */}
      {routePrompt && (
        <div
          className="fixed inset-0 z-[2100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => !sharingLoc && setRoutePrompt(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm sup-card border borda rounded-2xl p-5 shadow-2xl"
          >
            <div className="w-12 h-12 rounded-2xl bg-blue-500/15 ring-1 ring-blue-500/25
                            flex items-center justify-center mx-auto mb-3">
              <LocateFixed size={22} className="text-blue-400" />
            </div>
            <h3 className="text-sm font-bold txt-forte text-center">
              Traçar rota até {routePrompt.tenant.tradeName}?
            </h3>
            <p className="text-xs txt-fraco text-center mt-1.5 leading-relaxed">
              Compartilhe sua localização para abrir o trajeto completo no Google Maps,
              já saindo de onde você está.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              <button
                onClick={shareLocationAndRoute}
                disabled={sharingLoc}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl
                           bg-gradient-to-r from-blue-600 to-blue-500 text-white text-sm font-bold
                           hover:from-blue-500 hover:to-blue-400 shadow-lg shadow-blue-900/50
                           transition-all disabled:opacity-60"
              >
                {sharingLoc
                  ? <><Loader2 size={15} className="animate-spin" /> Localizando…</>
                  : <><LocateFixed size={14} /> Compartilhar e traçar rota</>}
              </button>
              <button
                onClick={routeWithoutLocation}
                disabled={sharingLoc}
                className="py-2.5 rounded-xl border borda text-sm font-medium
                           txt-fraco hover:sup-tenue hover:txt-medio
                           transition-all disabled:opacity-50"
              >
                Abrir sem compartilhar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
