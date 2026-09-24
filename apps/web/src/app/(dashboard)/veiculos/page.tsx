'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Car, FileSpreadsheet, Eye, Heart } from 'lucide-react';
import { LISTING_STATUS_LABELS, type ListingStatusValue } from '@autoconnect/shared';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import { cn } from '@/lib/utils';
import VehicleImportModal from '@/components/VehicleImportModal';
import { EtiquetaDoAnuncio, BotaoDePublicacao } from '@/components/EstadoDoAnuncio';

interface VehicleItem {
  id: string;
  versionName: string | null;
  yearModel: number;
  yearMake: number;
  price: string;
  promoPrice: string | null;
  status: string;
  listingStatus: ListingStatusValue;
  condition: string;
  mileageKm: number;
  color: string | null;
  fuel: string | null;
  transmission: string | null;
  /** Total de fotos — a lista precisa dele para saber se dá para publicar. */
  _count?: { images: number };
  viewsCount?: number;
  favoritesCount?: number;
  publishedAt?: string | null;
  createdAt: string;
  brand: { id: string; name: string; logoUrl: string | null };
  model: { id: string; name: string };
  images: { url: string }[];
}

interface VehicleList {
  items: VehicleItem[];
  meta: { total: number; page: number; perPage: number; totalPages: number };
}

const brl = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const statusLabel: Record<string, { label: string; color: string }> = {
  available: { label: 'Disponível', color: 'bg-green-100 text-green-700' },
  reserved: { label: 'Reservado', color: 'bg-yellow-100 text-yellow-700' },
  sold: { label: 'Vendido', color: 'bg-slate-100 text-slate-500' },
  in_maintenance: { label: 'Em manutenção', color: 'bg-orange-100 text-orange-700' },
  archived: { label: 'Arquivado', color: 'bg-red-100 text-red-700' },
};

export default function VehiclesPage() {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<VehicleList | null>(null);
  const [q, setQ] = useState('');
  // Sem filtro a lista traz rascunho, publicado e despublicado juntos: a tela
  // é da loja, e esconder o rascunho dela esconderia o que falta fazer.
  const [anuncio, setAnuncio] = useState<'' | ListingStatusValue>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [erro, setErro] = useState<unknown>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setErro(null);
    const params = new URLSearchParams({ page: String(page), perPage: '20', status: 'available' });
    if (q) params.set('q', q);
    if (anuncio) params.set('listingStatus', anuncio);
    api<VehicleList>(`/vehicles?${params}`, { token })
      .then(setData)
      // Antes ia só para o console e a tela dizia "Nenhum veículo cadastrado".
      .catch((e) => { setData(null); setErro(e); })
      .finally(() => setLoading(false));
  }, [token, page, q, anuncio, refreshKey]);

  /** Troca o estado do anúncio na lista já carregada, sem recarregar tudo. */
  function aplicarPublicacao(id: string, listingStatus: ListingStatusValue) {
    setData((atual) =>
      atual
        ? {
            ...atual,
            // Com um filtro de anúncio ativo, o veículo que mudou de estado sai
            // da lista — ficar exibindo um "Rascunho" na aba "Publicados"
            // faria a tela mentir até o próximo carregamento.
            items: anuncio && anuncio !== listingStatus
              ? atual.items.filter((v) => v.id !== id)
              : atual.items.map((v) => (v.id === id ? { ...v, listingStatus } : v)),
          }
        : atual,
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Veículos</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {data ? `${data.meta.total} veículos cadastrados` : erro ? '—' : 'Carregando…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border
                       border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300
                       hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition"
          >
            <FileSpreadsheet size={16} />
            Importar
          </button>
          <Link
            href="/veiculos/novo"
            className="flex items-center gap-2 bg-brand-accent text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-600 transition"
          >
            <Plus size={16} />
            Novo veículo
          </Link>
        </div>
      </div>

      {showImport && token && (
        <VehicleImportModal
          token={token}
          onClose={() => setShowImport(false)}
          onImported={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {/* Search */}
      <div className="relative mb-5">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Buscar por marca, modelo ou versão…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
        />
      </div>

      {/* Filtro por estado do anúncio. Rola no celular em vez de quebrar. */}
      <div className="flex items-center gap-1 mb-5 overflow-x-auto -mx-1 px-1 pb-1">
        {([
          ['', 'Todos'],
          ['draft', LISTING_STATUS_LABELS.draft],
          ['published', LISTING_STATUS_LABELS.published],
          ['unpublished', LISTING_STATUS_LABELS.unpublished],
        ] as const).map(([valor, rotulo]) => (
          <button
            key={valor || 'todos'}
            onClick={() => { setAnuncio(valor); setPage(1); }}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap transition',
              anuncio === valor
                ? 'bg-brand-accent text-white border-brand-accent'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800',
            )}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-slate-400 text-sm">Carregando veículos…</p>
        </div>
      ) : erro ? (
        <ErroAoCarregar erro={erro} onTentarNovamente={() => setRefreshKey((k) => k + 1)} contexto="os veículos" />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-sm min-w-[52rem]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Veículo</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Ano</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">KM</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Preço</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500" title="Visualizações e favoritos na página pública">
                    Interesse
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500" title="Dias desde o cadastro">
                    Estoque
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500" title="Se o veículo aparece no catálogo público">
                    Anúncio
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((v) => {
                  const st = statusLabel[v.status] ?? { label: v.status, color: 'bg-slate-100 text-slate-500' };
                  // Só é promoção se houver valor E ele for menor que o de tabela.
                  const emPromocao = v.promoPrice != null && Number(v.promoPrice) > 0
                    && Number(v.promoPrice) < Number(v.price);
                  const descontoPct = emPromocao
                    ? Math.round((1 - Number(v.promoPrice) / Number(v.price)) * 100)
                    : 0;
                  const diasEmEstoque = Math.max(0, Math.floor(
                    (Date.now() - new Date(v.publishedAt ?? v.createdAt).getTime()) / 86_400_000,
                  ));
                  return (
                    <tr key={v.id} className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {v.images[0] ? (
                            <img src={v.images[0].url} alt="" className="w-12 h-9 object-cover rounded-md bg-slate-100" />
                          ) : (
                            <div className="w-12 h-9 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                              <Car size={16} className="text-slate-400" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium">
                              {v.brand.name} {v.model.name}
                            </p>
                            {v.versionName && (
                              <p className="text-xs text-slate-500">{v.versionName}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {v.yearMake}/{v.yearModel}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {v.mileageKm.toLocaleString('pt-BR')} km
                      </td>
                      <td className="px-4 py-3">
                        {emPromocao ? (
                          <>
                            {/* Promocional em destaque; o de tabela riscado ao lado,
                                para o lojista ver na hora que há desconto ativo. */}
                            <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                              {brl(v.promoPrice!)}
                            </p>
                            <p className="text-xs text-slate-400">
                              <span className="line-through">{brl(v.price)}</span>
                              <span className="ml-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                                −{descontoPct}%
                              </span>
                            </p>
                          </>
                        ) : (
                          <p className="font-medium">{brl(v.price)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span className="flex items-center gap-1" title="Visualizações">
                            <Eye size={13} /> {v.viewsCount ?? 0}
                          </span>
                          <span className="flex items-center gap-1" title="Favoritado por clientes">
                            <Heart size={13} /> {v.favoritesCount ?? 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'text-xs',
                          diasEmEstoque >= 90 ? 'text-rose-600 dark:text-rose-400 font-medium'
                          : diasEmEstoque >= 60 ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-500',
                        )}>
                          {diasEmEstoque}d
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <EtiquetaDoAnuncio listingStatus={v.listingStatus} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <BotaoDePublicacao
                            compacto
                            token={token}
                            veiculo={{
                              id: v.id,
                              status: v.status,
                              listingStatus: v.listingStatus,
                              price: v.price,
                              color: v.color,
                              fuel: v.fuel,
                              transmission: v.transmission,
                              totalDeFotos: v._count?.images ?? v.images.length,
                            }}
                            onMudou={(novo) => aplicarPublicacao(v.id, novo)}
                          />
                          <Link
                            href={`/veiculos/${v.id}`}
                            className="text-brand-accent hover:underline text-xs font-medium"
                          >
                            Editar
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.meta.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-slate-500">
                Página {data.meta.page} de {data.meta.totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page === data.meta.totalPages}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-64 gap-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 border-dashed">
          <Car size={40} className="text-slate-300" />
          <p className="text-slate-500 font-medium">
            {anuncio
              ? `Nenhum veículo em "${LISTING_STATUS_LABELS[anuncio]}"`
              : 'Nenhum veículo cadastrado'}
          </p>
          {anuncio ? (
            <button
              onClick={() => { setAnuncio(''); setPage(1); }}
              className="text-sm text-brand-accent hover:underline font-medium"
            >
              Ver todos os veículos
            </button>
          ) : (
            <Link
              href="/veiculos/novo"
              className="text-sm text-brand-accent hover:underline font-medium"
            >
              Adicionar primeiro veículo
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
