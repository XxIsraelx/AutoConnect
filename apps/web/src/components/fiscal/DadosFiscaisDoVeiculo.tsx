'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, Save } from 'lucide-react';
import { api, ApiError, type FieldError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';

const PAPEIS_DO_FISCAL = ['manager', 'tenant_admin', 'super_admin'];

interface Dados { ncm: string | null; renavam: string | null; origem: number }

const ORIGENS: { valor: number; rotulo: string }[] = [
  { valor: 0, rotulo: 'Nacional' },
  { valor: 1, rotulo: 'Importado (importação direta)' },
  { valor: 2, rotulo: 'Importado (comprado no mercado interno)' },
];

const campo = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 ' +
  'px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent';

/**
 * NCM, RENAVAM e origem do veículo — o que a nota pede e o estoque não tem.
 *
 * Fase N1 do plano fiscal. Gerência só, como o resto do fiscal. O RENAVAM daqui
 * é o do carro para o sistema inteiro: o registro no RENAVE lê este, não pede
 * outro.
 */
export default function DadosFiscaisDoVeiculo({ vehicleId }: { vehicleId: string }) {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const papel = useAuthStore((s) => s.user?.role) ?? '';
  const pode = PAPEIS_DO_FISCAL.includes(papel);

  const [dados, setDados] = useState<Dados | null>(null);
  const [erroDeCarga, setErroDeCarga] = useState<unknown>(null);
  const [ncm, setNcm] = useState('');
  const [renavam, setRenavam] = useState('');
  const [origem, setOrigem] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<FieldError[]>([]);
  const [erro, setErro] = useState('');
  const [salvo, setSalvo] = useState(false);

  const aplicar = (d: Dados) => {
    setDados(d);
    setNcm(d.ncm ?? '');
    setRenavam(d.renavam ?? '');
    setOrigem(d.origem);
  };

  const carregar = useCallback(async () => {
    if (!token || !pode) return;
    setErroDeCarga(null);
    try {
      aplicar(await api<Dados>(`/fiscal/veiculos/${vehicleId}`, { token }));
    } catch (e) {
      setErroDeCarga(e);
    }
  }, [token, pode, vehicleId]);

  useEffect(() => { void carregar(); }, [carregar]);

  if (!pode) return null;

  async function salvar() {
    setSalvando(true);
    setErros([]);
    setErro('');
    setSalvo(false);
    try {
      aplicar(await api<Dados>(`/fiscal/veiculos/${vehicleId}`, {
        token, method: 'PUT', body: JSON.stringify({ ncm: ncm || null, renavam: renavam || null, origem }),
      }));
      setSalvo(true);
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.length > 0) setErros(e.fieldErrors);
      else setErro(textoDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const erroDe = (nome: string) => erros.find((e) => e.field === nome)?.message;

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
      <h2 className="font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-2">
        <FileText size={16} /> Dados fiscais
      </h2>
      <p className="text-xs text-slate-500 mb-3">Para a nota fiscal e o RENAVE. O chassi e a placa vêm do cadastro acima.</p>

      {erroDeCarga !== null && <ErroAoCarregar erro={erroDeCarga} onTentarNovamente={carregar} />}

      {dados && erroDeCarga === null && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="block text-xs text-slate-500 mb-1">NCM</span>
              <input className={campo} value={ncm} placeholder="8703.23.10" onChange={(e) => setNcm(e.target.value)} />
              {erroDe('ncm') && <span className="block text-xs text-rose-600 mt-1">{erroDe('ncm')}</span>}
            </label>
            <label className="block">
              <span className="block text-xs text-slate-500 mb-1">RENAVAM</span>
              <input className={campo} value={renavam} inputMode="numeric" onChange={(e) => setRenavam(e.target.value)} />
              {erroDe('renavam') && <span className="block text-xs text-rose-600 mt-1">{erroDe('renavam')}</span>}
            </label>
            <label className="block">
              <span className="block text-xs text-slate-500 mb-1">Origem</span>
              <select className={campo} value={origem} onChange={(e) => setOrigem(Number(e.target.value))}>
                {ORIGENS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center justify-between gap-3 mt-3">
            <p className="text-xs">
              {erro && <span className="text-rose-600">{erro}</span>}
              {salvo && <span className="text-emerald-600">Salvo.</span>}
            </p>
            <button
              type="button" onClick={salvar} disabled={salvando}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg
                         bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {salvando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Salvar dados fiscais
            </button>
          </div>
        </>
      )}
    </section>
  );
}
