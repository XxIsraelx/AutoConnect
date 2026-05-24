'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DealershipPin } from './types';

// Fix the default icon broken asset paths under webpack/Next.js
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function createMarkerIcon(selected: boolean) {
  const bg = selected ? '#ef4444' : '#3b82f6';
  const shadow = selected
    ? '0 3px 14px rgba(239,68,68,.55)'
    : '0 3px 14px rgba(59,130,246,.45)';
  return L.divIcon({
    html: `
      <div style="
        width:40px;height:40px;border-radius:50%;
        background:${bg};
        border:3px solid white;
        box-shadow:${shadow};
        display:flex;align-items:center;justify-content:center;
        transform:${selected ? 'scale(1.15)' : 'scale(1)'};
        transition:transform .2s,background .2s;
      ">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
             viewBox="0 0 24 24" fill="white">
          <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11
                   c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1
                   c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1
                   v-8l-2.08-5.99z
                   M6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13
                   s1.5.67 1.5 1.5S7.33 16 6.5 16z
                   m11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5
                   1.5.67 1.5 1.5-.67 1.5-1.5 1.5z
                   M5 11l1.5-4.5h11L19 11H5z"/>
        </svg>
      </div>
    `,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -24],
  });
}

/** Flies to the selected pin every time it changes */
function FlyToSelected({ pin }: { pin: DealershipPin | null }) {
  const map = useMap();
  useEffect(() => {
    if (pin?.latitude != null && pin?.longitude != null) {
      map.flyTo([pin.latitude, pin.longitude], Math.max(map.getZoom(), 13), {
        duration: 1.2,
      });
    }
  }, [pin, map]);
  return null;
}

interface Props {
  pins: DealershipPin[];
  selectedId: string | null;
  onSelect: (pin: DealershipPin) => void;
}

export default function MapClient({ pins, selectedId, onSelect }: Props) {
  const validPins = pins.filter(
    (p): p is DealershipPin & { latitude: number; longitude: number } =>
      p.latitude !== null && p.longitude !== null,
  );

  const selectedPin = validPins.find((p) => p.id === selectedId) ?? null;

  return (
    <MapContainer
      center={[-15.7835, -47.8685]}
      zoom={5}
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
      />

      <ZoomControl position="bottomright" />

      {validPins.map((pin) => (
        <Marker
          key={pin.id}
          position={[pin.latitude, pin.longitude]}
          icon={createMarkerIcon(pin.id === selectedId)}
          eventHandlers={{ click: () => onSelect(pin) }}
        />
      ))}

      <FlyToSelected pin={selectedPin} />
    </MapContainer>
  );
}
