import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import {
  DURACAO_DO_TRIAL_DIAS, FAIXAS, deCentavos, formatarBRL, limiteDeFiliais, limiteDeVeiculos,
} from '@autoconnect/shared';
import { SECOES, waLink } from './config';

/**
 * Faixas e preços lidos do `CATALOGO_DE_PLANOS` — nada digitado aqui. É o
 * mesmo catálogo que a cobrança usa, então a loja lê aqui o valor que vai ver
 * na fatura. A tabela é a de lançamento (decisão de 27/09/2026,
 * `docs/decisoes/2026-09-27 plano de precos.md`).
 *
 * O teste grátis vem primeiro, com os tetos que o trial aplica de verdade
 * (`limiteDeVeiculos('trial')`, `limiteDeFiliais('trial')`) — os da menor faixa.
 */
const TRIAL_VEICULOS = limiteDeVeiculos('trial');
const TRIAL_FILIAIS = limiteDeFiliais('trial');

function Itens({ veiculos, filiais }: { veiculos: number | null; filiais: number | null }) {
  const itens = [
    veiculos === null ? 'Veículos ilimitados' : `Até ${veiculos} veículos`,
    filiais === 1 ? '1 loja' : `Até ${filiais} filiais`,
    'Usuários ilimitados',
    'Todos os módulos',
  ];
  return (
    <ul className="space-y-2 text-sm">
      {itens.map((t) => (
        <li key={t} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <CheckCircle2 size={15} className="text-brand-accent shrink-0" />
          {t}
        </li>
      ))}
    </ul>
  );
}

export default function Planos() {
  return (
    <section
      id="planos"
      data-secao={SECOES.planos}
      className="scroll-mt-16 mx-auto max-w-6xl px-4 sm:px-6 mb-16 sm:mb-24"
    >
      <div className="text-center mb-12">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">Planos</h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
          Um preço por loja, pelo tamanho do estoque. Todos os módulos e usuários ilimitados em todos
          os planos, porque vendedor novo não pode ser custo a mais.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="rounded-2xl border-2 border-dashed border-brand-accent/50 bg-blue-50/40 dark:bg-blue-950/20 p-6 flex flex-col">
          <p className="font-semibold mb-1">Teste grátis</p>
          <p className="mb-2">
            <span className="text-3xl font-bold tracking-tight">R$ 0</span>
            <span className="text-sm text-slate-400"> por {DURACAO_DO_TRIAL_DIAS} dias</span>
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            O sistema inteiro, sem cartão. No fim, você escolhe o plano do tamanho da sua loja.
          </p>
          <Itens veiculos={TRIAL_VEICULOS} filiais={TRIAL_FILIAIS} />
          <Link
            href="/comecar"
            data-evento="conta_criar_click"
            className="mt-5 text-center text-sm font-semibold text-brand-accent px-4 py-2.5 rounded-xl border border-brand-accent/40 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition"
          >
            Começar o teste
          </Link>
        </div>
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
            <Itens veiculos={f.limiteVeiculos} filiais={f.limiteFiliais} />
          </div>
        ))}
      </div>
      <div className="text-center mt-8">
        <p className="text-xs text-slate-400 max-w-lg mx-auto">
          Preço de lançamento: quem assinar agora continua com ele quando a tabela subir, em
          qualquer plano. No anual, 12 meses pelo preço de 10. Sem taxa de implantação e sem
          fidelidade.{' '}
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
