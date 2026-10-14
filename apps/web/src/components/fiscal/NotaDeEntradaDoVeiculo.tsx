'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileInput, Loader2, RefreshCw, Save } from 'lucide-react';
import { api, ApiError, type FieldError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import CartaoDaNotaFiscal from './CartaoDaNotaFiscal';

const PAPEIS_DO_FISCAL = ['manager', 'tenant_admin', 'super_admin'];

interface QuemEntregou {
  fullName: string;
  documento: string;
  rg: string | null;
  addressLine: string | null;
  addressNumber: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  email: string | null;
}

interface Resposta {
  aquisicao: { origem: string; valor: string; entrouEm: string } | null;
  salvo: boolean;
  quemEntregou: QuemEntregou | null;
  entrada: { precisaDeNota: true; operacao: string } | { precisaDeNota: false; motivo: string } | null;
}

const VAZIO: QuemEntregou = {
  fullName: '', documento: '', rg: null, addressLine: null, addressNumber: null, complement: null,
  neighborhood: null, city: null, state: null, postalCode: null, email: null,
};

const CAMPOS: { nome: keyof QuemEntregou; rotulo: string; largo?: boolean }[] = [
  { nome: 'fullName', rotulo: 'Nome como está no documento', largo: true },
  { nome: 'documento', rotulo: 'CPF ou CNPJ' },
  { nome: 'rg', rotulo: 'RG (opcional)' },
  { nome: 'postalCode', rotulo: 'CEP' },
  { nome: 'addressLine', rotulo: 'Logradouro', largo: true },
  { nome: 'addressNumber', rotulo: 'Número' },
  { nome: 'complement', rotulo: 'Complemento' },
  { nome: 'neighborhood', rotulo: 'Bairro' },
  { nome: 'city', rotulo: 'Cidade' },
  { nome: 'state', rotulo: 'UF' },
  { nome: 'email', rotulo: 'E-mail (opcional)' },
];

const campo = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 ' +
  'px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent';

/**
 * Nota de entrada do veículo — fase N2b do plano fiscal.
 *
 * Primeiro quem entregou o carro (o remetente da nota, e o vendedor que o
 * RENAVE pede), depois a nota. A aquisição nunca pediu nome nem documento, então
 * o formulário começa com o que houver e a prévia diz o que falta.
 *
 * Quando quem emite é o outro lado (pessoa jurídica, leilão, transferência,
 * 0 km), o cartão diz isso em vez de oferecer o botão.
 */
export default function NotaDeEntradaDoVeiculo({ vehicleId }: { vehicleId: string }) {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const papel = useAuthStore((s) => s.user?.role) ?? '';
  const pode = PAPEIS_DO_FISCAL.includes(papel);
  const qc = useQueryClient();

  const [form, setForm] = useState<QuemEntregou>(VAZIO);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<FieldError[]>([]);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);

  const dados = useQuery({
    queryKey: ['fiscal-quem-entregou', vehicleId],
    queryFn: () => api<Resposta>(`/fiscal/veiculos/${vehicleId}/quem-entregou`, { token }),
    enabled: !!token && pode,
  });

  useEffect(() => {
    if (dados.data?.quemEntregou) {
      setForm(dados.data.quemEntregou);
      setEditando(!dados.data.salvo);
    }
  }, [dados.data]);

  if (!pode) return null;

  async function salvar() {
    setSalvando(true);
    setErros([]);
    setErro('');
    try {
      const r = await api<Resposta>(`/fiscal/veiculos/${vehicleId}/quem-entregou`, {
        token,
        method: 'PUT',
        body: JSON.stringify({
          fullName: form.fullName,
          documento: form.documento,
          rg: form.rg || null,
          addressLine: form.addressLine || null,
          addressNumber: form.addressNumber || null,
          complement: form.complement || null,
          neighborhood: form.neighborhood || null,
          city: form.city || null,
          state: form.state || null,
          postalCode: form.postalCode || null,
          email: form.email || null,
        }),
      });
      qc.setQueryData(['fiscal-quem-entregou', vehicleId], r);
      setVersao((v) => v + 1);
      setEditando(false);
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.length > 0) setErros(e.fieldErrors);
      else setErro(textoDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const d = dados.data;
  const erroDe = (nome: string) => erros.find((x) => x.field === nome)?.message;

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <FileInput size={16} /> Nota de entrada
        </h2>
        <button
          type="button" aria-label="Atualizar" onClick={() => dados.refetch()}
          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <RefreshCw size={13} className={dados.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {dados.isError && <ErroAoCarregar erro={dados.error} onTentarNovamente={() => dados.refetch()} />}
      {dados.isLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}

      {d && !d.aquisicao && (
        <p className="text-sm text-slate-500">
          Registre a aquisição do veículo (no custo, acima) para preparar a nota de entrada.
        </p>
      )}

      {d?.aquisicao && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Quem entregou o veículo</p>
              {!editando && (
                <button type="button" onClick={() => setEditando(true)} className="text-xs text-brand-accent">editar</button>
              )}
            </div>

            {!editando && d.salvo && (
              <p className="text-sm text-slate-700 dark:text-slate-200">
                {form.fullName} · <span className="font-mono text-xs">{form.documento}</span>
                {form.city && <span className="text-slate-500"> — {form.city}/{form.state}</span>}
              </p>
            )}

            {editando && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  {CAMPOS.map((c) => (
                    <label key={c.nome} className={`block ${c.largo ? 'sm:col-span-2' : ''}`}>
                      <span className="block text-xs text-slate-500 mb-1">{c.rotulo}</span>
                      <input
                        className={campo}
                        value={form[c.nome] ?? ''}
                        maxLength={c.nome === 'state' ? 2 : 160}
                        onChange={(e) => setForm({ ...form, [c.nome]: e.target.value })}
                      />
                      {erroDe(c.nome) && <span className="block text-xs text-rose-600 mt-1">{erroDe(c.nome)}</span>}
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-rose-600">{erro}</p>
                  <button
                    type="button" onClick={salvar} disabled={salvando}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg
                               bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {salvando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Salvar quem entregou
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <CartaoDaNotaFiscal
              embutido
              chave={['entrada', vehicleId]}
              titulo="Nota fiscal de entrada"
              rotaPrevia={`/fiscal/veiculos/${vehicleId}/entrada/previa`}
              rotaNotas={`/fiscal/veiculos/${vehicleId}/entrada/notas`}
              emitir={(presencial) => api(`/fiscal/veiculos/${vehicleId}/entrada/notas`, {
                token, method: 'POST', body: JSON.stringify({ presencial }),
              })}
              vehicleId={vehicleId}
              versaoDosDados={versao}
              rotuloPresencial="Entregue na loja"
              ondeCorrigirContraparte="Quem entregou o veículo, acima"
              ondeCorrigirValor="Valor da compra, no custo do veículo"
            />
          </div>
        </>
      )}
    </section>
  );
}
