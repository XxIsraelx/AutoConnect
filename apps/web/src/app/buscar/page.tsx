'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import type { DealershipPin } from './types';
import {
  X,
  Phone,
  Mail,
  Car,
  MapPin,
  ChevronRight,
  Loader2,
  LayoutDashboard,
  LogOut,
} from 'lucide-react';

// Leaflet precisa do DOM — dynamic import com ssr:false
const MapClient = dynamic(() => import('./MapClient'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center bg-slate-100">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <Loader2 className="animate-spin" size={36} />
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

  useEffect(() => {
    api<DealershipPin[]>('/map/dealerships')
      .then((data) => setPins(data))
      .catch((err: unknown) =>
        setFetchError(err instanceof Error ? err.message : 'Erro ao carregar mapa'),
      )
      .finally(() => setLoading(false));
  }, []);

  const withCoords = pins.filter((p) => p.latitude !== null && p.longitude !== null);

  return (
    <div className="h-screen flex flex-col overflow-hidden">

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 z-50 shrink-0 shadow-sm">
        <Link href="/" className="font-extrabold text-lg tracking-tight text-blue-600 shrink-0 mr-1">
          AutoConnect
        </Link>

        {/* badge de contagem */}
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 rounded-full px-3 py-1 select-none">
          {loading ? (
            <><Loader2 size={12} className="animate-spin" /> Carregando…</>
          ) : (
            <><MapPin size={12} className="text-blue-500" />
              {withCoords.length} concessionária{withCoords.length !== 1 ? 's' : ''}
            </>
          )}
        </div>

        <div className="flex-1" />

        {/* área do usuário */}
        {user ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600 hidden md:block max-w-[160px] truncate">
              Olá, <strong>{user.fullName.split(' ')[0]}</strong>
            </span>
            {user.role !== 'customer' && (
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 text-xs bg-slate-800 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 transition"
              >
                <LayoutDashboard size={13} />
                <span className="hidden sm:inline">Dashboard</span>
              </Link>
            )}
            <button
              onClick={() => clear()}
              title="Sair"
              className="flex items-center gap-1.5 text-xs text-slate-500 border border-slate-200 px-2.5 py-1.5 rounded-lg hover:border-slate-400 hover:text-slate-700 transition"
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              href="/entrar"
              className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition"
            >
              Entrar
            </Link>
            <Link
              href="/cadastrar"
              className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition font-medium"
            >
              Criar conta
            </Link>
          </div>
        )}
      </header>

      {/* ── Mapa ───────────────────────────────────────────── */}
      <main className="flex-1 relative overflow-hidden">

        {fetchError ? (
          /* Erro de rede */
          <div className="h-full flex items-center justify-center bg-slate-50">
            <div className="text-center p-6">
              <p className="text-red-500 font-medium mb-2">{fetchError}</p>
              <button
                onClick={() => window.location.reload()}
                className="text-sm text-blue-600 hover:underline"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        ) : (
          /* Mapa Leaflet (SSR desativado) */
          <MapClient
            pins={pins}
            selectedId={selected?.id ?? null}
            onSelect={(pin) => setSelected((prev) => (prev?.id === pin.id ? null : pin))}
          />
        )}

        {/* ── Painel de detalhe da concessionária ─────────── */}
        {selected && (
          <div
            className="
              absolute bottom-5 left-1/2 -translate-x-1/2
              sm:left-5 sm:translate-x-0 sm:bottom-10
              z-[1000]
              w-[calc(100%-2.5rem)] max-w-sm
              bg-white rounded-2xl shadow-2xl border border-slate-100
              overflow-hidden
              animate-in fade-in slide-in-from-bottom-4 duration-200
            "
          >
            {/* Barra de cor da marca no topo */}
            <div className="h-1 bg-gradient-to-r from-blue-500 to-blue-400" />

            <div className="p-4 pt-3.5">
              {/* Fechar */}
              <button
                onClick={() => setSelected(null)}
                className="absolute top-3.5 right-3.5 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              >
                <X size={16} />
              </button>

              {/* Nome */}
              <p className="text-[11px] font-bold text-blue-600 uppercase tracking-widest mb-0.5">
                {selected.tenant.tradeName}
              </p>
              <h3 className="font-bold text-slate-800 text-[15px] leading-snug pr-6">
                {selected.name}
              </h3>

              {/* Infos */}
              <div className="mt-3 space-y-1.5 text-sm text-slate-600">
                {(selected.city || selected.state) && (
                  <div className="flex items-start gap-2">
                    <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                    <span>
                      {[
                        selected.addressLine,
                        [selected.city, selected.state].filter(Boolean).join(', '),
                      ]
                        .filter(Boolean)
                        .join(' — ')}
                    </span>
                  </div>
                )}
                {selected.phone && (
                  <div className="flex items-center gap-2">
                    <Phone size={14} className="shrink-0 text-slate-400" />
                    <a
                      href={`tel:${selected.phone}`}
                      className="hover:text-blue-600 transition"
                    >
                      {selected.phone}
                    </a>
                  </div>
                )}
                {selected.email && (
                  <div className="flex items-center gap-2">
                    <Mail size={14} className="shrink-0 text-slate-400" />
                    <a
                      href={`mailto:${selected.email}`}
                      className="hover:text-blue-600 transition truncate"
                    >
                      {selected.email}
                    </a>
                  </div>
                )}
              </div>

              {/* Badge de veículos */}
              <div className="mt-3">
                <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 rounded-full px-3 py-1 text-xs font-semibold">
                  <Car size={12} />
                  {selected.vehiclesCount}{' '}
                  {selected.vehiclesCount === 1 ? 'veículo disponível' : 'veículos disponíveis'}
                </span>
              </div>

              {/* CTA */}
              <Link
                href={`/catalogo/${selected.tenant.id}`}
                className="
                  mt-3 flex items-center justify-center gap-1.5
                  w-full bg-blue-600 text-white text-sm font-semibold
                  py-2.5 rounded-xl hover:bg-blue-700 transition
                "
              >
                Ver veículos <ChevronRight size={16} />
              </Link>
            </div>
          </div>
        )}

        {/* ── Empty state (sem pins geocodificados) ──────── */}
        {!loading && !fetchError && withCoords.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-[999] bg-slate-100/70 backdrop-blur-sm">
            <div className="bg-white rounded-2xl p-8 shadow-xl text-center max-w-xs mx-4 border border-slate-100">
              <Car size={44} className="text-slate-200 mx-auto mb-4" />
              <h3 className="font-bold text-slate-700 text-lg mb-1">
                Ainda sem concessionárias
              </h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-5">
                Seja a primeira concessionária a aparecer no mapa e alcance milhares de compradores.
              </p>
              <Link
                href="/signup"
                className="inline-block bg-blue-600 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-blue-700 transition"
              >
                Cadastrar minha concessionária
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
