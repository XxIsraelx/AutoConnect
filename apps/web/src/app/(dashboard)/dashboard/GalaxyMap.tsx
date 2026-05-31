'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

/* ── Types ───────────────────────────────────────────────── */
export interface GalaxyCustomer {
  id: string;
  firstName: string;
  initials: string;
  distance: number | null;
}

interface Point extends GalaxyCustomer {
  baseX: number;
  baseY: number;
  dotSize: number;
  colorRatio: number;   // 0 = close (bright), 1 = far (dark)
  opacity: number;
  floatAmpX: number;
  floatAmpY: number;
  floatSpeedX: number;
  floatSpeedY: number;
  floatPhaseX: number;
  floatPhaseY: number;
}

interface Tooltip { x: number; y: number; text: string }

/* ── Radius filter options ──────────────────────────────── */
const FILTERS = [
  { label: 'Tudo', max: Infinity },
  { label: '100 km', max: 100 },
  { label: '500 km', max: 500 },
  { label: '1500 km', max: 1500 },
] as const;

const CENTER_CLEAR = 40;  // raio livre ao redor da concessionária
const RIGHT_RESERVE = 62; // espaço reservado p/ o filtro vertical à direita

/* ── Seeded RNG (deterministic positions) ────────────────── */
function seededRng(seed: number) {
  let s = seed;
  return (): number => {
    s = Math.imul(s ^ (s >>> 17), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 17), 0x45d9f3b);
    return ((s ^ (s >>> 16)) >>> 0) / 0xffffffff;
  };
}

/* ── Build canvas points from customer list ─────────────── */
function buildPoints(
  customers: GalaxyCustomer[],
  w: number,
  h: number,
): Point[] {
  if (customers.length === 0) return [];

  // centro deslocado p/ esquerda, reservando faixa do filtro à direita
  const cx = (w - RIGHT_RESERVE) / 2;
  const cy = h / 2;
  const maxR = Math.min(cx, cy) - 26;
  const innerR = CENTER_CLEAR + 8;

  const dists = customers
    .map((c) => c.distance)
    .filter((d): d is number => d !== null);
  // normaliza pelo MAIOR dist do conjunto visível → pontos preenchem o card
  const maxDist = dists.length ? Math.max(...dists, 1) : 600;

  const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ângulo áureo ≈ 137.5°

  // ordena por distância → vizinhos em distância ficam em ângulos opostos
  const sorted = [...customers].sort((a, b) => {
    const da = a.distance ?? Infinity;
    const db = b.distance ?? Infinity;
    return da - db;
  });

  const points: Point[] = sorted.map((c, i) => {
    const rng = seededRng(i * 7919 + 31337);

    const ratio =
      c.distance !== null
        ? Math.min(c.distance / maxDist, 1)
        : 0.7 + rng() * 0.25;

    // ângulo áureo distribui bem; pequeno jitter quebra simetria
    const angle = i * GOLDEN + rng() * 0.5;

    const radius = innerR + ratio * (maxR - innerR);

    const baseX = cx + Math.cos(angle) * radius;
    const baseY = cy + Math.sin(angle) * radius;

    const dotSize = Math.max(9, Math.round(22 - ratio * 11));
    const opacity = Math.max(0.45, 1 - ratio * 0.42);

    return {
      ...c,
      baseX,
      baseY,
      dotSize,
      colorRatio: ratio,
      opacity,
      floatAmpX: 2.5 + rng() * 4,
      floatAmpY: 2.5 + rng() * 4,
      floatSpeedX: 0.25 + rng() * 0.45,
      floatSpeedY: 0.20 + rng() * 0.40,
      floatPhaseX: rng() * Math.PI * 2,
      floatPhaseY: rng() * Math.PI * 2,
    };
  });

  /* ── Relaxação anti-colisão ── */
  const cxc = cx, cyc = cy;
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b = points[j];
        const dx = b.baseX - a.baseX;
        const dy = b.baseY - a.baseY;
        const dist = Math.hypot(dx, dy) || 0.01;
        const minDist = a.dotSize + b.dotSize + 8;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.baseX -= ux * push;
          a.baseY -= uy * push;
          b.baseX += ux * push;
          b.baseY += uy * push;
        }
      }
    }
    // mantém fora do centro + dentro dos limites
    for (const p of points) {
      const dx = p.baseX - cxc;
      const dy = p.baseY - cyc;
      const d = Math.hypot(dx, dy) || 0.01;
      const minCenter = CENTER_CLEAR + p.dotSize;
      if (d < minCenter) {
        const ux = dx / d;
        const uy = dy / d;
        p.baseX = cxc + ux * minCenter;
        p.baseY = cyc + uy * minCenter;
      }
      p.baseX = Math.max(p.dotSize + 4, Math.min(w - RIGHT_RESERVE - p.dotSize - 2, p.baseX));
      p.baseY = Math.max(p.dotSize + 4, Math.min(h - p.dotSize - 4, p.baseY));
    }
  }

  return points;
}

/* ── Blue palette interpolation ─────────────────────────── */
function blueColor(ratio: number): [number, number, number] {
  const r = Math.round(147 - ratio * 116);
  const g = Math.round(197 - ratio * 133);
  const b = Math.round(253 - ratio * 78);
  return [r, g, b];
}

/* ── Background stars ───────────────────────────────────── */
function buildStars(w: number, h: number) {
  const rng = seededRng(42);
  return Array.from({ length: 55 }, () => ({
    x: rng() * w,
    y: rng() * h,
    r: 0.4 + rng() * 1.1,
    a: 0.08 + rng() * 0.18,
  }));
}

/* ── Main component ─────────────────────────────────────── */
export default function GalaxyMap({
  interested,
  registered,
  mode,
  dealerInitials,
}: {
  interested: GalaxyCustomer[];
  registered: GalaxyCustomer[];
  mode: 'interested' | 'registered';
  dealerInitials: string;
}) {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const pointsRef     = useRef<Point[]>([]);
  const starsRef      = useRef<ReturnType<typeof buildStars>>([]);
  const rafRef        = useRef<number>(0);
  const [size, setSize]         = useState({ w: 420, h: 320 });
  const [tooltip, setTooltip]   = useState<Tooltip | null>(null);
  const [filterIdx, setFilterIdx] = useState(0);

  /* Conjunto base conforme o modo (interesse × cadastrados) */
  const customers = mode === 'interested' ? interested : registered;

  /* Filtra clientes pelo raio selecionado */
  const visible = useMemo(() => {
    const max = FILTERS[filterIdx].max;
    if (max === Infinity) return customers;
    return customers.filter((c) => c.distance !== null && c.distance <= max);
  }, [customers, filterIdx]);

  /* Distância média do conjunto visível */
  const avgVisible = useMemo(() => {
    const ds = visible.map((c) => c.distance).filter((d): d is number => d !== null);
    if (!ds.length) return null;
    return Math.round(ds.reduce((a, b) => a + b, 0) / ds.length);
  }, [visible]);

  /* Resize observer */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setSize({ w: el.offsetWidth, h: el.offsetHeight });
    });
    obs.observe(el);
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => obs.disconnect();
  }, []);

  /* Rebuild quando dados/filtro/tamanho mudam */
  useEffect(() => {
    pointsRef.current = buildPoints(visible, size.w, size.h);
    starsRef.current  = buildStars(size.w, size.h);
  }, [visible, size]);

  /* Draw frame */
  const draw = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { w, h } = size;
      const cx = (w - RIGHT_RESERVE) / 2; // centro alinhado com buildPoints
      const cy = h / 2;
      const ts = t / 1000;

      ctx.clearRect(0, 0, w, h);

      /* Radial background glow */
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(cx, cy) * 1.1);
      bgGrad.addColorStop(0,   'rgba(29,78,216,0.09)');
      bgGrad.addColorStop(0.6, 'rgba(15,23,42,0)');
      bgGrad.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      /* Stars */
      starsRef.current.forEach(({ x, y, r, a }) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(148,163,184,${a})`;
        ctx.fill();
      });

      /* Connection lines (near users) */
      pointsRef.current.forEach((p) => {
        if (p.distance !== null && p.distance > 0 && p.distance < 200) {
          const px = p.baseX + Math.sin(ts * p.floatSpeedX + p.floatPhaseX) * p.floatAmpX;
          const py = p.baseY + Math.sin(ts * p.floatSpeedY + p.floatPhaseY) * p.floatAmpY;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(px, py);
          ctx.strokeStyle = 'rgba(59,130,246,0.05)';
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      });

      /* User points */
      pointsRef.current.forEach((p) => {
        const px = p.baseX + Math.sin(ts * p.floatSpeedX + p.floatPhaseX) * p.floatAmpX;
        const py = p.baseY + Math.sin(ts * p.floatSpeedY + p.floatPhaseY) * p.floatAmpY;
        const [r, g, b] = blueColor(p.colorRatio);

        const glow = ctx.createRadialGradient(px, py, 0, px, py, p.dotSize * 2.4);
        glow.addColorStop(0, `rgba(${r},${g},${b},0.22)`);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath();
        ctx.arc(px, py, p.dotSize * 2.4, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(px, py, p.dotSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${p.opacity})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(px, py, p.dotSize, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        const fs = Math.max(7, Math.floor(p.dotSize * 0.62));
        ctx.font         = `700 ${fs}px system-ui,sans-serif`;
        ctx.fillStyle    = 'rgba(255,255,255,0.95)';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.initials, px, py);
      });

      /* Center: pulse rings */
      for (let i = 0; i < 2; i++) {
        const phase = (ts + i * 1.1) % 2.2;
        const rPulse = 30 + phase * 22;
        const aPulse = Math.max(0, 0.28 - phase * 0.13);
        const pGrad  = ctx.createRadialGradient(cx, cy, 28, cx, cy, rPulse);
        pGrad.addColorStop(0, `rgba(59,130,246,${aPulse})`);
        pGrad.addColorStop(1, 'rgba(59,130,246,0)');
        ctx.beginPath();
        ctx.arc(cx, cy, rPulse, 0, Math.PI * 2);
        ctx.fillStyle = pGrad;
        ctx.fill();
      }

      const centerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 42);
      centerGlow.addColorStop(0, 'rgba(59,130,246,0.28)');
      centerGlow.addColorStop(1, 'rgba(29,78,216,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, 42, 0, Math.PI * 2);
      ctx.fillStyle = centerGlow;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, 28, 0, Math.PI * 2);
      const cFill = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 28);
      cFill.addColorStop(0, '#60a5fa');
      cFill.addColorStop(1, '#1d4ed8');
      ctx.fillStyle = cFill;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, 28, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(147,197,253,0.45)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      ctx.font         = 'bold 11px system-ui,sans-serif';
      ctx.fillStyle    = 'rgba(255,255,255,0.96)';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dealerInitials.slice(0, 3), cx, cy);
    },
    [size, dealerInitials],
  );

  /* Animation loop */
  useEffect(() => {
    const loop = (t: number) => {
      draw(t);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  /* Hover → tooltip */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ts = performance.now() / 1000;

      const hit = pointsRef.current.find((p) => {
        const px = p.baseX + Math.sin(ts * p.floatSpeedX + p.floatPhaseX) * p.floatAmpX;
        const py = p.baseY + Math.sin(ts * p.floatSpeedY + p.floatPhaseY) * p.floatAmpY;
        return Math.hypot(px - mx, py - my) <= p.dotSize + 7;
      });

      if (hit) {
        const text =
          hit.distance !== null
            ? `${hit.firstName} · ${hit.distance} km`
            : `${hit.firstName} · localização desconhecida`;
        setTooltip({ x: mx, y: my, text });
      } else {
        setTooltip(null);
      }
    },
    [],
  );

  /* ── Render ── */
  return (
    <div ref={containerRef} className="relative w-full h-full select-none">
      <canvas
        ref={canvasRef}
        width={size.w}
        height={size.h}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        className="block cursor-default"
        style={{ width: size.w, height: size.h }}
      />

      {/* Filtro de raio (lateral direita, vertical) */}
      <div className="absolute top-1/2 right-2.5 -translate-y-1/2 z-20
                      flex flex-col gap-1 bg-slate-900/70 backdrop-blur-sm
                      rounded-2xl p-1 border border-white/[.08]">
        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider
                         text-center pt-0.5 pb-1">
          Raio
        </span>
        {FILTERS.map((f, i) => {
          const count =
            f.max === Infinity
              ? customers.length
              : customers.filter((c) => c.distance !== null && c.distance <= f.max).length;
          const active = i === filterIdx;
          return (
            <button
              key={f.label}
              onClick={() => setFilterIdx(i)}
              className={`flex flex-col items-center justify-center w-12 py-1.5 rounded-xl
                          text-[10px] font-semibold leading-tight transition-all
                ${active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[.04]'}`}
            >
              <span>{f.label}</span>
              <span className={`text-[9px] ${active ? 'text-blue-200' : 'text-slate-600'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-30 whitespace-nowrap rounded-lg
                     bg-slate-800/95 px-2.5 py-1.5 text-xs font-medium text-white
                     shadow-xl backdrop-blur-sm border border-white/10"
          style={{ left: tooltip.x + 14, top: tooltip.y - 12 }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Métrica inferior */}
      {avgVisible !== null && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2
                        flex items-center gap-1.5 text-[11px] text-slate-400
                        bg-slate-900/60 backdrop-blur-sm rounded-full px-3 py-1
                        border border-white/[.06]">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
          Distância média:
          <span className="text-blue-300 font-semibold">{avgVisible} km</span>
        </div>
      )}

      {/* Empty state */}
      {visible.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-xs text-slate-600">
            {customers.length === 0
              ? mode === 'interested'
                ? 'Nenhum cliente com interesse ainda'
                : 'Nenhum cliente cadastrado ainda'
              : 'Nenhum cliente neste raio'}
          </p>
        </div>
      )}
    </div>
  );
}
