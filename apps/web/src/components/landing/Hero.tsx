import Link from 'next/link';
import { ArrowRight, ScanSearch } from 'lucide-react';
import { DURACAO_DO_TRIAL_DIAS } from '@autoconnect/shared';
import { SECOES, TITULO_DO_HERO, waLink } from './config';

/**
 * Duas portas: o Raio-X é a principal (o dono de loja que ainda não quer criar
 * conta) e o cadastro em autosserviço, a secundária. "Buscar veículos" saiu
 * daqui — é o caminho do comprador, e continua no rodapé.
 */
export default function Hero() {
  return (
    <section data-secao={SECOES.hero} className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-20 pb-16 sm:pb-24">
      <div className="grid lg:grid-cols-[1.15fr_1fr] gap-10 lg:gap-14 items-center">
        <div>
          <div className="inline-flex items-center gap-2 bg-blue-50 dark:bg-blue-950/40 text-brand-accent text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            <ScanSearch size={12} />
            Raio-X gratuito do atendimento
          </div>
          <h1 className="text-3xl min-[380px]:text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight mb-6">
            {TITULO_DO_HERO}
          </h1>
          <p className="text-base sm:text-lg text-slate-500 dark:text-slate-400 max-w-xl">
            Estoque, leads, chat e agendamento de test drive num painel só, feito para revendas e
            concessionárias. Peça o Raio-X gratuito: testamos o atendimento da sua loja como cliente
            oculto e mandamos o resultado em 24 h.
          </p>
        </div>

        <div
          id="raio-x"
          className="scroll-mt-24 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-xl shadow-slate-200/60 dark:shadow-none"
        >
          <p className="font-semibold mb-1">Raio-X gratuito do atendimento</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
            Um cliente oculto chama sua loja e você recebe o laudo em 24 h: quanto tempo levou a
            resposta, se houve retorno e onde a venda esfriou.
          </p>
          <a
            href={waLink('Oi, Israel! Quero o Raio-X gratuito do atendimento da minha loja.')}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 bg-brand-accent text-white font-semibold px-6 py-3.5 rounded-xl hover:bg-blue-600 transition text-sm"
          >
            Pedir o Raio-X gratuito
          </a>
          <div className="mt-4 text-center">
            <Link
              href="/comecar"
              className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition"
            >
              ou crie sua conta e teste {DURACAO_DO_TRIAL_DIAS} dias
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
