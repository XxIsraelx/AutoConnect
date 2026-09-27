import { ImageResponse } from 'next/og';
import { LOGO_PATH, LOGO_VIEWBOX } from '@/components/logo-path';
import { COR_DA_MARCA } from '@/components/Logo';
import { TITULO_DO_HERO } from '@/components/landing/config';

/**
 * Prévia do link da home no WhatsApp, no Instagram e no LinkedIn. Gerada no
 * build a partir do título do hero: trocar a headline troca a prévia, sem
 * arquivo de imagem para lembrar de refazer.
 */
export const alt = 'AutoConnect — Raio-X gratuito do atendimento da sua loja';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: '#020617',
          color: '#f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 40, fontWeight: 700 }}>
          <svg viewBox={LOGO_VIEWBOX} width={92} height={40} fill={COR_DA_MARCA}>
            <path d={LOGO_PATH} fillRule="evenodd" />
          </svg>
          AutoConnect
        </div>
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 800, lineHeight: 1.15, letterSpacing: -1 }}>
          {TITULO_DO_HERO}
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#93c5fd' }}>
          Raio-X gratuito do atendimento · laudo em 24 h
        </div>
      </div>
    ),
    size,
  );
}
