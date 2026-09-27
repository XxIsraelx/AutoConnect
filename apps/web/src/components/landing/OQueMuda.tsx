import {
  AlarmClock, Repeat, Car, UserCheck, MessageSquare, CalendarDays, Briefcase, FileText,
} from 'lucide-react';
import { SECOES } from './config';

/**
 * Só o que o produto faz hoje (lista "pode" do plano). Ficam de fora de
 * propósito: integração com WhatsApp, consulta veicular (sem fornecedor) e
 * assinatura eletrônica (em sandbox).
 *
 * Os dois destaques são a resposta direta ao Raio-X: o laudo mostra a demora,
 * e o prazo com alerta e o rodízio são o que acaba com ela.
 */
const DESTAQUES = [
  {
    icon: AlarmClock,
    title: 'Prazo de primeiro contato, com alerta',
    desc: 'Cada lead nasce com prazo para a primeira resposta. Quando ele está para vencer, o painel avisa — antes de o cliente esfriar.',
  },
  {
    icon: Repeat,
    title: 'Rodízio entre quem está de plantão',
    desc: 'O lead novo vai para o próximo vendedor da vez, só entre quem está trabalhando. Ninguém escolhe o cliente bom, ninguém fica sem.',
  },
];

const ITENS = [
  {
    icon: Car,
    title: 'Estoque e vitrine pública',
    desc: 'Carros com fotos e ficha técnica, importados de planilha CSV. Cada loja ganha sua página com o estoque publicado.',
  },
  {
    icon: UserCheck,
    title: 'Lead sem cadastro',
    desc: 'O cliente pede contato na vitrine sem criar conta, com o consentimento LGPD guardado junto.',
  },
  {
    icon: MessageSquare,
    title: 'Chat em tempo real',
    desc: 'Inclusive com o visitante que ainda não tem conta. A conversa fica presa ao lead.',
  },
  {
    icon: CalendarDays,
    title: 'Agenda de test drive',
    desc: 'Agendamento com e sem conta do cliente, dentro do horário da loja.',
  },
  {
    icon: Briefcase,
    title: 'Carteira e relatórios por vendedor',
    desc: 'Cada vendedor com a sua carteira; a gerência vê o desempenho de cada um.',
  },
  {
    icon: FileText,
    title: 'Negócio com margem e contrato',
    desc: 'Valor de venda, custos e margem de cada negócio, e o contrato em PDF.',
  },
];

export default function OQueMuda() {
  return (
    <section data-secao={SECOES.oQueMuda} className="mx-auto max-w-6xl px-4 sm:px-6 mb-16 sm:mb-24">
      <div className="text-center mb-12">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">O que muda na loja</h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
          Nenhum lead parado esperando alguém lembrar dele.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-5">
        {DESTAQUES.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="rounded-2xl border border-brand-accent/40 bg-blue-50/60 dark:bg-blue-950/20 p-6">
            <div className="w-11 h-11 rounded-xl bg-brand-accent text-white flex items-center justify-center mb-4">
              <Icon size={22} />
            </div>
            <h3 className="font-semibold text-lg mb-2">{title}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {ITENS.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center mb-4">
              <Icon size={20} className="text-brand-accent" />
            </div>
            <h3 className="font-semibold mb-2">{title}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
