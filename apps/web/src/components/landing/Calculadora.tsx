'use client';

import { useState } from 'react';
import {
  EXEMPLO_DA_CALCULADORA,
  deCentavos,
  formatarBRL,
  valorEmRiscoEmCentavos,
  type EntradaDaCalculadora,
} from '@autoconnect/shared';
import { SECOES } from './config';

type Chave = keyof EntradaDaCalculadora;

const CAMPOS: { chave: Chave; rotulo: string; prefixo?: string; sufixo?: string }[] = [
  { chave: 'leadsPorMes', rotulo: 'Leads por mês' },
  { chave: 'percentualRespondidoTarde', rotulo: 'Respondidos depois de 1 h', sufixo: '%' },
  { chave: 'taxaDeFechamento', rotulo: 'Taxa de fechamento', sufixo: '%' },
  { chave: 'lucroPorCarro', rotulo: 'Lucro médio por carro', prefixo: 'R$' },
];

/**
 * Quanto a loja arrisca por mês com lead respondido tarde. A conta é
 * `valorEmRiscoEmCentavos` (shared, com teste); aqui só entrada e texto.
 * Nada é enviado nem pedido — nem e-mail.
 */
export default function Calculadora() {
  // Texto, não número: o campo pode ficar vazio enquanto a pessoa digita.
  const [valores, setValores] = useState<Record<Chave, string>>(() => ({
    leadsPorMes: String(EXEMPLO_DA_CALCULADORA.leadsPorMes),
    percentualRespondidoTarde: String(EXEMPLO_DA_CALCULADORA.percentualRespondidoTarde),
    taxaDeFechamento: String(EXEMPLO_DA_CALCULADORA.taxaDeFechamento),
    lucroPorCarro: String(EXEMPLO_DA_CALCULADORA.lucroPorCarro),
  }));

  const entrada = Object.fromEntries(
    CAMPOS.map(({ chave }) => [chave, Number(valores[chave]) || 0]),
  ) as unknown as EntradaDaCalculadora;
  const emRisco = formatarBRL(deCentavos(valorEmRiscoEmCentavos(entrada)));
  const ehExemplo = CAMPOS.every(({ chave }) => entrada[chave] === EXEMPLO_DA_CALCULADORA[chave]);

  return (
    <section data-secao={SECOES.calculadora} className="mx-auto max-w-4xl px-4 sm:px-6 mb-16 sm:mb-24">
      <div className="text-center mb-10">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">Quanto a demora custa para a sua loja?</h2>
        <p className="text-slate-500 dark:text-slate-400">
          Os valores abaixo são um exemplo. Troque pelos da sua loja — nada é enviado.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {CAMPOS.map(({ chave, rotulo, prefixo, sufixo }) => (
            <label key={chave} className="block">
              <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 min-h-[2rem]">
                {rotulo}
              </span>
              <span className="flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
                {prefixo && <span className="text-sm text-slate-400 mr-1">{prefixo}</span>}
                <input
                  inputMode="numeric"
                  value={valores[chave]}
                  onChange={(e) => setValores((v) => ({ ...v, [chave]: e.target.value.replace(/\D/g, '').slice(0, 9) }))}
                  className="w-full min-w-0 bg-transparent py-2.5 text-sm outline-none"
                />
                {sufixo && <span className="text-sm text-slate-400 ml-1">{sufixo}</span>}
              </span>
            </label>
          ))}
        </div>

        <div className="text-center" aria-live="polite">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
            {ehExemplo ? 'No exemplo, ficam em risco por mês até' : 'Sua loja arrisca por mês até'}
          </p>
          <p className="text-4xl sm:text-5xl font-extrabold tracking-tight text-brand-accent mb-6">{emRisco}</p>
          <a
            href="#raio-x"
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand-accent px-6 py-3 rounded-xl border border-brand-accent/40 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition"
          >
            Descobrir meu tempo real de resposta
          </a>
          <p className="mt-6 text-xs text-slate-400 max-w-xl mx-auto">
            Leads respondidos depois de 1 h × taxa de fechamento × lucro por carro. É um teto: supõe
            que esses leads fechariam na taxa normal se respondidos a tempo.
          </p>
        </div>
      </div>
    </section>
  );
}
