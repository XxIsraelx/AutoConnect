import { SECOES } from './config';

/** Barras do gráfico de exemplo na maquete do painel (valores relativos). */
const BARRAS = [4, 7, 5, 9, 6, 11, 8, 13, 10, 15, 12, 14];
const BARRA_MAIOR = Math.max(...BARRAS);

/**
 * Maquete do painel. Fica até a vitrine de uma loja de demonstração poder
 * entrar no lugar — isso depende de decidir o que fazer com a "Aurora
 * Seminovos" de produção (plano, fase 3).
 */
export default function Maquete() {
  return (
    <section data-secao={SECOES.produto} className="mx-auto max-w-5xl px-4 sm:px-6 mb-16 sm:mb-24">
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
  );
}
