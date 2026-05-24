'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';

interface Brand { id: string; name: string }
interface Model { id: string; name: string; category: string | null }

export default function NewVehiclePage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);

  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    brandId: '',
    modelId: '',
    versionName: '',
    yearModel: new Date().getFullYear(),
    yearMake: new Date().getFullYear(),
    color: '',
    mileageKm: 0,
    fuel: '',
    transmission: '',
    condition: 'used',
    price: '',
    promoPrice: '',
    description: '',
  });

  useEffect(() => {
    api<Brand[]>('/catalog/brands').then(setBrands).catch(console.error);
  }, []);

  useEffect(() => {
    if (!form.brandId) { setModels([]); return; }
    api<Model[]>(`/catalog/brands/${form.brandId}/models`).then(setModels).catch(console.error);
  }, [form.brandId]);

  function set(field: string, value: string | number) {
    setForm((f) => ({ ...f, [field]: value }));
    if (field === 'brandId') setForm((f) => ({ ...f, brandId: value as string, modelId: '' }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError('');
    setLoading(true);
    try {
      const body = {
        brandId: form.brandId,
        modelId: form.modelId,
        versionName: form.versionName || undefined,
        yearModel: Number(form.yearModel),
        yearMake: Number(form.yearMake),
        color: form.color || undefined,
        mileageKm: Number(form.mileageKm),
        fuel: form.fuel || undefined,
        transmission: form.transmission || undefined,
        condition: form.condition,
        price: Number(form.price),
        promoPrice: form.promoPrice ? Number(form.promoPrice) : undefined,
        description: form.description || undefined,
        featureIds: [],
      };
      const vehicle = await api<{ id: string }>('/vehicles', {
        method: 'POST',
        body: JSON.stringify(body),
        token,
      });
      router.replace(`/veiculos/${vehicle.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar veículo');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link href="/veiculos" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5">
        <ChevronLeft size={16} /> Voltar para veículos
      </Link>

      <h1 className="text-2xl font-bold mb-6">Novo veículo</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identificação */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-700 dark:text-slate-300">Identificação</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Marca *</label>
              <select
                required
                value={form.brandId}
                onChange={(e) => set('brandId', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
              >
                <option value="">Selecione a marca</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Modelo *</label>
              <select
                required
                value={form.modelId}
                onChange={(e) => set('modelId', e.target.value)}
                disabled={!form.brandId}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent disabled:opacity-50"
              >
                <option value="">Selecione o modelo</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Versão / Trim</label>
            <input
              type="text"
              value={form.versionName}
              onChange={(e) => set('versionName', e.target.value)}
              placeholder="Ex: 1.4 Completo"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent"
            />
          </div>
        </section>

        {/* Dados técnicos */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-700 dark:text-slate-300">Dados técnicos</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Ano modelo *</label>
              <input type="number" required min={1950} max={2100} value={form.yearModel}
                onChange={(e) => set('yearModel', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Ano fabricação *</label>
              <input type="number" required min={1950} max={2100} value={form.yearMake}
                onChange={(e) => set('yearMake', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Quilometragem *</label>
              <input type="number" required min={0} value={form.mileageKm}
                onChange={(e) => set('mileageKm', e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Cor</label>
              <input type="text" value={form.color} onChange={(e) => set('color', e.target.value)}
                placeholder="Ex: Prata"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent" />
            </div>
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
          </div>
        </section>

        {/* Preço */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-700 dark:text-slate-300">Preço</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Preço de tabela *</label>
              <input type="number" required min={0} step="0.01" value={form.price}
                onChange={(e) => set('price', e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Preço promocional</label>
              <input type="number" min={0} step="0.01" value={form.promoPrice}
                onChange={(e) => set('promoPrice', e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent" />
            </div>
          </div>
        </section>

        {/* Descrição */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <h2 className="font-semibold text-slate-700 dark:text-slate-300 mb-3">Descrição</h2>
          <textarea
            rows={4}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Descreva o veículo, diferenciais, histórico, etc."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent resize-none"
          />
        </section>

        {error && (
          <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3 justify-end">
          <Link href="/veiculos" className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition">
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-brand-accent text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Salvando…' : 'Salvar veículo'}
          </button>
        </div>
      </form>
    </div>
  );
}
