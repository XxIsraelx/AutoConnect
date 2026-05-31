import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PublicDealerClient from './PublicDealerClient';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

interface Dealer {
  id: string; slug: string; tradeName: string;
  logoUrl: string | null; brandColor: string | null;
  websiteUrl: string | null; primaryPhone: string | null;
  branches: {
    id: string; name: string; city: string; state: string;
    addressLine: string | null; addressNumber: string | null;
    neighborhood: string | null; postalCode: string | null;
    phone: string | null; email: string | null;
    latitude: number | null; longitude: number | null;
  }[];
}

async function fetchDealer(slug: string): Promise<Dealer | null> {
  try {
    const res = await fetch(`${API}/catalog/slug/${slug}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return res.json() as Promise<Dealer>;
  } catch {
    return null;
  }
}

/* ── generateMetadata (SSR) ─────────────────────────────── */
export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const dealer = await fetchDealer(slug);
  if (!dealer) return { title: 'Concessionária não encontrada' };

  const branch = dealer.branches[0];
  const desc = branch
    ? `${dealer.tradeName} em ${branch.city}/${branch.state}. Confira nosso catálogo de veículos.`
    : `${dealer.tradeName} — catálogo de veículos novos e usados.`;

  return {
    title: `${dealer.tradeName} — AutoConnect`,
    description: desc,
    openGraph: {
      title: dealer.tradeName,
      description: desc,
      images: dealer.logoUrl ? [dealer.logoUrl] : [],
    },
  };
}

/* ── Page ────────────────────────────────────────────────── */
export default async function PublicDealerPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const dealer = await fetchDealer(slug);
  if (!dealer) notFound();

  return <PublicDealerClient dealer={dealer} />;
}
