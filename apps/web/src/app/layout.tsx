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
    // Padrão é ESCURO — a identidade do produto é dark. Só vira claro se a
    // pessoa escolher, ou se escolher 'system' e o SO estiver claro.
    var t = localStorage.getItem('autoconnect-tema') || 'dark';
    var escuro = t === 'dark' ||
      (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', escuro);
    document.documentElement.style.colorScheme = escuro ? 'dark' : 'light';
  } catch (e) {
    // localStorage bloqueado (modo privado, cookies desligados): só perde a
    // aplicação antecipada do tema. Deixar o erro subir não ajudaria ninguém.
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` vale só para os atributos do próprio `<html>`,
    // e é o uso previsto para script de tema: o SCRIPT_TEMA acima roda antes do
    // React e põe `class` e `style` aqui, que o HTML do servidor não tem. Sem
    // isto, "Extra attributes from the server: class,style" aparecia em toda
    // carga em dev e escondia aviso de hidratação de verdade.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
