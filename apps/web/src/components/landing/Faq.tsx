import { ChevronDown } from 'lucide-react';
import { DURACAO_DO_TRIAL_DIAS } from '@autoconnect/shared';
import { SECOES, waLink } from './config';

/**
 * `<details>` em vez de acordeão com estado: abre sem JavaScript, o leitor de
 * tela entende sozinho e o Ctrl+F do navegador acha texto fechado.
 *
 * Cada resposta diz só o que o produto faz hoje — a do WhatsApp em especial:
 * não há integração, e prometer uma é o jeito mais rápido de perder a loja.
 */
const PERGUNTAS = [
  {
    p: 'Por que o Raio-X é de graça?',
    r: `Porque é o jeito mais honesto de mostrar o problema antes de oferecer qualquer coisa. Se o laudo mostrar que sua loja responde rápido, ótimo — fica o laudo. Se mostrar demora, a gente conversa sobre o que mudar. E quem quiser testar o sistema sozinho tem ${DURACAO_DO_TRIAL_DIAS} dias grátis, sem cartão.`,
  },
  {
    p: 'Já uso planilha ou outro sistema',
    r: 'Dá para começar em paralelo. O estoque sobe de uma planilha CSV, e os leads novos passam a entrar no painel com prazo e vendedor. O sistema antigo fica para consulta até você não precisar mais dele.',
  },
  {
    // Exportação que existe hoje: leads, estoque, negócios e desempenho em
    // CSV. Agendamentos e conversas ainda não (pendência de 27/09/2026) — a
    // resposta não pode dizer "todos os seus dados".
    p: 'E se o AutoConnect acabar?',
    r: 'Seus dados são seus: leads, estoque, negócios e o desempenho da equipe já saem em planilha pelo próprio painel. Agendamentos e conversas ainda não têm exportação.',
  },
  {
    p: 'Quanto tempo leva para implantar?',
    r: 'A conta fica pronta na hora. Com a planilha do estoque em mãos, o catálogo sobe no mesmo dia; depois é convidar a equipe e definir quem está de plantão.',
  },
  {
    p: 'Meu time vai saber usar?',
    r: 'Cada pessoa vê só o que o papel dela pede: o vendedor vê a carteira dele e o prazo de cada lead, a gerência vê a equipe inteira. Não há tela de gerente no caminho de quem só precisa atender.',
  },
  {
    p: 'Funciona com o WhatsApp da loja?',
    r: 'Ainda não integra. O que existe hoje: o clique do cliente no botão de WhatsApp da vitrine vira registro no lead, e o que chega direto pelo WhatsApp o vendedor cadastra no painel — dali em diante, com prazo e rodízio como qualquer outro lead.',
  },
];

export default function Faq() {
  return (
    <section data-secao={SECOES.faq} className="mx-auto max-w-3xl px-4 sm:px-6 mb-16 sm:mb-24">
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-8 text-center">Perguntas que os lojistas fazem</h2>
      <div className="divide-y divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
        {PERGUNTAS.map(({ p, r }) => (
          <details key={p} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
              {p}
              <ChevronDown size={18} className="shrink-0 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{r}</p>
          </details>
        ))}
      </div>
      <div className="text-center mt-8">
        <a
          href={waLink('Oi, Israel! Tenho uma dúvida sobre o AutoConnect.')}
          target="_blank"
          rel="noopener noreferrer"
          data-evento="whatsapp_click"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-accent px-6 py-3 rounded-xl border border-brand-accent/40 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition"
        >
          Tenho outra dúvida
        </a>
      </div>
    </section>
  );
}
