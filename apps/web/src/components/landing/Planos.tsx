import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { DURACAO_DO_TRIAL_DIAS, FAIXAS } from '@autoconnect/shared';
import { SECOES, waLink } from './config';

/**
 * Faixas lidas do `CATALOGO_DE_PLANOS` — nada digitado aqui. Os **valores**
 * ficam de fora até a decisão de preço (pendência de 27/09/2026): a cobrança,
 * o programa de fundadores e a home antiga davam três tabelas diferentes, e
 * uma loja que lê um preço aqui e recebe outro na fatura é pior que uma loja
 * que pergunta. Quando o preço fechar, o valor sai do mesmo catálogo.
 */
export default function Planos() {
  return (
    <section
      id="planos"
      data-secao={SECOES.planos}
      className="scroll-mt-16 mx-auto max-w-5xl px-4 sm:px-6 mb-16 sm:mb-24"
    >
      <div className="text-center mb-12">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">Planos</h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
          Um preço por loja, pelo tamanho do estoque. Usuários ilimitados em todos os planos, porque
          vendedor novo não pode ser custo a mais.
        </p>
      </div>
      <div className="grid sm:grid-cols-3 gap-5">
        {FAIXAS.map((f) => (
          <div
            key={f.plano}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6"
          >
            <p className="font-semibold mb-1">{f.nome}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{f.resumo}</p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <CheckCircle2 size={15} className="text-brand-accent shrink-0" />
                {f.limiteVeiculos === null ? 'Veículos ilimitados' : `Até ${f.limiteVeiculos} veículos`}
              </li>
              <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <CheckCircle2 size={15} className="text-brand-accent shrink-0" />
                Usuários ilimitados
              </li>
            </ul>
          </div>
        ))}
      </div>
      <div className="text-center mt-8 space-y-3">
        <Link
          href="/comecar"
          className="inline-flex items-center gap-2 bg-brand-accent text-white font-semibold px-7 py-3.5 rounded-xl hover:bg-blue-600 transition text-sm"
        >
          Criar conta grátis
        </Link>
        <p className="text-xs text-slate-400">
          {DURACAO_DO_TRIAL_DIAS} dias grátis, sem cartão.{' '}
          <a
            href={waLink('Oi, Israel! Quero saber o preço do AutoConnect para a minha loja.')}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-slate-600"
          >
            Valores de lançamento pelo WhatsApp
          </a>
          .
        </p>
      </div>
    </section>
  );
}
