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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
