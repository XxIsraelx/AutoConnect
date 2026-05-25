'use client';

import { useEffect, useRef } from 'react';
import {
  MapContainer, TileLayer, Marker, CircleMarker,
  ZoomControl, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DealershipPin } from './types';

/* ── Ícone balloon ───────────────────────────────────────── */

function createBalloonIcon(selected: boolean) {
  // Azul da marca para normal; âmbar vivo para selecionado (destaca no dark map)
  const color   = selected ? '#f59e0b' : '#3b82f6';
  const shadow  = selected
    ? 'drop-shadow(0 6px 18px rgba(245,158,11,.75))'
    : 'drop-shadow(0 5px 16px rgba(59,130,246,.6))';
  const scale   = selected ? 'scale(1.18)' : 'scale(1)';

  /*
   * Balão teardrop:  40×52 px
   * Ponta em (20, 52) → iconAnchor: [20, 52]
   * Ícone de carro do Material Design (24×24) centrado em (20, 19)
   * Transform: translate(12, 11) scale(0.667)  →  centro em (12+12*.667, 11+12*.667) ≈ (20, 19)
   */
  const carPath = `M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11
    c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1
    c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1
    v-8l-2.08-5.99z
    M6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16z
    m11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z
    M5 11l1.5-4.5h11L19 11H5z`;

  return L.divIcon({
    html: `
      <div style="width:40px;height:52px;transform:${scale};transition:transform .2s cubic-bezier(.34,1.56,.64,1)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 52"
             width="40" height="52" overflow="visible"
             style="filter:${shadow}">

          <!-- Corpo do balão (teardrop) -->
          <path d="M20 0C8.954 0 0 8.954 0 20C0 34 20 52 20 52S40 34 40 20C40 8.954 31.046 0 20 0Z"
                fill="${color}"/>

          <!-- Brilho interno superior (highlight) -->
          <ellipse cx="15" cy="13" rx="7" ry="5"
                   fill="rgba(255,255,255,0.18)" transform="rotate(-20 15 13)"/>

          <!-- Círculo interno branco -->
          <circle cx="20" cy="19" r="13" fill="white"/>

          <!-- Ícone de carro centrado -->
          <g transform="translate(12, 11) scale(0.667)" fill="${color}">
            <path d="${carPath}"/>
          </g>
        </svg>
      </div>
    `,
    className: 'dealer-marker',
    iconSize: [40, 52],
    iconAnchor: [20, 52],
    popupAnchor: [0, -56],
  });
}

/* ── Hooks internos do mapa ──────────────────────────────── */

/** Ajusta o zoom para mostrar todos os pins na primeira carga */
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

/** Voa até o pin selecionado; volta ao overview quando desmarcado */
function FlyToSelected({
  pin,
  allPins,
}: {
  pin: ValidPin | null;
  allPins: ValidPin[];
}) {
  const map = useMap();
  const prevId = useRef<string | null>(null);

  useEffect(() => {
    if (pin) {
      map.flyTo([pin.latitude, pin.longitude], Math.max(map.getZoom(), 14), {
        duration: 1.2,
      });
    } else if (prevId.current !== null) {
      // Acabou de desmarcar — volta ao overview
      if (allPins.length === 1) return;
      const bounds = L.latLngBounds(allPins.map((p) => [p.latitude, p.longitude]));
      map.flyToBounds(bounds, { padding: [64, 64], maxZoom: 13, duration: 1.2 });
    }
    prevId.current = pin?.id ?? null;
  }, [pin, allPins, map]);

  return null;
}

/* ── Tipos ──────────────────────────────────────────────── */

type ValidPin = DealershipPin & { latitude: number; longitude: number };

interface Props {
  pins: DealershipPin[];
  selectedId: string | null;
  onSelect: (pin: DealershipPin) => void;
}

/* ── Componente principal ────────────────────────────────── */

export default function MapClient({ pins, selectedId, onSelect }: Props) {
  const validPins = pins.filter(
    (p): p is ValidPin => p.latitude !== null && p.longitude !== null,
  );
  const selectedPin = validPins.find((p) => p.id === selectedId) ?? null;

  return (
    <MapContainer
      /* Centro inicial do Brasil — FitOnLoad sobrescreve assim que os pins chegarem */
      center={[-15.7835, -47.8685]}
      zoom={5}
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
      /* Fundo escuro enquanto tiles carregam */
      className="bg-[#0f172a]"
    >
      {/* ── CartoDB Dark Matter (gratuito, sem API key) ── */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        subdomains="abcd"
        maxZoom={20}
      />

      {/* Controles de zoom no canto inferior direito */}
      <ZoomControl position="bottomright" />

      {/* ── Pins ─────────────────────────────────────── */}
      {validPins.map((pin) => {
        const isSel = pin.id === selectedId;
        return (
          <Marker
            key={pin.id}
            position={[pin.latitude, pin.longitude]}
            icon={createBalloonIcon(isSel)}
            zIndexOffset={isSel ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(pin) }}
          />
        );
      })}

      {/* ── Anel de pulso ao redor do pin selecionado ─ */}
      {selectedPin && (
        <CircleMarker
          center={[selectedPin.latitude, selectedPin.longitude]}
          radius={18}
          className="selected-pulse"
          pathOptions={{
            color: '#f59e0b',
            fillColor: '#f59e0b',
            fillOpacity: 0.15,
            weight: 2,
            opacity: 0.6,
          }}
        />
      )}

      {/* ── Hooks ────────────────────────────────────── */}
      <FitOnLoad pins={validPins} />
      <FlyToSelected pin={selectedPin} allPins={validPins} />
    </MapContainer>
  );
}
