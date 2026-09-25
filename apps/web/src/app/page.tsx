import Logo from '@/components/Logo';
import Link from 'next/link';
import LandingNav from '@/components/LandingNav';
import {
  Car,
  MessageSquare,
  CalendarDays,
  BarChart3,
  Users,
  Zap,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { DURACAO_DO_TRIAL_DIAS } from '@autoconnect/shared';

/** Barras do gráfico de exemplo na maquete do painel (valores relativos). */
const BARRAS = [4, 7, 5, 9, 6, 11, 8, 13, 10, 15, 12, 14];
const BARRA_MAIOR = Math.max(...BARRAS);

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <LandingNav />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 bg-blue-50 dark:bg-blue-950/40 text-brand-accent text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
          <Zap size={12} />
          Plataforma completa para concessionárias
        </div>
        {/* "concessionária" mede 330px em text-5xl e não cabe nos 327px úteis
            de uma tela de 375px — a última letra ficava cortada. Só volta aos
            48px quando existe largura de sobra. */}
        <h1 className="text-4xl min-[380px]:text-5xl sm:text-6xl font-extrabold tracking-tight leading-tight mb-6">
          Gerencie sua concessionária{' '}
          <span className="text-brand-accent">do jeito certo</span>
        </h1>
        <p className="text-lg text-slate-500 dark:text-slate-400 max-w-2xl mx-auto mb-10">
          Estoque de veículos, leads, chat em tempo real e agendamentos — tudo em um só lugar.
          Feito para concessionárias que querem crescer sem complicação.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/comecar"
            className="flex items-center gap-2 bg-brand-accent text-white font-semibold px-7 py-3.5 rounded-xl hover:bg-blue-600 transition text-sm shadow-lg shadow-blue-200 dark:shadow-none"
          >
            Criar conta grátis
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/buscar"
            className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 px-6 py-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            <Car size={16} />
            Buscar veículos
          </Link>
        </div>

        {/* Social proof */}
        <p className="mt-8 text-xs text-slate-400">
          Sem cartão de crédito · {DURACAO_DO_TRIAL_DIAS} dias grátis · Cancele quando quiser
        </p>
      </section>

      {/* Dashboard preview (placeholder visual) */}
      <section className="mx-auto max-w-5xl px-4 sm:px-6 mb-24">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 overflow-hidden shadow-2xl shadow-slate-200 dark:shadow-none">
          {/* Fake browser bar */}
          <div className="px-3 sm:px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-400 shrink-0" />
            <div className="w-3 h-3 rounded-full bg-yellow-400 shrink-0" />
            <div className="w-3 h-3 rounded-full bg-green-400 shrink-0" />
            <div className="ml-2 sm:ml-3 flex-1 min-w-0 bg-slate-100 dark:bg-slate-700 rounded-md h-6 max-w-xs text-xs text-slate-400 flex items-center px-3 truncate">
              autoconnect.app/dashboard
            </div>
          </div>
          {/* Fake dashboard */}
          <div className="flex h-56 sm:h-64">
            {/* Some 320px a barra lateral não deixa largura utilizável para os
                cards; a maquete vira só o conteúdo, que é o que importa. */}
            <div className="hidden sm:block w-36 md:w-44 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 p-4 space-y-2">
              {['Dashboard', 'Veículos', 'Leads', 'Chat', 'Agendamentos'].map((item, i) => (
                <div key={item} className={`h-8 rounded-lg text-xs flex items-center px-3 ${i === 0 ? 'bg-brand-accent text-white' : 'text-slate-400'}`}>
                  {item}
                </div>
              ))}
            </div>
            <div className="flex-1 min-w-0 p-3 sm:p-5 space-y-3 sm:space-y-4">
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {[
                  { label: 'Veículos ativos', value: '24' },
                  { label: 'Leads este mês', value: '138' },
                  { label: 'Agendamentos', value: '7' },
                ].map((stat) => (
                  <div key={stat.label} className="min-w-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-2.5 sm:p-3">
                    <p className="text-[10px] sm:text-xs leading-tight text-slate-400">{stat.label}</p>
                    <p className="text-lg sm:text-2xl font-bold mt-1">{stat.value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-3 h-24">
                {/* Altura em % do card, não em px: com `h * 5px` a barra mais
                    alta media 75px num card de 72px úteis e vazava por cima
                    dos cards de KPI. */}
                <div className="flex items-end justify-center gap-1 h-full">
                  {BARRAS.map((h, i) => (
                    <div
                      key={i}
                      className="w-2.5 sm:w-4 rounded-sm bg-brand-accent/20 dark:bg-brand-accent/30"
                      style={{ height: `${(h / BARRA_MAIOR) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Funcionalidades */}
      <section id="funcionalidades" className="mx-auto max-w-6xl px-6 mb-24">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight mb-3">
            Tudo que sua concessionária precisa
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            Uma plataforma integrada que centraliza operações, melhora o atendimento e aumenta as vendas.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            {
              icon: Car,
              title: 'Gestão de estoque',
              desc: 'Cadastre veículos com fotos, ficha técnica completa e histórico. Controle disponibilidade em tempo real.',
            },
            {
              icon: Users,
              title: 'CRM de leads',
              desc: 'Capture e qualifique leads automaticamente. Acompanhe o funil de vendas e nunca perca um cliente.',
            },
            {
              icon: MessageSquare,
              title: 'Chat em tempo real',
              desc: 'Converse com clientes direto pelo painel, sem trocar de aba e com o histórico preso ao lead.',
            },
            {
              icon: CalendarDays,
              title: 'Agendamentos',
              desc: 'Gerencie test-drives e visitas com calendário integrado, dentro do horário real da loja. Confirmações por e-mail.',
            },
            {
              icon: BarChart3,
              title: 'Relatórios e métricas',
              desc: 'Dashboards com visibilidade total de vendas, desempenho por vendedor e retorno sobre investimento.',
            },
            {
              icon: Zap,
              title: 'Multi-filiais',
              desc: 'Gerencie várias lojas em uma única conta. Controle de acesso por filial para cada vendedor.',
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 hover:border-brand-accent/50 transition"
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

      {/* Como funciona */}
      <section className="bg-slate-50 dark:bg-slate-900 py-20 mb-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight mb-3">Como funciona</h2>
            <p className="text-slate-500 dark:text-slate-400">
              Em 3 passos você já está operando com a plataforma
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Crie sua conta', desc: 'Cadastre sua concessionária em menos de 2 minutos. Nenhum cartão de crédito necessário.' },
              { step: '02', title: 'Adicione seu estoque', desc: 'Importe ou cadastre seus veículos com fotos e ficha técnica completa.' },
              { step: '03', title: 'Atenda e venda mais', desc: 'Receba leads, converse com clientes e feche negócios pela plataforma.' },
            ].map(({ step, title, desc }) => (
              <div key={step} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-brand-accent text-white text-xl font-bold flex items-center justify-center mx-auto mb-5">
                  {step}
                </div>
                <h3 className="font-semibold text-lg mb-2">{title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Planos */}
      <section id="planos" className="mx-auto max-w-6xl px-6 mb-24">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight mb-3">Planos simples e transparentes</h2>
          <p className="text-slate-500 dark:text-slate-400">Comece grátis, escale conforme crescer</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
          {[
            {
              name: 'Trial',
              price: 'Grátis',
              period: `${DURACAO_DO_TRIAL_DIAS} dias`,
              desc: 'Ideal para conhecer a plataforma',
              features: ['Até 10 veículos', '1 usuário', 'Chat básico', 'Suporte por e-mail'],
              cta: 'Criar conta grátis',
              href: '/signup',
              highlight: false,
            },
            {
              name: 'Pro',
              price: 'R$ 297',
              period: '/mês',
              desc: 'Para concessionárias em crescimento',
              features: ['Veículos ilimitados', 'Até 5 usuários', 'Chat no painel', 'Relatórios avançados', 'Suporte prioritário'],
              // Não existe cobrança ainda (Onda 3): "Assinar Pro" levava a
              // pessoa para um trial sem forma nenhuma de pagar. O caminho
              // honesto é o mesmo teste, com o plano trocado depois.
              cta: `Testar ${DURACAO_DO_TRIAL_DIAS} dias grátis`,
              href: '/signup',
              highlight: true,
            },
            {
              name: 'Enterprise',
              price: 'Sob consulta',
              period: '',
              desc: 'Para redes e grupos automotivos',
              features: ['Multi-filiais', 'Usuários ilimitados', 'API dedicada', 'Onboarding guiado', 'SLA garantido'],
              // Enterprise é conversa, não autosserviço — mandar para /signup
              // era prometer uma coisa e entregar outra.
              cta: 'Falar com a gente',
              href: 'mailto:contato@autoconnect.app?subject=AutoConnect%20Enterprise',
              highlight: false,
            },
          ].map(({ name, price, period, desc, features, cta, href, highlight }) => (
            <div
              key={name}
              className={`rounded-2xl border p-6 flex flex-col ${
                highlight
                  ? 'border-brand-accent bg-brand-accent text-white shadow-xl shadow-blue-200 dark:shadow-none'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
              }`}
            >
              <div className="mb-5">
                <p className={`text-sm font-semibold mb-1 ${highlight ? 'text-blue-100' : 'text-slate-500'}`}>{name}</p>
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-bold">{price}</span>
                  {period && <span className={`text-sm mb-1 ${highlight ? 'text-blue-100' : 'text-slate-400'}`}>{period}</span>}
                </div>
                <p className={`text-sm mt-1 ${highlight ? 'text-blue-100' : 'text-slate-500'}`}>{desc}</p>
              </div>
              <ul className="space-y-2.5 mb-6 flex-1">
                {features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 size={15} className={highlight ? 'text-blue-200' : 'text-brand-accent'} />
                    <span className={highlight ? 'text-blue-50' : 'text-slate-600 dark:text-slate-400'}>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={href}
                className={`text-center text-sm font-semibold py-2.5 rounded-xl transition ${
                  highlight
                    ? 'bg-white text-brand-accent hover:bg-blue-50'
                    : 'bg-brand-accent text-white hover:bg-blue-600'
                }`}
              >
                {cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="mx-auto max-w-4xl px-6 mb-24 text-center">
        <div className="bg-brand-accent rounded-3xl px-8 py-14">
          <h2 className="text-3xl font-bold text-white mb-3">
            Pronto para transformar sua concessionária?
          </h2>
          <p className="text-blue-100 mb-8 max-w-lg mx-auto">
            Crie a conta da sua loja agora e teste {DURACAO_DO_TRIAL_DIAS} dias sem cartão de crédito.
            Em menos de um minuto você está no painel.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/comecar"
              className="flex items-center gap-2 bg-white text-brand-accent font-semibold px-7 py-3.5 rounded-xl hover:bg-blue-50 transition text-sm"
            >
              Criar conta grátis
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/entrar"
              className="text-sm text-blue-100 hover:text-white font-medium px-6 py-3.5"
            >
              Já tenho conta →
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo />
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
            <Link href="/login" className="hover:text-slate-600">Painel da concessionária</Link>
            <Link href="/entrar" className="hover:text-slate-600">Área do cliente</Link>
            <Link href="/buscar" className="hover:text-slate-600">Buscar veículos</Link>
            <Link href="/termos" className="hover:text-slate-600">Termos</Link>
            <Link href="/privacidade" className="hover:text-slate-600">Privacidade</Link>
          </div>
          <p className="text-xs text-slate-400">© 2026 AutoConnect. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
