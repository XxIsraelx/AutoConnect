import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'AutoConnect',
  description: 'Plataforma SaaS para concessionárias',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'AutoConnect', statusBarStyle: 'black-translucent' },
};

export const viewport = {
  themeColor: '#0f172a',
};

/**
 * Aplica o tema ANTES do primeiro paint. Sem isto a página nasce clara e
 * "pisca" para escuro quando o React hidrata — o clássico flash of wrong theme.
 * Precisa ser inline e síncrono, por isso não dá para fazer no componente.
 */
const SCRIPT_TEMA = `
(function() {
  try {
    var t = localStorage.getItem('autoconnect-tema') || 'system';
    var escuro = t === 'dark' ||
      (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', escuro);
    document.documentElement.style.colorScheme = escuro ? 'dark' : 'light';
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
