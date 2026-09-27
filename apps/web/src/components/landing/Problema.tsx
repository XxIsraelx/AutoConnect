import { SECOES } from './config';

/**
 * O estudo diz **qualificar**, não fechar — e "quase 7 vezes", não 7. Citar a
 * mais do que a fonte diz é o tipo de coisa que o dono de loja desconfiado
 * confere, e aí a página inteira perde o crédito.
 */
export default function Problema() {
  return (
    <section
      data-secao={SECOES.problema}
      className="border-y border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 mb-16 sm:mb-24"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-14 text-center">
        <p className="text-5xl sm:text-6xl font-extrabold tracking-tight text-brand-accent mb-4">42 horas</p>
        <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300">
          Num estudo da Harvard Business Review com 2.241 empresas dos EUA (2011), a resposta a um lead
          online levou em média 42 horas. Quem respondeu em até 1 hora teve quase 7 vezes mais chance de
          qualificar o lead.
        </p>
      </div>
    </section>
  );
}
