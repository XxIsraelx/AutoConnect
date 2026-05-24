'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';

interface Brand { id: string; name: string }
interface Model { id: string; name: string }

interface VehicleDetail {
  id: string;
  brandId: string;
  modelId: string;
  versionName: string | null;
  yearModel: number;
  yearMake: number;
  color: string | null;
  mileageKm: number;
  fuel: string | null;
  transmission: string | null;
  condition: string;
  status: string;
  price: string;
  promoPrice: string | null;
  description: string | null;
  brand: { id: string; name: string };
  model: { id: string; name: string };
}

export default function EditVehiclePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const token = useAuthStore((s) => s.token);

  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    brandId: '', modelId: '', versionName: '',
    yearModel: 0, yearMake: 0, color: '', mileageKm: 0,
    fuel: '', transmission: '', condition: 'used', status: 'available',
    price: '', promoPrice: '', description: '',
  });

  useEffect(() => {
    if (!token) return;
    api<Brand[]>('/catalog/brands').then(setBrands).catch(console.error);
    api<VehicleDetail>(`/vehicles/${params.id}`, { token }).then((v) => {
      setVehicle(v);
      setForm({
        brandId: v.brandId, modelId: v.modelId,
        versionName: v.versionName ?? '', yearModel: v.yearModel, yearMake: v.yearMake,
        color: v.color ?? '', mileageKm: v.mileageKm, fuel: v.fuel ?? '',
        transmission: v.transmission ?? '', condition: v.condition, status: v.status,
        price: v.price, promoPrice: v.promoPrice ?? '', description: v.description ?? '',
      });
    }).catch(console.error);
  }, [token, params.id]);

  useEffect(() => {
    if (!form.brandId) { setModels([]); return; }
    api<Model[]>(`/catalog/brands/${form.brandId}/models`).then(setModels).catch(console.error);
  }, [form.brandId]);

  function set(field: string, value: string | number) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === 'brandId') next.modelId = '';
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError('');
    setLoading(true);
    try {
      await api(`/vehicles/${params.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          brandId: form.brandId, modelId: form.modelId,
          versionName: form.versionName || undefined,
          yearModel: Number(form.yearModel), yearMake: Number(form.yearMake),
          color: form.color || undefined, mileageKm: Number(form.mileageKm),
          fuel: form.fuel || undefined, transmission: form.transmission || undefined,
          condition: form.condition, status: form.status,
          price: Number(form.price),
          promoPrice: form.promoPrice ? Number(form.promoPrice) : undefined,
          description: form.description || undefined,
        }),
      });
      router.replace('/veiculos');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!token || !confirm('Tem certeza que deseja excluir este veículo?')) return;
    setDeleting(true);
    try {
      await api(`/vehicles/${params.id}`, { method: 'DELETE', token });
      router.replace('/veiculos');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir');
      setDeleting(false);
    }
  }

  if (!vehicle) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <p className="text-slate-400 text-sm">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <Link href="/veiculos" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ChevronLeft size={16} /> Voltar para veículos
        </Link>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 disabled:opacity-40"
        >
          <Trash2 size={15} />
          {deleting ? 'Excluindo…' : 'Excluir'}
        </button>
      </div>

      <h1 className="text-2xl font-bold mb-6">
        {vehicle.brand.name} {vehicle.model.name}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-700 dark:text-slate-300">Identificação</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Marca *</label>
              <select required value={form.brandId} onChange={(e) => set('brandId', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent">
                <option value="">Selecione</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Modelo *</label>
              <select required value={form.modelId} onChange={(e) => set('modelId', e.target.value)}
                disabled={!form.brandId}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent disabled:opacity-50">
                <option value="">Selecione</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Versão</label>
            <input type="text" value={form.versionName} onChange={(e) => set('versionName', e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent" />
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-700 dark:text-slate-300">Dados técnicos</h2>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Ano modelo *', field: 'yearModel' },
              { label: 'Ano fabricação *', field: 'yearMake' },
              { label: 'Quilometragem *', field: 'mileageKm' },
              { label: 'Cor', field: 'color', type: 'text' },
            ].map(({ label, field, type }) => (
              <div key={field}>
                <label className="block text-sm font-medium mb-1.5">{label}</label>
                <input type={type ?? 'number'} value={(form as Record<string, string | number>)[field]}
                  onChange={(e) => set(field, e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent" />
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium mb-1.5">Combustível</label>
              <select value={form.fuel} onChange={(e) => set('fuel', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent">
                <option value="">Selecione</option>
                <option value="gasoline">Gasolina</option>
                <option value="ethanol">Etanol</option>
                <option value="flex">Flex</option>
                <option value="diesel">Diesel</option>
                <option value="hybrid">Híbrido</option>
                <option value="electric">Elétrico</option>
                <option value="gnv">GNV</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Transmissão</label>
              <select value={form.transmission} onChange={(e) => set('transmission', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent">
                <option value="">Selecione</option>
                <option value="manual">Manual</option>
                <option value="automatic">Automático</option>
                <option value="cvt">CVT</option>
                <option value="automated_manual">Automatizado</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Condição *</label>
              <select required value={form.condition} onChange={(e) => set('condition', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent">
                <option value="used">Usado</option>
                <option value="new">Novo</option>
                <option value="semi_new">Semi-novo</option>
                <option value="demo">Demo</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Status *</label>
              <select required value={form.status} onChange={(e) => set('status', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent">
                <option value="available">Disponível</option>
                <option value="reserved">Reservado</option>
                <option value="sold">Vendido</option>
                <option value="in_maintenance">Em manutenção</option>
                <option value="archived">Arquivado</option>
              </select>
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-700 dark:text-slate-300">Preço</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Preço de tabela *</label>
              <input type="number" required min={0} step="0.01" value={form.price}
                onChange={(e) => set('price', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Preço promocional</label>
              <input type="number" min={0} step="0.01" value={form.promoPrice}
                onChange={(e) => set('promoPrice', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent" />
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <h2 className="font-semibold text-slate-700 dark:text-slate-300 mb-3">Descrição</h2>
          <textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent resize-none" />
        </section>

        {error && (
          <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 justify-end">
          <Link href="/veiculos" className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition">
            Cancelar
          </Link>
          <button type="submit" disabled={loading}
            className="px-6 py-2 bg-brand-accent text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </div>
      </form>
    </div>
  );
}
