import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { DURACAO_DO_TRIAL_DIAS, FAIXAS, deCentavos, formatarBRL } from '@autoconnect/shared';
import { SECOES, waLink } from './config';

/**
 * Faixas e preços lidos do `CATALOGO_DE_PLANOS` — nada digitado aqui. É o
 * mesmo catálogo que a cobrança usa, então a loja lê aqui o valor que vai ver
 * na fatura. A tabela é a de lançamento (decisão de 27/09/2026,
 * `docs/decisoes/2026-09-27 plano de precos.md`).
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
          Um preço por loja, pelo tamanho do estoque. Todos os módulos e usuários ilimitados em todos
          os planos, porque vendedor novo não pode ser custo a mais.
        </p>
      </div>
      <div className="grid sm:grid-cols-3 gap-5">
        {FAIXAS.map((f) => (
          <div
            key={f.plano}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6"
          >
            <p className="font-semibold mb-1">{f.nome}</p>
            <p className="mb-2">
              <span className="text-3xl font-bold tracking-tight">
                {formatarBRL(deCentavos(f.precoMensalCentavos)).replace(',00', '')}
              </span>
              <span className="text-sm text-slate-400">/mês</span>
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{f.resumo}</p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <CheckCircle2 size={15} className="text-brand-accent shrink-0" />
                {f.limiteVeiculos === null ? 'Veículos ilimitados' : `Até ${f.limiteVeiculos} veículos`}
              </li>
              <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <CheckCircle2 size={15} className="text-brand-accent shrink-0" />
                {f.limiteFiliais === 1 ? '1 loja' : `Até ${f.limiteFiliais} filiais`}
              </li>
              <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <CheckCircle2 size={15} className="text-brand-accent shrink-0" />
                Usuários ilimitados
              </li>
              <li className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <CheckCircle2 size={15} className="text-brand-accent shrink-0" />
                Todos os módulos
              </li>
            </ul>
          </div>
        ))}
      </div>
      <div className="text-center mt-8 space-y-3">
        <Link
          href="/comecar"
          data-evento="conta_criar_click"
          className="inline-flex items-center gap-2 bg-brand-accent text-white font-semibold px-7 py-3.5 rounded-xl hover:bg-blue-600 transition text-sm"
        >
          Criar conta grátis
        </Link>
        <p className="text-xs text-slate-400 max-w-lg mx-auto">
          Preço de lançamento: quem assinar agora continua com ele quando a tabela subir, em
          qualquer plano. No anual, 12 meses pelo preço de 10.{' '}
          {DURACAO_DO_TRIAL_DIAS} dias grátis, sem cartão, sem taxa de implantação e sem fidelidade.{' '}
          <a
            href={waLink('Oi, Israel! Quero saber qual plano serve para a minha loja.')}
            target="_blank"
            rel="noopener noreferrer"
            data-evento="whatsapp_click"
            className="underline hover:text-slate-600"
          >
            Dúvida sobre o plano? Fale comigo
          </a>
          .
        </p>
      </div>
    </section>
  );
}
