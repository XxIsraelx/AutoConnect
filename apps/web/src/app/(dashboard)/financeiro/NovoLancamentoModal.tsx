'use client';

import { useState } from 'react';
import { AlertCircle, Loader2, Plus, X } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { paraApi } from '@/lib/dinheiro';
import { ROTULO_DO_GRUPO } from '@autoconnect/shared';
import { criarLancamento, type CategoriaFinanceira, type ContaFinanceira } from './dados';

const campo =
  'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 ' +
  'px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/20';

/**
 * Um lançamento novo.
 *
 * A direção **não** é campo: ela vem da categoria escolhida, como na API. Deixar
 * a pessoa marcar "entrada" e escolher "Compra de veículo" seria oferecer um
 * saldo errado em dois cliques.
 *
 * Quem digita dinheiro digita `12.345,67`; quem recebe é a API, que quer
 * `12345.67`. A tradução é `paraApi`, a mesma do preço do negócio.
 */
export default function NovoLancamentoModal({
  contas, categorias, direcaoInicial, onFechar, onCriado,
}: {
  contas: ContaFinanceira[];
  categorias: CategoriaFinanceira[];
  direcaoInicial: 'entrada' | 'saida';
  onFechar: () => void;
  onCriado: () => void;
}) {
  const token = useAuthStore((s) => s.token);

  const [direcao, setDirecao] = useState<'entrada' | 'saida'>(direcaoInicial);
  const [categoryId, setCategoryId] = useState('');
  const [valor, setValor] = useState('');
  const [vencimento, setVencimento] = useState(() => new Date().toISOString().slice(0, 10));
  const [descricao, setDescricao] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [documento, setDocumento] = useState('');
  const [jaPago, setJaPago] = useState(false);
  const [contaId, setContaId] = useState('');
  const [repetir, setRepetir] = useState(0);

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [errosDeCampo, setErrosDeCampo] = useState<Record<string, string>>({});

  const daDirecao = categorias.filter((c) => c.direction === direcao && c.active);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    const value = paraApi(valor);
    if (!value) {
      setErrosDeCampo({ value: 'Informe um valor como 1.234,56' });
      return;
    }

    setSalvando(true);
    setErro('');
    setErrosDeCampo({});
    try {
      await criarLancamento(token, {
        categoryId,
        value,
        dueDate: vencimento,
        description: descricao.trim(),
        ...(fornecedor.trim() ? { supplierName: fornecedor.trim() } : {}),
        ...(documento.trim() ? { documentNumber: documento.trim() } : {}),
        ...(jaPago ? { paidAt: vencimento, accountId: contaId } : {}),
        ...(repetir > 1 ? { repetirMeses: repetir } : {}),
      });
      onCriado();
    } catch (err) {
      // `fieldErrors` do ZodFilter marca o campo errado em vez de mostrar
      // "Validation failed" solto.
      if (err instanceof ApiError && err.fieldErrors?.length) {
        setErrosDeCampo(Object.fromEntries(err.fieldErrors.map((f) => [f.field, f.message])));
      }
      setErro(textoDoErro(err));
    } finally {
      setSalvando(false);
    }
  }

  const borda = (e?: string) => (e ? 'border-rose-400 dark:border-rose-500' : '');

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex p-4 overflow-y-auto"
         onClick={onFechar}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={salvar}
        className="w-full max-w-lg my-auto rounded-2xl bg-white dark:bg-slate-900
                   border border-slate-200 dark:border-slate-800 shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Plus size={15} className="text-blue-500" /> Novo lançamento
          </h2>
          <button type="button" onClick={onFechar} aria-label="Fechar"
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3.5">
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            {([['saida', 'Vou pagar'], ['entrada', 'Vou receber']] as const).map(([v, l]) => (
              <button key={v} type="button"
                onClick={() => { setDirecao(v); setCategoryId(''); }}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition
                  ${direcao === v ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {l}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="fl-cat" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
              Categoria
            </label>
            <select id="fl-cat" value={categoryId} required
              onChange={(e) => setCategoryId(e.target.value)}
              className={`${campo} ${borda(errosDeCampo.categoryId)}`}>
              <option value="">Escolha…</option>
              {daDirecao.map((c) => (
                <option key={c.id} value={c.id}>
                  {ROTULO_DO_GRUPO[c.group]} · {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="fl-valor" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                Valor
              </label>
              <input id="fl-valor" value={valor} onChange={(e) => setValor(e.target.value)}
                required inputMode="decimal" placeholder="1.234,56"
                className={`${campo} ${borda(errosDeCampo.value)}`} />
              {errosDeCampo.value && <p className="text-[11px] text-rose-500 mt-1">{errosDeCampo.value}</p>}
            </div>
            <div>
              <label htmlFor="fl-venc" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                Vencimento
              </label>
              <input id="fl-venc" type="date" value={vencimento} required
                onChange={(e) => setVencimento(e.target.value)}
                className={`${campo} ${borda(errosDeCampo.dueDate)}`} />
            </div>
          </div>

          <div>
            <label htmlFor="fl-desc" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
              Descrição
            </label>
            <input id="fl-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)}
              required maxLength={200} placeholder="Preparação do Onix 2020"
              className={`${campo} ${borda(errosDeCampo.description)}`} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="fl-forn" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                Fornecedor ou cliente (opcional)
              </label>
              <input id="fl-forn" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}
                maxLength={120} className={campo} />
            </div>
            <div>
              <label htmlFor="fl-doc" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                Nota ou documento (opcional)
              </label>
              <input id="fl-doc" value={documento} onChange={(e) => setDocumento(e.target.value)}
                maxLength={60} className={campo} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={jaPago}
              onChange={(e) => { setJaPago(e.target.checked); if (!e.target.checked) setContaId(''); }} />
            {direcao === 'saida' ? 'Já paguei' : 'Já recebi'}
          </label>

          {jaPago && (
            <div>
              <label htmlFor="fl-conta" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                Conta
              </label>
              <select id="fl-conta" value={contaId} required
                onChange={(e) => setContaId(e.target.value)}
                className={`${campo} ${borda(errosDeCampo.accountId)}`}>
                <option value="">Escolha a conta…</option>
                {contas.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {contas.length === 0 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  Cadastre uma conta na aba Contas para poder dar baixa.
                </p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="fl-rep" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
              Repetir por
            </label>
            <select id="fl-rep" value={repetir} onChange={(e) => setRepetir(Number(e.target.value))}
              className={campo}>
              <option value={0}>Não repetir</option>
              {[3, 6, 12, 24].map((m) => (
                <option key={m} value={m}>{m} meses</option>
              ))}
            </select>
            {/* Série com fim, sempre: repetição infinita é um fluxo de caixa que
                promete 2040 e um banco cheio de linha que ninguém olhou. */}
            <p className="text-[11px] text-slate-400 mt-1">
              A repetição cria um lançamento por mês, com o mesmo dia de vencimento.
            </p>
          </div>

          {erro && (
            <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10
                          border border-rose-200 dark:border-rose-500/20 rounded-lg px-3 py-2
                          flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" /> {erro}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onFechar}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300
                       hover:bg-slate-100 dark:hover:bg-slate-800">
            Cancelar
          </button>
          <button type="submit" disabled={salvando}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
                       bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {salvando ? <><Loader2 size={14} className="animate-spin" /> Salvando…</> : 'Lançar'}
          </button>
        </div>
      </form>
    </div>
  );
}
