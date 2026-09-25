'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft, Trash2, X, Star, Loader2,
  ImagePlus, TrendingDown, TrendingUp, History,
} from 'lucide-react';
import type { ListingStatusValue } from '@autoconnect/shared';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import { EtiquetaDoAnuncio, BotaoDePublicacao } from '@/components/EstadoDoAnuncio';
import CustoDoVeiculo from './CustoDoVeiculo';
import ConsultaVeicular from './ConsultaVeicular';
import NegocioDoVeiculo from './NegocioDoVeiculo';
import AvisoDeEnvioDeFotos from '@/components/AvisoDeEnvioDeFotos';
import {
  ENVIO_DE_FOTOS_CONFIGURADO,
  avisarSeNaoConfigurada,
  enviarFotoDeVeiculo,
} from '@/lib/uploadDeFotos';

/* ── Tipos ───────────────────────────────────────────────── */

interface Brand { id: string; name: string }
interface Model { id: string; name: string }

interface VehicleImage {
  id: string;
  url: string;
  altText: string | null;
  isCover: boolean;
  position: number;
}

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
  listingStatus: ListingStatusValue;
  /// A API devolve o registro inteiro; a interface é que não os declarava.
  /// A consulta veicular precisa de um dos dois.
  licensePlate: string | null;
  vin: string | null;
  price: string;
  promoPrice: string | null;
  description: string | null;
  brand: { id: string; name: string };
  model: { id: string; name: string };
  images: VehicleImage[];
}

/**
 * Teto de fotos por veículo — o mesmo de `/veiculos/novo`.
 *
 * Os dois números divergiam: o assistente dizia "Até 12 imagens" e esta tela,
 * "máx. 10 fotos".
 */
const MAX_IMAGENS = 12;

/* ── ImageManager ────────────────────────────────────────── */

/**
 * `onTotal` existe porque o botão "Publicar" mora fora daqui e precisa saber se
 * já há foto. Sem isso ele leria a contagem que veio no carregamento da página
 * e continuaria dizendo "falta pelo menos uma foto" logo depois do upload.
 */
function ImageManager({
  vehicleId,
  onTotal,
}: {
  vehicleId: string;
  onTotal?: (total: number) => void;
}) {
  const token = useAuthStore(s => s.token);

  const [images, setImages]     = useState<VehicleImage[]>([]);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string[]>([]);
  const [error, setError]       = useState<string | null>(null);
  const [erroCarga, setErroCarga] = useState<unknown>(null);
  const inputRef                = useRef<HTMLInputElement>(null);

  // Carrega imagens do veículo
  const carregar = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setErroCarga(null);
    api<VehicleDetail>(`/vehicles/${vehicleId}`, { token })
      .then(v => setImages(v.images.sort((a, b) => {
        if (a.isCover && !b.isCover) return -1;
        if (!a.isCover && b.isCover) return 1;
        return a.position - b.position;
      })))
      // Antes virava "sem fotos": a próxima foto enviada saía marcada como
      // capa (isFirst) por cima da capa real. Com erro, o upload fica oculto.
      .catch(setErroCarga)
      .finally(() => setLoading(false));
  }, [vehicleId, token]);

  useEffect(() => { carregar(); }, [carregar]);

  // Deixa a ausência de configuração no console, como o `DocumentosStorage`
  // faz no boot da API. A faixa acima da zona de upload é para o lojista.
  useEffect(() => { avisarSeNaoConfigurada(); }, []);

  // Um efeito só, sobre o estado final: avisar dentro de cada handler daria
  // uma contagem por caminho, e o de upload roda em laço.
  useEffect(() => {
    if (!loading && !erroCarga) onTotal?.(images.length);
  }, [images.length, loading, erroCarga, onTotal]);

  async function handleFiles(files: FileList | File[]) {
    if (!token) return;
    setUploading(true);
    setError(null);
    const fileArr = Array.from(files).slice(0, MAX_IMAGENS - images.length);
    const newNames = fileArr.map(f => f.name);
    setUploadProgress(newNames);

    for (const file of fileArr) {
      try {
        const url = await enviarFotoDeVeiculo(file);
        const isFirst = images.length === 0;
        const img = await api<VehicleImage>(`/vehicles/${vehicleId}/images`, {
          method: 'POST',
          token,
          body: JSON.stringify({ url, isCover: isFirst, altText: file.name.split('.')[0] }),
        });
        setImages(prev => {
          const next = [...prev, img];
          if (isFirst) return next;
          return next;
        });
      } catch (e) {
        // A causa vem do erro: "Falha no upload da imagem" era a mesma frase
        // para ambiente sem integração, preset errado e arquivo recusado.
        setError(textoDoErro(e));
      }
    }
    setUploading(false);
    setUploadProgress([]);
  }

  async function handleDelete(imageId: string) {
    if (!token || !confirm('Remover esta imagem?')) return;
    try {
      await api(`/vehicles/${vehicleId}/images/${imageId}`, { method: 'DELETE', token });
      setImages(prev => prev.filter(i => i.id !== imageId));
    } catch {
      setError('Erro ao remover imagem');
    }
  }

  async function handleSetCover(imageId: string) {
    if (!token) return;
    try {
      await api(`/vehicles/${vehicleId}/images/${imageId}/cover`, { method: 'PATCH', token });
      setImages(prev => prev.map(i => ({ ...i, isCover: i.id === imageId })));
    } catch {
      setError('Erro ao definir capa');
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
      <h2 className="font-semibold text-slate-700 dark:text-slate-300 mb-4">Fotos do veículo</h2>

      {error && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2 mb-3">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Loader2 size={14} className="animate-spin" />
          Carregando imagens…
        </div>
      ) : erroCarga ? (
        <ErroAoCarregar erro={erroCarga} onTentarNovamente={carregar} contexto="as fotos" />
      ) : (
        <>
          {/* Grid de imagens existentes */}
          {images.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mb-4">
              {images.map((img) => (
                <div
                  key={img.id}
                  className={`relative group rounded-xl overflow-hidden aspect-square border-2 transition-all
                    ${img.isCover
                      ? 'border-blue-500 ring-1 ring-blue-500/30'
                      : 'border-transparent hover:border-slate-300 dark:hover:border-slate-600'}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.altText ?? ''} className="w-full h-full object-cover" />

                  {/* Capa badge */}
                  {img.isCover && (
                    <div className="absolute top-1 left-1 bg-blue-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                      Capa
                    </div>
                  )}

                  {/* Ações no hover */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity
                                  flex items-center justify-center gap-1.5">
                    {!img.isCover && (
                      <button
                        onClick={() => handleSetCover(img.id)}
                        title="Definir como capa"
                        className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center
                                   hover:bg-blue-500 transition-colors"
                      >
                        <Star size={12} />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(img.id)}
                      title="Remover"
                      className="w-7 h-7 rounded-full bg-rose-600 text-white flex items-center justify-center
                                 hover:bg-rose-500 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}

              {/* Uploading placeholders */}
              {uploading && uploadProgress.map((name, i) => (
                <div key={i} className="relative aspect-square rounded-xl bg-slate-100 dark:bg-slate-800
                                        border-2 border-dashed border-slate-300 dark:border-slate-700
                                        flex flex-col items-center justify-center gap-1">
                  <Loader2 size={18} className="animate-spin text-blue-500" />
                  <p className="text-[9px] text-slate-400 text-center px-1 truncate w-full">{name}</p>
                </div>
              ))}
            </div>
          )}

          <AvisoDeEnvioDeFotos className="mb-3" />

          {/* Upload zone */}
          {images.length < MAX_IMAGENS && ENVIO_DE_FOTOS_CONFIGURADO && (
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => inputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 dark:border-slate-700
                         rounded-xl p-6 text-center cursor-pointer
                         hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/[.05]
                         transition-all group"
            >
              <div className="flex flex-col items-center gap-2">
                <ImagePlus size={28} className="text-slate-300 dark:text-slate-600 group-hover:text-blue-400 transition-colors" />
                <div>
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 group-hover:text-blue-500 transition-colors">
                    {uploading ? 'Enviando…' : 'Clique ou arraste fotos aqui'}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    JPG, PNG, WebP — máx. {MAX_IMAGENS} fotos ({MAX_IMAGENS - images.length} restante{MAX_IMAGENS - images.length !== 1 ? 's' : ''})
                  </p>
                </div>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={e => e.target.files && handleFiles(e.target.files)}
              />
            </div>
          )}

          {images.length === 0 && !uploading && (
            <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
              <Star size={12} />
              A primeira foto adicionada será a capa automaticamente.
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ── Histórico de preço ──────────────────────────────────── */

interface PriceEvent {
  id: string;
  eventType: string;
  createdAt: string;
  actor: { fullName: string | null } | null;
  payload: {
    fromPrice?: number; toPrice?: number;
    fromPromo?: number | null; toPromo?: number | null;
  };
}

function brl(v: number | null | undefined) {
  if (v == null) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function PriceHistory({ vehicleId }: { vehicleId: string }) {
  const token = useAuthStore((s) => s.token);
  const [events, setEvents] = useState<PriceEvent[] | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!token) return;
    setErro(null);
    api<PriceEvent[]>(`/vehicles/${vehicleId}/history`, { token })
      .then((all) => setEvents(all.filter((e) => e.eventType === 'price_change')))
      // A seção some quando não há mudança de preço; sem este aviso, uma
      // falha ficaria idêntica a "o preço nunca mudou".
      .catch(setErro);
  }, [vehicleId, token, tentativa]);

  if (erro) {
    return (
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
        <h2 className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <History size={16} className="text-slate-400" />
          Histórico de preço
        </h2>
        <ErroAoCarregar erro={erro} onTentarNovamente={() => setTentativa((n) => n + 1)} contexto="o histórico de preço" />
      </section>
    );
  }

  if (!events || events.length === 0) return null;

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
      <h2 className="font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
        <History size={16} className="text-slate-400" />
        Histórico de preço
      </h2>
      <ol className="space-y-3">
        {events.map((e) => {
          const from = e.payload.toPromo != null || e.payload.fromPromo != null
            ? (e.payload.fromPromo ?? e.payload.fromPrice)
            : e.payload.fromPrice;
          const to = e.payload.toPromo != null || e.payload.fromPromo != null
            ? (e.payload.toPromo ?? e.payload.toPrice)
            : e.payload.toPrice;
          const dropped = (to ?? 0) < (from ?? 0);
          const date = new Date(e.createdAt).toLocaleDateString('pt-BR', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
          });
          return (
            <li key={e.id} className="flex items-center gap-3 text-sm">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0
                ${dropped ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                          : 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400'}`}>
                {dropped ? <TrendingDown size={15} /> : <TrendingUp size={15} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">
                  <span className="text-slate-400 line-through">{brl(from)}</span>
                  {' → '}
                  <span className={dropped ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                    {brl(to)}
                  </span>
                </p>
                <p className="text-xs text-slate-400">
                  {date}{e.actor?.fullName ? ` · ${e.actor.fullName}` : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ── Página principal ────────────────────────────────────── */

export default function EditVehiclePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const token = useAuthStore((s) => s.token);

  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  // Contagem viva das fotos, alimentada pelo ImageManager.
  const [totalDeFotos, setTotalDeFotos] = useState(0);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [erroVeiculo, setErroVeiculo] = useState<unknown>(null);
  const [erroCatalogo, setErroCatalogo] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [tentativaCatalogo, setTentativaCatalogo] = useState(0);

  const [form, setForm] = useState({
    brandId: '', modelId: '', versionName: '',
    yearModel: 0, yearMake: 0, color: '', mileageKm: 0,
    fuel: '', transmission: '', condition: 'used', status: 'available',
    price: '', promoPrice: '', description: '',
  });

  // Sem a lista de marcas o <select> não tem a opção salva e o "required"
  // barra o envio sem explicar por quê — então o motivo aparece no form.
  // Efeito separado do veículo: tentar de novo aqui não apaga o que foi editado.
  useEffect(() => {
    setErroCatalogo(null);
    api<Brand[]>('/catalog/brands').then(setBrands)
      .catch((e) => setErroCatalogo(textoDoErro(e)));
  }, [tentativaCatalogo]);

  useEffect(() => {
    if (!token) return;
    setErroVeiculo(null);
    api<VehicleDetail>(`/vehicles/${params.id}`, { token }).then((v) => {
      setVehicle(v);
      setForm({
        brandId: v.brandId, modelId: v.modelId,
        versionName: v.versionName ?? '', yearModel: v.yearModel, yearMake: v.yearMake,
        color: v.color ?? '', mileageKm: v.mileageKm, fuel: v.fuel ?? '',
        transmission: v.transmission ?? '', condition: v.condition, status: v.status,
        price: v.price, promoPrice: v.promoPrice ?? '', description: v.description ?? '',
      });
    // Antes ia só para o console e a tela ficava no spinner para sempre.
    }).catch(setErroVeiculo);
  }, [token, params.id, tentativa]);

  useEffect(() => {
    if (!form.brandId) { setModels([]); return; }
    api<Model[]>(`/catalog/brands/${form.brandId}/models`).then(setModels)
      .catch((e) => setErroCatalogo(textoDoErro(e)));
  }, [form.brandId, tentativaCatalogo]);

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
          condition: form.condition,
          // `sold` não vai: é o faturamento do negócio que o grava, e a API
          // recusa. Reenviá-lo ao salvar qualquer outro campo de um carro já
          // vendido derrubaria o formulário inteiro.
          status: form.status === 'sold' ? undefined : form.status,
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

  if (erroVeiculo) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href="/veiculos" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ChevronLeft size={16} /> Voltar para veículos
        </Link>
        <ErroAoCarregar erro={erroVeiculo} onTentarNovamente={() => setTentativa((n) => n + 1)} contexto="o veículo" />
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-slate-400" />
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

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">
            {vehicle.brand.name} {vehicle.model.name}
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <EtiquetaDoAnuncio listingStatus={vehicle.listingStatus} />
            <span className="text-xs text-slate-500">
              {vehicle.listingStatus === 'published'
                ? 'Aparece no catálogo público e na busca.'
                : 'Fora do catálogo público — só a loja vê.'}
            </span>
          </div>
        </div>

        {/* A conferência usa o que está SALVO, não o formulário: publicar lê o
            banco. Se o lojista acabou de digitar a cor, salvar vem primeiro. */}
        <BotaoDePublicacao
          token={token}
          veiculo={{
            id: vehicle.id,
            status: vehicle.status,
            listingStatus: vehicle.listingStatus,
            price: vehicle.price,
            color: vehicle.color,
            fuel: vehicle.fuel,
            transmission: vehicle.transmission,
            totalDeFotos,
          }}
          onMudou={(listingStatus) =>
            setVehicle((v) => (v ? { ...v, listingStatus } : v))
          }
        />
      </div>

      {/* ── FOTOS ──────────────────────────────────────── */}
      <div className="mb-6">
        <ImageManager vehicleId={params.id} onTotal={setTotalDeFotos} />
      </div>

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
          {erroCatalogo && (
            <p className="text-xs text-red-500 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              Não foi possível carregar marcas e modelos: {erroCatalogo}{' '}
              <button type="button" onClick={() => setTentativaCatalogo((n) => n + 1)} className="font-medium underline">
                Tentar novamente
              </button>
            </p>
          )}
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
                <option value="in_maintenance">Em manutenção</option>
                <option value="archived">Arquivado</option>
                {/* "Vendido" só aparece quando já é o estado do carro, e
                    desabilitado: quem marca vendido é o faturamento do negócio,
                    que grava a data da venda e congela a margem. Escolher aqui
                    produziria um carro vendido sem negócio e sem margem. */}
                {form.status === 'sold' && (
                  <option value="sold" disabled>Vendido (pelo negócio)</option>
                )}
              </select>
              {form.status === 'sold' && (
                <p className="text-xs text-slate-500 mt-1">
                  Este carro foi vendido em um negócio. Para devolvê-lo ao estoque,
                  distrate o negócio.
                </p>
              )}
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

        <NegocioDoVeiculo vehicleId={params.id} preco={vehicle?.price ?? null} />

        <CustoDoVeiculo vehicleId={params.id} />

        <ConsultaVeicular
          vehicleId={params.id}
          placa={vehicle?.licensePlate ?? null}
          chassi={vehicle?.vin ?? null}
        />

        <PriceHistory vehicleId={params.id} />

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <h2 className="font-semibold text-slate-700 dark:text-slate-300 mb-3">Descrição</h2>
          <textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)}
            placeholder="Descreva o veículo, diferenciais, histórico de manutenção, etc."
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
