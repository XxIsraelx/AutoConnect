'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Car, FileSpreadsheet } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import VehicleImportModal from '@/components/VehicleImportModal';

interface VehicleItem {
  id: string;
  versionName: string | null;
  yearModel: number;
  yearMake: number;
  price: string;
  promoPrice: string | null;
  status: string;
  condition: string;
  mileageKm: number;
  brand: { id: string; name: string; logoUrl: string | null };
  model: { id: string; name: string };
  images: { url: string }[];
}

interface VehicleList {
  items: VehicleItem[];
  meta: { total: number; page: number; perPage: number; totalPages: number };
}

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
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), perPage: '20', status: 'available' });
    if (q) params.set('q', q);
    api<VehicleList>(`/vehicles?${params}`, { token })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, page, q, refreshKey]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Veículos</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {data ? `${data.meta.total} veículos cadastrados` : 'Carregando…'}
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

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-slate-400 text-sm">Carregando veículos…</p>
        </div>
      ) : data && data.items.length > 0 ? (
        <>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Veículo</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Ano</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">KM</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Preço</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((v) => {
                  const st = statusLabel[v.status] ?? { label: v.status, color: 'bg-slate-100 text-slate-500' };
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
                        {v.yearModel}/{v.yearMake}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {v.mileageKm.toLocaleString('pt-BR')} km
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {Number(v.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/veiculos/${v.id}`}
                          className="text-brand-accent hover:underline text-xs font-medium"
                        >
                          Editar
                        </Link>
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
          <p className="text-slate-500 font-medium">Nenhum veículo cadastrado</p>
          <Link
            href="/veiculos/novo"
            className="text-sm text-brand-accent hover:underline font-medium"
          >
            Adicionar primeiro veículo
          </Link>
        </div>
      )}
    </div>
  );
}
