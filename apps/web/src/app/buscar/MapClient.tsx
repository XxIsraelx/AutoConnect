'use client';

import { useEffect, useRef } from 'react';
import {
  MapContainer, TileLayer, Marker,
  CircleMarker, Circle, ZoomControl, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import type { DealershipPin } from './types';

/* ── Ícone balloon ───────────────────────────────────────────
   ATENÇÃO: os transforms ficam no CSS em .dealer-marker-inner.
─────────────────────────────────────────────────────────── */

function createBalloonIcon(selected: boolean) {
  const color = selected ? '#f59e0b' : '#3b82f6';
  const glow  = selected
    ? 'drop-shadow(0 5px 18px rgba(245,158,11,.7))'
    : 'drop-shadow(0 5px 18px rgba(59,130,246,.6))';

  const carPath = `
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

  return L.divIcon({
    html: `
      <div class="dealer-marker-inner" style="width:40px;height:52px">
        <svg xmlns="http://www.w3.org/2000/svg"
             viewBox="0 0 40 52" width="40" height="52"
             overflow="visible"
             style="filter:${glow}">
          <path
            d="M20 0C8.954 0 0 8.954 0 20C0 34 20 52 20 52S40 34 40 20C40 8.954 31.046 0 20 0Z"
            fill="${color}"/>
          <ellipse cx="14" cy="12" rx="7" ry="5"
            fill="rgba(255,255,255,.18)"
            transform="rotate(-25 14 12)"/>
          <circle cx="20" cy="19" r="13" fill="white"/>
          <g transform="translate(12,11) scale(0.667)" fill="${color}">
            <path d="${carPath}"/>
          </g>
        </svg>
      </div>
    `,
    className: `dealer-marker${selected ? ' dealer-marker--selected' : ''}`,
    iconSize:   [40, 52],
    iconAnchor: [20, 52],
    popupAnchor:[0,  -56],
  });
}

/* ── Ícone "você está aqui" ─────────────────────────────── */

function createUserIcon() {
  return L.divIcon({
    html: `
      <div style="width:22px;height:22px;position:relative;overflow:visible">
        <div class="user-ring"
             style="position:absolute;top:-7px;left:-7px;width:36px;height:36px;
                    border-radius:50%;background:rgba(59,130,246,.22)">
        </div>
        <div style="width:22px;height:22px;border-radius:50%;
                    background:#3b82f6;border:3px solid white;
                    box-shadow:0 2px 14px rgba(59,130,246,.75);
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
    fitted.current = true;
    if (pins.length === 1) {
      map.setView([pins[0].latitude, pins[0].longitude], 13);
      return;
    }
    const bounds = L.latLngBounds(pins.map((p) => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [64, 64], maxZoom: 14, animate: false });
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
          const size  = count < 5 ? 38 : count < 10 ? 44 : 52;
          return L.divIcon({
            html: `<div style="
              width:${size}px;height:${size}px;border-radius:50%;
              background:rgba(59,130,246,.9);
              border:2.5px solid rgba(255,255,255,.3);
              box-shadow:0 4px 16px rgba(59,130,246,.55);
              display:flex;align-items:center;justify-content:center;
              color:white;font-weight:800;font-size:${count < 10 ? 14 : 12}px;
              font-family:Inter,sans-serif;
            ">${count}</div>`,
            className: 'dealer-cluster',
            iconSize: [size, size] as [number, number],
            iconAnchor: [size / 2, size / 2] as [number, number],
          });
        },
      });

    for (const pin of pins) {
      const isSelected = pin.id === selectedId;
      const isDimmed   = matchingTenantIds !== null && !matchingTenantIds.has(pin.tenant.id);

      const marker = L.marker([pin.latitude, pin.longitude], {
        icon:        createBalloonIcon(isSelected),
        opacity:     isDimmed ? 0.2 : 1,
        zIndexOffset: isSelected ? 1000 : isDimmed ? -100 : 0,
      });

      marker.bindTooltip(
        `<p style="font-weight:700;font-size:13px;color:#fff;line-height:1.3">${pin.tenant.tradeName}</p>
         ${(pin.city || pin.state) ? `<p style="font-size:11px;color:#94a3b8;margin-top:2px">${[pin.city, pin.state].filter(Boolean).join(', ')}</p>` : ''}
         <div style="margin-top:6px"><span style="font-size:10px;font-weight:700;background:rgba(59,130,246,.2);color:#93c5fd;padding:2px 7px;border-radius:20px">${pin.vehiclesCount} veíc.</span></div>`,
        { direction: 'top', offset: L.point(0, -58), opacity: 1, className: 'pin-tooltip' },
      );

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
}

export default function MapClient({
  pins, selectedId, onSelect, userLocation, matchingTenantIds, radiusKm,
}: Props) {
  const validPins = pins.filter(
    (p): p is ValidPin => p.latitude !== null && p.longitude !== null,
  );
  const selectedPin = validPins.find((p) => p.id === selectedId) ?? null;

  return (
    <MapContainer
      center={[-15.7835, -47.8685]}
      zoom={5}
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
      className="bg-[#0f172a]"
    >
      {/* CartoDB Dark Matter — gratuito, sem API key */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        subdomains="abcd"
        maxZoom={20}
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
    </MapContainer>
  );
}
