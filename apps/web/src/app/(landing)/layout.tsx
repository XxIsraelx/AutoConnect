import Clarity from '@/components/landing/Clarity';

/**
 * Grupo das páginas de captação (home e `/raio-x`). Existe por dois motivos:
 * a prévia de link (`opengraph-image.tsx`) não vaza para a vitrine das lojas,
 * e o Clarity fica só aqui, longe do painel.
 */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Clarity />
    </>
  );
}
