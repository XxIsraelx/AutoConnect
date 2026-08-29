import { Metadata } from 'next';
import CatalogoContent from './CatalogoContent';

// NEXT_PUBLIC_API_URL é sempre a origem da API, sem o prefixo /api/v1 (mesma
// convenção de lib/api.ts). O prefixo é acrescentado aqui.
const API = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1`;

interface DealerMeta {
  tradeName: string;
  logoUrl: string | null;
  branches: { city: string; state: string }[];
}

async function fetchDealerMeta(tenantId: string): Promise<DealerMeta | null> {
  try {
    const res = await fetch(`${API}/catalog/dealer/${tenantId}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return res.json() as Promise<DealerMeta>;
  } catch {
    return null;
  }
}

/* ── SSR Metadata ───────────────────────────────────────── */
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const dealer = await fetchDealerMeta(id);
  if (!dealer) return { title: 'Catálogo de Veículos — AutoConnect' };

  const branch = dealer.branches?.[0];
  const title  = `${dealer.tradeName} — Catálogo de Veículos`;
  const desc   = branch
    ? `Confira os veículos disponíveis na ${dealer.tradeName} em ${branch.city}/${branch.state}.`
    : `Catálogo de veículos da ${dealer.tradeName}.`;

  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      images: dealer.logoUrl ? [dealer.logoUrl] : [],
    },
    // JSON-LD via script tag handled in client component
  };
}

/* ── Page ────────────────────────────────────────────────── */
export default function CatalogoPage() {
  return <CatalogoContent />;
}
