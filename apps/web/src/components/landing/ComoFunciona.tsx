import { DURACAO_DO_TRIAL_DIAS } from '@autoconnect/shared';
import { SECOES } from './config';

const CAMINHOS = [
  {
    titulo: 'Pedindo o Raio-X',
    passos: [
      'Você pede o Raio-X gratuito.',
      'Um cliente oculto chama sua loja, e o laudo chega no seu WhatsApp em 24 h.',
      'A gente conversa sobre o que mudar — com ou sem o AutoConnect.',
    ],
  },
  {
    titulo: 'Criando a conta',
    passos: [
      `Você cadastra a loja e testa ${DURACAO_DO_TRIAL_DIAS} dias, sem cartão.`,
      'Importa o estoque de uma planilha CSV.',
      'Atende os leads que chegam pela vitrine, com prazo e rodízio.',
    ],
  },
];

export default function ComoFunciona() {
  return (
    <section
      id="como-funciona"
      data-secao={SECOES.comoFunciona}
      className="scroll-mt-16 bg-slate-50 dark:bg-slate-900 py-16 sm:py-20 mb-16 sm:mb-24"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">Como funciona</h2>
          <p className="text-slate-500 dark:text-slate-400">Dois caminhos, você escolhe por onde começar.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          {CAMINHOS.map(({ titulo, passos }) => (
            <div
              key={titulo}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-6"
            >
              <h3 className="font-semibold text-lg mb-5">{titulo}</h3>
              <ol className="space-y-4">
                {passos.map((passo, i) => (
                  <li key={passo} className="flex gap-3">
                    <span className="w-7 h-7 shrink-0 rounded-lg bg-brand-accent text-white text-sm font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed pt-1">{passo}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
