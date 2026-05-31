'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, Check, Car, Gauge, DollarSign, ImagePlus,
  Search, Plus, X, Loader2, Star, Upload, Calendar, Users, BadgeCheck,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';

/* ── Tipos ───────────────────────────────────────────────── */
interface Brand { id: string; name: string }
interface Model { id: string; name: string; category: string | null }
interface UploadedImage { url: string; uploading?: boolean; name: string }

/* ── Cloudinary ──────────────────────────────────────────── */
const CLOUD_NAME    = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '';
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? '';

async function uploadToCloudinary(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', UPLOAD_PRESET);
  form.append('folder', 'autoconnect/vehicles');
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: 'POST', body: form },
  );
  if (!res.ok) throw new Error('Falha no upload da imagem');
  const data = await res.json() as { secure_url: string };
  return data.secure_url;
}

/* ── Helpers ─────────────────────────────────────────────── */
function brl(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const num = (parseInt(digits, 10) / 100).toFixed(2);
  return num.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function brlToNumber(masked: string): number {
  const digits = masked.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) / 100 : 0;
}
function formatKm(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
/** "usado há X anos e Y meses" a partir de "YYYY-MM" */
function usageLabel(firstReg: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(firstReg)) return null;
  const [y, m] = firstReg.split('-').map(Number);
  const now = new Date();
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  if (months < 0) return null;
  const years = Math.floor(months / 12);
  months = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ano${years !== 1 ? 's' : ''}`);
  if (months > 0) parts.push(`${months} ${months !== 1 ? 'meses' : 'mês'}`);
  if (parts.length === 0) return 'em uso há menos de 1 mês';
  return `em uso há ${parts.join(' e ')}`;
}

/* ── Combobox com criar-na-hora ──────────────────────────── */
function Combobox({
  label, placeholder, value, displayName, options, disabled,
  onSelect, onCreate, loading,
}: {
  label: string;
  placeholder: string;
  value: string;
  displayName: string;
  options: { id: string; name: string }[];
  disabled?: boolean;
  loading?: boolean;
  onSelect: (id: string, name: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [query, options]);

  const exactMatch = options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase());
  const canCreate = query.trim().length >= 1 && !exactMatch;

  async function handleCreate() {
    if (!canCreate) return;
    setCreating(true);
    try {
      await onCreate(query.trim());
      setOpen(false);
      setQuery('');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm
                    text-left transition-all
          ${disabled
            ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 opacity-50 cursor-not-allowed'
            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-300 dark:hover:border-blue-600'}`}
      >
        <span className={value ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-400'}>
          {displayName || placeholder}
        </span>
        {loading
          ? <Loader2 size={15} className="animate-spin text-slate-400" />
          : <ChevronRight size={15} className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />}
      </button>

      {open && !disabled && (
        <div className="absolute z-30 mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700
                        bg-white dark:bg-slate-800 shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ou digitar novo…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>

          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => { onSelect(o.id, o.name); setOpen(false); setQuery(''); }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-left
                           hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <span>{o.name}</span>
                {value === o.id && <Check size={14} className="text-blue-500" />}
              </button>
            ))}

            {filtered.length === 0 && !canCreate && (
              <p className="px-3 py-3 text-xs text-slate-400 text-center">Nenhum resultado</p>
            )}

            {canCreate && (
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left
                           text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10
                           transition-colors border-t border-slate-100 dark:border-slate-700"
              >
                {creating
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Plus size={14} />}
                Criar <span className="font-semibold">&ldquo;{query.trim()}&rdquo;</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Input genérico ──────────────────────────────────────── */
function Field({
  label, children, hint, className = '',
}: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 ' +
  'px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition';

/* ── Steps config ────────────────────────────────────────── */
const STEPS = [
  { id: 1, label: 'Identificação', icon: Car },
  { id: 2, label: 'Dados técnicos', icon: Gauge },
  { id: 3, label: 'Preço',          icon: DollarSign },
  { id: 4, label: 'Fotos',          icon: ImagePlus },
];

/* ═══════════════════════════════════════════════════════════ */
export default function NewVehiclePage() {
  const router = useRouter();
  const token  = useAuthStore((s) => s.token);

  const [step, setStep]     = useState(1);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]   = useState('');

  const [images, setImages] = useState<UploadedImage[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const thisYear = new Date().getFullYear();
  const [form, setForm] = useState({
    brandId: '', brandName: '',
    modelId: '', modelName: '',
    versionName: '',
    condition: 'used',
    yearModel: String(thisYear),
    yearMake: String(thisYear),
    mileageKm: '',
    color: '',
    fuel: '',
    transmission: '',
    engine: '',
    doors: '',
    previousOwners: '',
    firstRegistration: '',
    singleOwner: false,
    price: '',
    promoPrice: '',
    description: '',
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  /* carrega marcas */
  useEffect(() => {
    api<Brand[]>('/catalog/brands').then(setBrands).catch(console.error);
  }, []);

  /* carrega modelos ao escolher marca */
  useEffect(() => {
    if (!form.brandId) { setModels([]); return; }
    setLoadingModels(true);
    api<Model[]>(`/catalog/brands/${form.brandId}/models`)
      .then(setModels).catch(console.error).finally(() => setLoadingModels(false));
  }, [form.brandId]);

  /* criar marca/modelo */
  async function createBrand(name: string) {
    const b = await api<Brand>('/catalog/brands', { method: 'POST', token: token!, body: { name } });
    setBrands((prev) => [...prev, b].sort((a, z) => a.name.localeCompare(z.name)));
    setForm((f) => ({ ...f, brandId: b.id, brandName: b.name, modelId: '', modelName: '' }));
  }
  async function createModel(name: string) {
    const m = await api<Model>(`/catalog/brands/${form.brandId}/models`, {
      method: 'POST', token: token!, body: { name },
    });
    setModels((prev) => [...prev, m].sort((a, z) => a.name.localeCompare(z.name)));
    setForm((f) => ({ ...f, modelId: m.id, modelName: m.name }));
  }

  const isUsed = form.condition !== 'new';
  const usage  = form.firstRegistration ? usageLabel(form.firstRegistration) : null;

  /* validação por passo */
  const canNext = useMemo(() => {
    if (step === 1) return !!form.brandId && !!form.modelId;
    if (step === 2) return !!form.yearModel && !!form.yearMake && form.mileageKm !== '';
    if (step === 3) return brlToNumber(form.price) > 0;
    return true;
  }, [step, form]);

  /* upload de imagens */
  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files).slice(0, 12 - images.length);
    for (const file of arr) {
      const placeholder: UploadedImage = { url: '', uploading: true, name: file.name };
      setImages((prev) => [...prev, placeholder]);
      try {
        const url = await uploadToCloudinary(file);
        setImages((prev) => prev.map((im) =>
          im === placeholder ? { url, name: file.name } : im));
      } catch {
        setImages((prev) => prev.filter((im) => im !== placeholder));
        setError('Falha ao enviar uma das imagens.');
      }
    }
  }

  /* finalizar */
  async function handleFinish() {
    if (!token) return;
    setError(''); setSubmitting(true);
    try {
      const body = {
        brandId: form.brandId,
        modelId: form.modelId,
        versionName: form.versionName || undefined,
        condition: form.condition,
        yearModel: Number(form.yearModel),
        yearMake: Number(form.yearMake),
        mileageKm: Number(form.mileageKm.replace(/\D/g, '')) || 0,
        color: form.color || undefined,
        fuel: form.fuel || undefined,
        transmission: form.transmission || undefined,
        engine: form.engine || undefined,
        doors: form.doors ? Number(form.doors) : undefined,
        price: brlToNumber(form.price),
        promoPrice: form.promoPrice ? brlToNumber(form.promoPrice) : undefined,
        description: form.description || undefined,
        featureIds: [],
        ...(isUsed && form.previousOwners ? { previousOwners: Number(form.previousOwners) } : {}),
        ...(isUsed && form.firstRegistration ? { firstRegistration: form.firstRegistration } : {}),
        ...(isUsed ? { singleOwner: form.singleOwner } : {}),
      };
      const vehicle = await api<{ id: string }>('/vehicles', { method: 'POST', token, body });

      // anexa imagens
      const ready = images.filter((im) => im.url);
      for (let i = 0; i < ready.length; i++) {
        await api(`/vehicles/${vehicle.id}/images`, {
          method: 'POST', token,
          body: { url: ready[i].url, isCover: i === 0, altText: ready[i].name.split('.')[0] },
        });
      }
      router.replace(`/veiculos/${vehicle.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar veículo');
      setSubmitting(false);
    }
  }

  /* ── Render ── */
  return (
    <div className="p-6 max-w-3xl mx-auto pb-28">
      <Link href="/veiculos" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-5">
        <ChevronLeft size={16} /> Voltar para veículos
      </Link>

      <h1 className="text-2xl font-bold mb-1">Novo veículo</h1>
      <p className="text-sm text-slate-500 mb-6">Preencha as etapas para cadastrar o veículo no estoque.</p>

      {/* Stepper */}
      <div className="flex items-center mb-8">
        {STEPS.map((s, i) => {
          const active = step === s.id;
          const done   = step > s.id;
          const Icon   = s.icon;
          return (
            <div key={s.id} className="flex items-center flex-1 last:flex-none">
              <button
                type="button"
                onClick={() => (s.id < step) && setStep(s.id)}
                className={`flex items-center gap-2 ${s.id < step ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span className={`flex items-center justify-center w-9 h-9 rounded-full border-2 transition-all shrink-0
                  ${done   ? 'bg-blue-600 border-blue-600 text-white'
                  : active ? 'border-blue-600 text-blue-600 bg-blue-50 dark:bg-blue-500/10'
                           : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                  {done ? <Check size={16} /> : <Icon size={16} />}
                </span>
                <span className={`text-xs font-semibold hidden sm:block
                  ${active ? 'text-blue-600' : done ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400'}`}>
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 mx-2 rounded ${step > s.id ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── PASSO 1: Identificação ── */}
      {step === 1 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Combobox
              label="Marca *" placeholder="Selecione a marca"
              value={form.brandId} displayName={form.brandName}
              options={brands}
              onSelect={(id, name) => setForm((f) => ({ ...f, brandId: id, brandName: name, modelId: '', modelName: '' }))}
              onCreate={createBrand}
            />
            <Combobox
              label="Modelo *" placeholder={form.brandId ? 'Selecione o modelo' : 'Escolha a marca antes'}
              value={form.modelId} displayName={form.modelName}
              options={models} disabled={!form.brandId} loading={loadingModels}
              onSelect={(id, name) => setForm((f) => ({ ...f, modelId: id, modelName: name }))}
              onCreate={createModel}
            />
          </div>

          <Field label="Versão / Trim" hint="Opcional — ex: 1.0 Turbo Comfortline">
            <input type="text" value={form.versionName}
              onChange={(e) => set('versionName', e.target.value)}
              placeholder="Ex: 1.4 Completo" className={inputCls} />
          </Field>

          <Field label="Condição *">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { v: 'used', l: 'Usado' },
                { v: 'semi_new', l: 'Semi-novo' },
                { v: 'new', l: 'Novo' },
                { v: 'demo', l: 'Demo' },
              ].map((c) => (
                <button key={c.v} type="button"
                  onClick={() => set('condition', c.v)}
                  className={`py-2.5 rounded-lg text-sm font-medium border-2 transition-all
                    ${form.condition === c.v
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-500/10 text-blue-600'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'}`}>
                  {c.l}
                </button>
              ))}
            </div>
          </Field>
        </div>
      )}

      {/* ── PASSO 2: Dados técnicos ── */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Field label="Ano modelo *">
              <input type="number" min={1950} max={thisYear + 1} value={form.yearModel}
                onChange={(e) => set('yearModel', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Ano fabricação *">
              <input type="number" min={1950} max={thisYear + 1} value={form.yearMake}
                onChange={(e) => set('yearMake', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Quilometragem *">
              <div className="relative">
                <input type="text" inputMode="numeric" value={form.mileageKm}
                  onChange={(e) => set('mileageKm', formatKm(e.target.value))}
                  placeholder="0" className={`${inputCls} pr-9`} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">km</span>
              </div>
            </Field>
            <Field label="Cor">
              <input type="text" value={form.color} onChange={(e) => set('color', e.target.value)}
                placeholder="Ex: Prata" className={inputCls} />
            </Field>
            <Field label="Motor">
              <input type="text" value={form.engine} onChange={(e) => set('engine', e.target.value)}
                placeholder="Ex: 1.0 Turbo" className={inputCls} />
            </Field>
            <Field label="Portas">
              <select value={form.doors} onChange={(e) => set('doors', e.target.value)} className={inputCls}>
                <option value="">—</option>
                <option value="2">2 portas</option>
                <option value="3">3 portas</option>
                <option value="4">4 portas</option>
                <option value="5">5 portas</option>
              </select>
            </Field>
            <Field label="Combustível">
              <select value={form.fuel} onChange={(e) => set('fuel', e.target.value)} className={inputCls}>
                <option value="">Selecione</option>
                <option value="flex">Flex</option>
                <option value="gasoline">Gasolina</option>
                <option value="ethanol">Etanol</option>
                <option value="diesel">Diesel</option>
                <option value="hybrid">Híbrido</option>
                <option value="electric">Elétrico</option>
                <option value="gnv">GNV</option>
              </select>
            </Field>
            <Field label="Transmissão">
              <select value={form.transmission} onChange={(e) => set('transmission', e.target.value)} className={inputCls}>
                <option value="">Selecione</option>
                <option value="manual">Manual</option>
                <option value="automatic">Automático</option>
                <option value="cvt">CVT</option>
                <option value="automated_manual">Automatizado</option>
              </select>
            </Field>
          </div>

          {/* Histórico de uso — só p/ usados */}
          {isUsed && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4
                            bg-slate-50/60 dark:bg-slate-900/40">
              <div className="flex items-center gap-2">
                <BadgeCheck size={16} className="text-blue-500" />
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Histórico de uso</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Donos anteriores">
                  <div className="relative">
                    <Users size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="number" min={0} max={50} value={form.previousOwners}
                      onChange={(e) => set('previousOwners', e.target.value)}
                      placeholder="Ex: 1" className={`${inputCls} pl-9`} />
                  </div>
                </Field>
                <Field label="1º emplacamento" hint={usage ?? 'Mês/ano em que o carro foi emplacado'}>
                  <div className="relative">
                    <Calendar size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="month" value={form.firstRegistration}
                      onChange={(e) => set('firstRegistration', e.target.value)}
                      max={`${thisYear}-12`} className={`${inputCls} pl-9`} />
                  </div>
                </Field>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={form.singleOwner}
                  onChange={(e) => set('singleOwner', e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm text-slate-600 dark:text-slate-300">Único dono</span>
              </label>
              {usage && (
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                  <Calendar size={12} /> {usage.charAt(0).toUpperCase() + usage.slice(1)}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── PASSO 3: Preço ── */}
      {step === 3 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Preço de tabela *">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">R$</span>
                <input type="text" inputMode="numeric" value={form.price}
                  onChange={(e) => set('price', brl(e.target.value))}
                  placeholder="0,00" className={`${inputCls} pl-9`} />
              </div>
            </Field>
            <Field label="Preço promocional" hint="Opcional — exibido como oferta">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">R$</span>
                <input type="text" inputMode="numeric" value={form.promoPrice}
                  onChange={(e) => set('promoPrice', brl(e.target.value))}
                  placeholder="0,00" className={`${inputCls} pl-9`} />
              </div>
            </Field>
          </div>

          {brlToNumber(form.promoPrice) > 0 && brlToNumber(form.price) > 0 &&
           brlToNumber(form.promoPrice) < brlToNumber(form.price) && (
            <p className="text-sm text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg px-3 py-2">
              Desconto de R$ {brl(String(Math.round((brlToNumber(form.price) - brlToNumber(form.promoPrice)) * 100)))}
              {' '}({Math.round((1 - brlToNumber(form.promoPrice) / brlToNumber(form.price)) * 100)}%)
            </p>
          )}

          <Field label="Descrição">
            <textarea rows={5} value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Descreva o veículo, diferenciais, histórico, estado de conservação…"
              className={`${inputCls} resize-none`} />
          </Field>
        </div>
      )}

      {/* ── PASSO 4: Fotos ── */}
      {step === 4 && (
        <div className="space-y-5">
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl
                       p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
          >
            <input ref={fileRef} type="file" accept="image/*" multiple hidden
              onChange={(e) => e.target.files && handleFiles(e.target.files)} />
            <Upload size={28} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Arraste as fotos aqui ou clique para selecionar
            </p>
            <p className="text-xs text-slate-400 mt-1">Até 12 imagens · a 1ª será a capa</p>
          </div>

          {images.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {images.map((img, i) => (
                <div key={i} className="relative aspect-[4/3] rounded-lg overflow-hidden
                                        border border-slate-200 dark:border-slate-700 group">
                  {img.uploading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800">
                      <Loader2 size={20} className="animate-spin text-slate-400" />
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                  )}
                  {i === 0 && !img.uploading && (
                    <span className="absolute top-1 left-1 flex items-center gap-0.5 bg-blue-600 text-white
                                     text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                      <Star size={8} className="fill-white" /> Capa
                    </span>
                  )}
                  {!img.uploading && (
                    <button type="button"
                      onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white
                                 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-400">
            As fotos são opcionais agora — você pode adicionar mais depois na página do veículo.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-5 text-sm text-red-500 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Footer nav (fixo) */}
      <div className="fixed bottom-0 left-0 right-0 sm:left-64 bg-white/90 dark:bg-slate-950/90 backdrop-blur
                      border-t border-slate-200 dark:border-slate-800 px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => step > 1 ? setStep(step - 1) : router.push('/veiculos')}
            className="px-4 py-2.5 text-sm font-medium border border-slate-200 dark:border-slate-700
                       rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            {step > 1 ? 'Voltar' : 'Cancelar'}
          </button>

          {step < 4 ? (
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setStep(step + 1)}
              className="flex items-center gap-1.5 px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold
                         rounded-lg hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Próximo <ChevronRight size={16} />
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting || images.some((i) => i.uploading)}
              onClick={handleFinish}
              className="flex items-center gap-1.5 px-6 py-2.5 bg-emerald-600 text-white text-sm font-semibold
                         rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <><Loader2 size={16} className="animate-spin" /> Salvando…</> : <><Check size={16} /> Finalizar cadastro</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
