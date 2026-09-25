'use client';

/**
 * Preço de tabela, desconto e valor de venda — editáveis enquanto o negócio
 * está aberto.
 *
 * O piloto simulado encontrou isto como o segundo buraco mais caro: a API já
 * aceitava `discount` e `saleValue` em `PATCH /deals/:id` e nenhuma tela
 * mandava. Quem abria o negócio pelo card do lead ficava preso ao preço de
 * tabela para sempre, e o funil por valor somava dinheiro que não era o da
 * venda.
 *
 * Três regras moram aqui porque a API as repete e recusaria depois:
 *
 *  - `venda = tabela − desconto`, conferido em centavos (o backend confere em
 *    `Decimal` e responde 400 com a conta feita);
 *  - a partir de `signed` o negócio não aceita alteração de valores;
 *  - com contrato **emitido**, o preço congela até o contrato ser anulado —
 *    o PDF arquivado tem os valores impressos e o hash que responde "qual
 *    documento essa pessoa recebeu?".
 *
 * Quem edita é quem já vê custo e margem (`VE_CUSTO`) **mais o vendedor do
 * próprio negócio**: negociar desconto é o trabalho dele, e um desconto que só
 * o gerente digita não é negociação, é fila.
 */

import { useEffect, useState } from 'react';
import { Loader2, Pencil, Tag } from 'lucide-react';
import { emCentavos, formatarBRL, subtrair } from '@autoconnect/shared';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { useAtualizarValores, type DealResumo } from '../dados';

/** `"12345.67"` → `12.345,67`, para o campo aceitar o que a tela exibe. */
function paraCampo(valor: string): string {
  return formatarBRL(valor).replace(/[^\d,.-]/g, '').trim();
}

/**
 * Aceita "12.345,67", "12345,67" e "12345.67" e devolve o formato que a API
 * exige. `null` quando não dá para ler o número — a tela diz o que esperava em
 * vez de mandar lixo e receber "Validation failed".
 */
function paraApi(texto: string): string | null {
  const limpo = texto.trim().replace(/\s/g, '');
  if (!limpo) return null;

  // Vírgula presente = separador decimal brasileiro; o ponto é de milhar.
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;

  if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) return null;
  return normalizado;
}

export default function Preco({
  negocio, editavel, temContratoVivo, podeEditar,
}: {
  negocio: DealResumo;
  /** Fora dos status que aceitam alteração de valores. */
  editavel: boolean;
  /** Há contrato emitido ou assinado: o preço está congelado até anulá-lo. */
  temContratoVivo: boolean;
  podeEditar: boolean;
}) {
  const salvar = useAtualizarValores(negocio.id);
  const [aberto, setAberto] = useState(false);
  const [tabela, setTabela] = useState(() => paraCampo(negocio.listPrice));
  const [desconto, setDesconto] = useState(() => paraCampo(negocio.discount));
  const [erro, setErro] = useState<string | null>(null);

  // Reabrir o formulário depois de salvar tem que partir dos valores gravados,
  // não dos que estavam no campo.
  useEffect(() => {
    if (aberto) return;
    setTabela(paraCampo(negocio.listPrice));
    setDesconto(paraCampo(negocio.discount));
  }, [aberto, negocio.listPrice, negocio.discount]);

  const tabelaApi = paraApi(tabela);
  const descontoApi = paraApi(desconto);
  const vendaPrevista =
    tabelaApi && descontoApi && emCentavos(descontoApi) <= emCentavos(tabelaApi)
      ? subtrair(tabelaApi, descontoApi)
      : null;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!tabelaApi || !descontoApi) {
      setErro('Use um valor como 84.900,00 — só números, vírgula para os centavos.');
      return;
    }
    if (!vendaPrevista) {
      setErro('O desconto não pode ser maior que o preço de tabela.');
      return;
    }

    try {
      // Os três vão juntos: o backend confere `venda = tabela − desconto` e
      // recusa o conjunto inconsistente. Mandar um campo por vez produziria um
      // estado intermediário que a conferência recusaria.
      await salvar.mutateAsync({
        listPrice: tabelaApi,
        discount: descontoApi,
        saleValue: vendaPrevista,
      });
      setAberto(false);
    } catch (err) {
      setErro(textoDoErro(err));
    }
  }

  const campo =
    'w-full text-sm bg-transparent border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <Tag size={12} /> Preço
        </p>
        {editavel && podeEditar && !temContratoVivo && !aberto && (
          <button
            onClick={() => setAberto(true)}
            className="text-xs font-semibold text-brand-accent hover:underline inline-flex items-center gap-1"
          >
            <Pencil size={11} /> Negociar
          </button>
        )}
      </div>

      {!aberto ? (
        <>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Tabela</dt>
              <dd>{formatarBRL(negocio.listPrice)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Desconto</dt>
              <dd className={Number(negocio.discount) > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>
                −{formatarBRL(negocio.discount)}
              </dd>
            </div>
            <div className="flex justify-between font-bold border-t border-slate-200 dark:border-slate-800 pt-1.5">
              <dt>Valor de venda</dt>
              <dd>{formatarBRL(negocio.saleValue)}</dd>
            </div>
          </dl>

          {temContratoVivo && (
            <p className="text-[11px] text-slate-400 mt-2">
              Há contrato emitido com estes valores. Para renegociar, anule o
              contrato abaixo e emita um novo.
            </p>
          )}
          {!editavel && !temContratoVivo && (
            <p className="text-[11px] text-slate-400 mt-2">
              Negócio fechado — os valores não mudam mais.
            </p>
          )}
          {editavel && !podeEditar && (
            <p className="text-[11px] text-slate-400 mt-2">
              Só o vendedor deste negócio e a gerência alteram o preço.
            </p>
          )}
        </>
      ) : (
        <form onSubmit={enviar} className="space-y-2.5">
          <div>
            <label htmlFor="preco-tabela" className="text-[11px] font-semibold text-slate-500 block mb-1">
              Preço de tabela
            </label>
            <input
              id="preco-tabela" value={tabela} onChange={(e) => setTabela(e.target.value)}
              inputMode="decimal" placeholder="84.900,00" className={campo}
            />
          </div>
          <div>
            <label htmlFor="preco-desconto" className="text-[11px] font-semibold text-slate-500 block mb-1">
              Desconto
            </label>
            <input
              id="preco-desconto" value={desconto} onChange={(e) => setDesconto(e.target.value)}
              inputMode="decimal" placeholder="0,00" className={campo}
            />
          </div>

          <div className="flex justify-between text-sm font-bold border-t border-slate-200 dark:border-slate-800 pt-2">
            <span>Valor de venda</span>
            <span>{vendaPrevista ? formatarBRL(vendaPrevista) : '—'}</span>
          </div>

          {erro && <p className="text-sm text-rose-600 dark:text-rose-400">{erro}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setAberto(false); setErro(null); }}
              className="flex-1 text-sm py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvar.isPending}
              className="flex-1 text-sm py-2 rounded-lg bg-brand-accent text-white font-medium hover:bg-blue-600 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              {salvar.isPending && <Loader2 size={14} className="animate-spin" />}
              Salvar
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            A composição do pagamento precisa fechar com o novo valor antes da
            assinatura.
          </p>
        </form>
      )}
    </div>
  );
}
