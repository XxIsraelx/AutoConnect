'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MapContainer, TileLayer, Marker,
  CircleMarker, Circle, ZoomControl, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import { api } from '@/lib/api';
import type { DealershipPin, PublicVehicle, VehiclesPage } from './types';

/* ── Ícone balloon ───────────────────────────────────────────
   ATENÇÃO: os transforms ficam no CSS em .dealer-marker-inner.
─────────────────────────────────────────────────────────── */

const CAR_PATH = `
  M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11
    c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1
    c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1
    v-8l-2.08-5.99z
  M6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13
    s1.5.67 1.5 1.5S7.33 16 6.5 16z
  m11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5
    1.5.67 1.5 1.5-.67 1.5-1.5 1.5z
  M5 11l1.5-4.5h11L19 11H5z
`;

function createBalloonIcon(selected: boolean, vehiclesCount: number) {
  const gradId = selected ? 'pin-grad-sel' : 'pin-grad';
  const [c1, c2] = selected ? ['#fbbf24', '#d97706'] : ['#60a5fa', '#2563eb'];
  const iconColor = selected ? '#d97706' : '#2563eb';
  const glow = selected
    ? 'drop-shadow(0 6px 20px rgba(245,158,11,.75))'
    : 'drop-shadow(0 6px 18px rgba(59,130,246,.55))';

  const badge = vehiclesCount > 0
    ? `<div class="pin-badge${selected ? ' pin-badge--selected' : ''}">${vehiclesCount > 99 ? '99+' : vehiclesCount}</div>`
    : '';

  return L.divIcon({
    html: `
      <div class="dealer-marker-inner" style="width:42px;height:54px;position:relative;overflow:visible">
        <svg xmlns="http://www.w3.org/2000/svg"
             viewBox="0 0 42 54" width="42" height="54"
             overflow="visible"
             style="filter:${glow}">
          <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="0.6" y2="1">
              <stop offset="0%" stop-color="${c1}"/>
              <stop offset="100%" stop-color="${c2}"/>
            </linearGradient>
          </defs>
          <path
            d="M21 1C10.507 1 2 9.507 2 20C2 33.3 21 53 21 53S40 33.3 40 20C40 9.507 31.493 1 21 1Z"
            fill="url(#${gradId})"
            stroke="rgba(255,255,255,.35)" stroke-width="1.5"/>
          <ellipse cx="14.5" cy="11.5" rx="7.5" ry="5"
            fill="rgba(255,255,255,.22)"
            transform="rotate(-25 14.5 11.5)"/>
          <circle cx="21" cy="19.5" r="12.5" fill="white"/>
          <circle cx="21" cy="19.5" r="12.5" fill="none"
            stroke="rgba(15,23,42,.08)" stroke-width="1"/>
          <g transform="translate(13,11.5) scale(0.667)" fill="${iconColor}">
            <path d="${CAR_PATH}"/>
          </g>
        </svg>
        ${badge}
      </div>
    `,
    className: `dealer-marker${selected ? ' dealer-marker--selected' : ''}`,
    iconSize:   [42, 54],
    iconAnchor: [21, 54],
    popupAnchor:[0,  -58],
  });
}

/* ── Ícone "você está aqui" ─────────────────────────────── */

function createUserIcon() {
  return L.divIcon({
    html: `
      <div style="width:22px;height:22px;position:relative;overflow:visible">
        <div class="user-ring"
             style="position:absolute;top:-9px;left:-9px;width:40px;height:40px;
                    border-radius:50%;background:rgba(59,130,246,.25)">
        </div>
        <div class="user-ring user-ring--delay"
             style="position:absolute;top:-9px;left:-9px;width:40px;height:40px;
                    border-radius:50%;background:rgba(59,130,246,.18)">
        </div>
        <div style="width:22px;height:22px;border-radius:50%;
                    background:linear-gradient(135deg,#60a5fa,#2563eb);
                    border:3px solid white;
                    box-shadow:0 2px 16px rgba(59,130,246,.85);
                    position:relative;z-index:1">
        </div>
      </div>
    `,
    className: 'user-location-marker',
    iconSize:   [22, 22],
    iconAnchor: [11, 11],
  });
}

/* ── Tipos internos ─────────────────────────────────────── */

type ValidPin = DealershipPin & { latitude: number; longitude: number };

/* ── Hooks ──────────────────────────────────────────────── */

/** Ajusta o zoom para mostrar todos os pins no primeiro carregamento */
function FitOnLoad({ pins }: { pins: ValidPin[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || pins.length === 0) return;

    // O container pode ainda não ter altura no primeiro paint. Se ajustarmos
    // nesse momento, o Leaflet calcula um zoom altíssimo e o resultado encosta
    // no teto do maxZoom — o mapa abre "colado no chão" e sem nenhum pin à vista.
    const fit = (): boolean => {
      map.invalidateSize();
      const { x, y } = map.getSize();
      if (x === 0 || y === 0) return false;

      if (pins.length === 1) {
        map.setView([pins[0].latitude, pins[0].longitude], 13);
      } else {
        const bounds = L.latLngBounds(pins.map((p) => [p.latitude, p.longitude]));
        map.fitBounds(bounds, { padding: [64, 64], maxZoom: 14, animate: false });
      }
      return true;
    };

    if (fit()) {
      fitted.current = true;
      return;
    }

    // Ainda sem dimensões — tenta de novo assim que o layout resolver.
    const raf = requestAnimationFrame(() => {
      if (fit()) fitted.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [pins, map]);

  return null;
}

/** Voa até o pin selecionado; retorna ao overview ao desmarcar */
function FlyToSelected({ pin, allPins }: { pin: ValidPin | null; allPins: ValidPin[] }) {
  const map = useMap();
  const prevId = useRef<string | null>(null);

  useEffect(() => {
    if (pin) {
      map.flyTo([pin.latitude, pin.longitude], Math.max(map.getZoom(), 14), { duration: 1.2 });
    } else if (prevId.current !== null && allPins.length > 1) {
      const bounds = L.latLngBounds(allPins.map((p) => [p.latitude, p.longitude]));
      map.flyToBounds(bounds, { padding: [64, 64], maxZoom: 13, duration: 1.2 });
    }
    prevId.current = pin?.id ?? null;
  }, [pin, allPins, map]);

  return null;
}

/** Voa até a localização do usuário ao obter GPS */
function FlyToUser({ loc }: { loc: { lat: number; lng: number } | null }) {
  const map = useMap();
  const prevKey = useRef<string | null>(null);

  useEffect(() => {
    if (!loc) return;
    const key = `${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`;
    if (prevKey.current === key) return;
    prevKey.current = key;
    map.flyTo([loc.lat, loc.lng], Math.max(map.getZoom(), 13), { duration: 1.5 });
  }, [loc, map]);

  return null;
}

/* ── Tooltip dos pins (com preview de veículo) ──────────── */

function formatTooltipPrice(v: string | null | undefined) {
  if (!v) return '';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(parseFloat(v));
}

function tooltipHtml(pin: DealershipPin, vehicle: PublicVehicle | null | undefined) {
  /* vehicle === undefined → ainda carregando; null → sem veículos */
  const preview = vehicle
    ? `<div style="display:flex;gap:8px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)">
         <div style="width:52px;height:40px;border-radius:8px;overflow:hidden;background:rgba(255,255,255,.08);flex-shrink:0;display:flex;align-items:center;justify-content:center">
           ${vehicle.images[0]?.url
             ? `<img src="${vehicle.images[0].url}" style="width:100%;height:100%;object-fit:cover" alt=""/>`
             : `<span style="font-size:14px">🚗</span>`}
         </div>
         <div style="min-width:0">
           <p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px">
             ${vehicle.brand.name} ${vehicle.model.name}
           </p>
           <p style="font-size:12px;font-weight:800;color:#60a5fa;margin-top:1px">
             ${formatTooltipPrice(vehicle.promoPrice ?? vehicle.price)}
           </p>
         </div>
       </div>`
    : vehicle === undefined && pin.vehiclesCount > 0
    ? `<p style="font-size:10px;color:#64748b;margin-top:8px">carregando destaque…</p>`
    : '';

  return `<div class="pin-tooltip-accent"></div>
    <p style="font-weight:700;font-size:13px;color:#fff;line-height:1.3">${pin.tenant.tradeName}</p>
    ${(pin.city || pin.state) ? `<p style="font-size:11px;color:#94a3b8;margin-top:2px">${[pin.city, pin.state].filter(Boolean).join(', ')}</p>` : ''}
    <div style="margin-top:7px;display:flex;gap:5px;align-items:center">
      <span style="font-size:10px;font-weight:700;background:linear-gradient(135deg,rgba(96,165,250,.25),rgba(37,99,235,.25));color:#93c5fd;padding:3px 8px;border-radius:20px;border:1px solid rgba(96,165,250,.25)">
        ${pin.vehiclesCount} veículo${pin.vehiclesCount !== 1 ? 's' : ''}
      </span>
      <span style="font-size:10px;color:#64748b">clique para ver</span>
    </div>
    ${preview}`;
}

/* ── ClusterLayer — leaflet.markercluster via imperativo ── */

interface ClusterLayerProps {
  pins: ValidPin[];
  selectedId: string | null;
  matchingTenantIds: Set<string> | null;
  onSelect: (pin: DealershipPin) => void;
}

function ClusterLayer({ pins, selectedId, matchingTenantIds, onSelect }: ClusterLayerProps) {
  const map = useMap();
  const clusterRef  = useRef<L.MarkerClusterGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  /* Cache de veículo em destaque por tenant (null = sem veículos) */
  const previewCache = useRef(new Map<string, PublicVehicle | null>());

  useEffect(() => {
    // Remove cluster anterior
    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
    }

    const cluster = (L as unknown as { markerClusterGroup: (opts: unknown) => L.MarkerClusterGroup })
      .markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 60,
        disableClusteringAtZoom: 15,
        spiderfyOnMaxZoom: true,
        animate: true,
        iconCreateFunction(c: L.MarkerCluster) {
          const count = c.getChildCount();
          const size  = count < 5 ? 42 : count < 10 ? 48 : 56;
          return L.divIcon({
            html: `
              <div class="dealer-cluster-ring" style="width:${size + 12}px;height:${size + 12}px">
                <div class="dealer-cluster-core" style="
                  width:${size}px;height:${size}px;
                  font-size:${count < 10 ? 15 : 13}px;
                ">${count}</div>
              </div>`,
            className: 'dealer-cluster',
            iconSize: [size + 12, size + 12] as [number, number],
            iconAnchor: [(size + 12) / 2, (size + 12) / 2] as [number, number],
          });
        },
      });

    for (const pin of pins) {
      const isSelected = pin.id === selectedId;
      const isDimmed   = matchingTenantIds !== null && !matchingTenantIds.has(pin.tenant.id);

      const marker = L.marker([pin.latitude, pin.longitude], {
        icon:        createBalloonIcon(isSelected, pin.vehiclesCount),
        opacity:     isDimmed ? 0.2 : 1,
        zIndexOffset: isSelected ? 1000 : isDimmed ? -100 : 0,
      });

      marker.bindTooltip(
        tooltipHtml(pin, previewCache.current.get(pin.tenant.id)),
        { direction: 'top', offset: L.point(0, -60), opacity: 1, className: 'pin-tooltip' },
      );

      /* Preview do veículo em destaque — busca 1x por tenant no hover */
      marker.on('mouseover', () => {
        const cached = previewCache.current.get(pin.tenant.id);
        if (cached !== undefined || pin.vehiclesCount === 0) return;
        api<VehiclesPage>(`/catalog/vehicles?tenantId=${pin.tenant.id}&limit=1`)
          .then((data) => {
            const v = data.items[0] ?? null;
            previewCache.current.set(pin.tenant.id, v);
            marker.setTooltipContent(tooltipHtml(pin, v));
          })
          .catch(() => previewCache.current.set(pin.tenant.id, null));
      });

      marker.on('click', () => onSelectRef.current(pin));
      cluster.addLayer(marker);
    }

    clusterRef.current = cluster;
    map.addLayer(cluster);

    return () => {
      map.removeLayer(cluster);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pins, selectedId, matchingTenantIds]);

  return null;
}

/* ── RouteAnimation — linha animada até a concessionária ── */

interface RouteAnimProps {
  from: { lat: number; lng: number } | null;
  to: ValidPin | null;
  onDone: () => void;
}

function RouteAnimation({ from, to, onDone }: RouteAnimProps) {
  const map = useMap();
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!from || !to) return;

    const a: [number, number] = [from.lat, from.lng];
    const b: [number, number] = [to.latitude, to.longitude];

    map.flyToBounds(L.latLngBounds([a, b]), { padding: [80, 80], duration: 0.8 });

    /* Glow por baixo + linha tracejada animada por cima */
    const glow = L.polyline([a, b], {
      color: '#3b82f6', weight: 8, opacity: 0.25, lineCap: 'round',
    }).addTo(map);
    const line = L.polyline([a, b], {
      color: '#60a5fa', weight: 3, opacity: 0.95,
      dashArray: '10 12', lineCap: 'round', className: 'route-line',
    }).addTo(map);

    const timer = setTimeout(() => {
      map.removeLayer(line);
      map.removeLayer(glow);
      onDoneRef.current();
    }, 1700);

    return () => {
      clearTimeout(timer);
      map.removeLayer(line);
      map.removeLayer(glow);
    };
  }, [from, to, map]);

  return null;
}

/* ── Componente principal ────────────────────────────────── */

interface Props {
  pins: DealershipPin[];
  selectedId: string | null;
  onSelect: (pin: DealershipPin) => void;
  /** Localização GPS do usuário */
  userLocation: { lat: number; lng: number } | null;
  /** IDs de tenants que têm match de filtro */
  matchingTenantIds: Set<string> | null;
  /** Raio em km ao redor do usuário */
  radiusKm: number | null;
  /** Pin alvo da animação de rota (abre Google Maps ao terminar) */
  routeTo?: DealershipPin | null;
  /** Chamado quando a animação de rota termina */
  onRouteDone?: () => void;
}

export default function MapClient({
  pins, selectedId, onSelect, userLocation, matchingTenantIds, radiusKm,
  routeTo, onRouteDone,
}: Props) {
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const validPins = pins.filter(
    (p): p is ValidPin => Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
  );
  const selectedPin = validPins.find((p) => p.id === selectedId) ?? null;
  const routePin = routeTo && Number.isFinite(routeTo.latitude) && Number.isFinite(routeTo.longitude)
    ? (routeTo as ValidPin)
    : null;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[-15.7835, -47.8685]}
        zoom={5}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        className="bg-[#0f172a]"
      >
        {/* Esri Dark Gray Canvas — gratuito e sem API key.
            (A CARTO passou a exigir chave e carimba "API KEY REQUIRED" nos tiles.)
            maxNativeZoom=16 é o limite da Esri; acima disso o Leaflet reamplia os tiles. */}
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution='&copy; <a href="https://www.esri.com">Esri</a>'
          className="basemap-dark"
          maxZoom={20}
          maxNativeZoom={16}
          eventHandlers={{ load: () => setTilesLoaded(true) }}
        />

        {/* Rótulos (cidades e vias) vêm em camada separada na Esri */}
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
          maxZoom={20}
          maxNativeZoom={16}
        />

        <ZoomControl position="bottomright" />

        {/* Cluster layer */}
        <ClusterLayer
          pins={validPins}
          selectedId={selectedId}
          matchingTenantIds={matchingTenantIds}
          onSelect={onSelect}
        />

        {/* Anel de pulso ao redor do selecionado */}
        {selectedPin && (
          <CircleMarker
            center={[selectedPin.latitude, selectedPin.longitude]}
            radius={18}
            className="selected-pulse"
            pathOptions={{
              color: '#f59e0b',
              fillColor: '#f59e0b',
              fillOpacity: 0.12,
              weight: 2,
              opacity: 0.55,
            }}
          />
        )}

        {/* Círculo de raio ao redor do usuário */}
        {userLocation && radiusKm && (
          <Circle
            center={[userLocation.lat, userLocation.lng]}
            radius={radiusKm * 1000}
            pathOptions={{
              color: '#10b981',
              fillColor: '#10b981',
              fillOpacity: 0.05,
              weight: 1.5,
              opacity: 0.35,
              dashArray: '6 5',
            }}
          />
        )}

        {/* Marcador GPS do usuário */}
        {userLocation && (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={createUserIcon()}
            zIndexOffset={2000}
            interactive={false}
          />
        )}

        <FitOnLoad pins={validPins} />
        <FlyToSelected pin={selectedPin} allPins={validPins} />
        <FlyToUser loc={userLocation} />
        {routePin && onRouteDone && (
          <RouteAnimation from={userLocation} to={routePin} onDone={onRouteDone} />
        )}
      </MapContainer>

      {/* Shimmer enquanto os tiles carregam */}
      <div
        className={`map-shimmer ${tilesLoaded ? 'map-shimmer--done' : ''}`}
        aria-hidden="true"
      />

      {/* Vignette — profundidade nas bordas, sem bloquear interação */}
      <div className="map-vignette" aria-hidden="true" />
    </div>
  );
}
