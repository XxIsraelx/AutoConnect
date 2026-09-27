import type { Metadata } from 'next';
import LandingNav from '@/components/LandingNav';
import Hero from '@/components/landing/Hero';
import Problema from '@/components/landing/Problema';
import OQueMuda from '@/components/landing/OQueMuda';
import ComoFunciona from '@/components/landing/ComoFunciona';
import SistemaNaPratica from '@/components/landing/SistemaNaPratica';
import NoCelular from '@/components/landing/NoCelular';
import Calculadora from '@/components/landing/Calculadora';
import Planos from '@/components/landing/Planos';
import Faq from '@/components/landing/Faq';
import CtaFinal from '@/components/landing/CtaFinal';
import Rodape from '@/components/landing/Rodape';
import WhatsAppFlutuante from '@/components/landing/WhatsAppFlutuante';

const DESCRICAO =
  'Estoque, leads, chat e test drive num painel só, para revendas e concessionárias. ' +
  'Peça o Raio-X gratuito: testamos o atendimento da sua loja como cliente oculto e mandamos o resultado em 24 h.';

/**
 * O link da home vai circular no WhatsApp: sem título, descrição e imagem, a
 * prévia sai como "AutoConnect" e mais nada. A imagem vem de
 * `opengraph-image.tsx`, ao lado — no grupo `(landing)` para a vitrine
 * das lojas (`/c/[slug]`) não herdar a prévia da landing.
 */
export const metadata: Metadata = {
  // Sem isto a imagem sai como `http://localhost:3000/opengraph-image` em
  // produção. Como toda NEXT_PUBLIC_*, vale o valor do `next build`.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://autoconnectapp.com.br'),
  title: 'AutoConnect — quanto tempo sua loja leva para responder?',
  description: DESCRICAO,
  openGraph: {
    title: 'Quanto tempo sua loja leva para responder um cliente no WhatsApp?',
    description: DESCRICAO,
    siteName: 'AutoConnect',
    locale: 'pt_BR',
    type: 'website',
  },
};

/**
 * Landing de captação: duas portas (Raio-X gratuito e cadastro em
 * autosserviço). Plano, seções bloqueadas e o que falta decidir:
 * `docs/planos/plano-nova-landing.md`.
 */
export default function HomePage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <LandingNav />
      <main>
        <Hero />
        <Problema />
        <OQueMuda />
        <ComoFunciona />
        <SistemaNaPratica />
        <NoCelular />
        <Calculadora />
        <Planos />
        <Faq />
        <CtaFinal />
      </main>
      <Rodape />
      <WhatsAppFlutuante />
    </div>
  );
}
