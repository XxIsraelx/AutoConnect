'use client';

import { useEffect, useState, useCallback } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

export type Tema = 'light' | 'dark' | 'system';

const CHAVE = 'autoconnect-tema';

/** Mantém seletores montados em paralelo mostrando a mesma opção. */
const EVENTO = 'autoconnect:tema';

/** Resolve 'system' para o que o sistema operacional está usando agora. */
function resolver(tema: Tema): 'light' | 'dark' {
  if (tema !== 'system') return tema;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Aplica no <html>, que é onde o Tailwind (darkMode: 'class') procura. */
export function aplicarTema(tema: Tema) {
  const efetivo = resolver(tema);
  document.documentElement.classList.toggle('dark', efetivo === 'dark');
  document.documentElement.style.colorScheme = efetivo;
}

/** Escuro por padrão — precisa casar com o script inline do layout raiz. */
const PADRAO: Tema = 'dark';

export function useTema() {
  const [tema, setTema] = useState<Tema>(PADRAO);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    const salvo = (localStorage.getItem(CHAVE) as Tema | null) ?? PADRAO;
    setTema(salvo);
    aplicarTema(salvo);
    setPronto(true);
  }, []);

  // Em 'system', acompanha a troca no SO sem precisar recarregar.
  useEffect(() => {
    if (tema !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => aplicarTema('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [tema]);

  // Pode haver mais de um seletor montado (o nav da landing tem um para
  // desktop e outro dentro do menu do celular). Sem isto, trocar em um deles
  // deixaria o outro marcando a opção antiga.
  useEffect(() => {
    const onTroca = (e: Event) => setTema((e as CustomEvent<Tema>).detail);
    window.addEventListener(EVENTO, onTroca);
    return () => window.removeEventListener(EVENTO, onTroca);
  }, []);

  const trocar = useCallback((novo: Tema) => {
    setTema(novo);
    localStorage.setItem(CHAVE, novo);
    aplicarTema(novo);
    window.dispatchEvent(new CustomEvent<Tema>(EVENTO, { detail: novo }));
  }, []);

  return { tema, trocar, pronto };
}

/**
 * Tema já resolvido ('system' virou claro ou escuro), para quem precisa
 * decidir em JS e não com classes — o mapa troca a URL dos tiles, por exemplo.
 *
 * Observa a classe no <html> em vez do localStorage porque assim cobre toda
 * origem de troca: o script inicial, o seletor e o sistema operacional.
 */
export function useTemaResolvido(): 'light' | 'dark' {
  // Começa em 'dark' para bater com o padrão do script inline e não piscar.
  const [efetivo, setEfetivo] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const ler = () =>
      setEfetivo(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    ler();
    const obs = new MutationObserver(ler);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  return efetivo;
}

const OPCOES: { valor: Tema; label: string; Icon: typeof Sun }[] = [
  { valor: 'light',  label: 'Claro',    Icon: Sun     },
  { valor: 'dark',   label: 'Escuro',   Icon: Moon    },
  { valor: 'system', label: 'Sistema',  Icon: Monitor },
];

export default function ThemeToggle({
  compacto = false,
  preencher = false,
}: {
  /** Só ícones, sem rótulo — para cabeçalhos e espaços estreitos. */
  compacto?: boolean;
  /** Ocupa toda a largura disponível (usado na barra lateral). */
  preencher?: boolean;
}) {
  const { tema, trocar, pronto } = useTema();

  // Antes de ler o localStorage não sabemos o tema; renderizar um estado
  // "selecionado" errado causaria um piscar na troca.
  if (!pronto) return <div className="h-8" aria-hidden />;

  return (
    <div
      role="group"
      aria-label="Tema da interface"
      className="flex items-center gap-0.5 p-0.5 rounded-lg
                 bg-slate-100 dark:bg-slate-800"
    >
      {OPCOES.map(({ valor, label, Icon }) => {
        const ativo = tema === valor;
        return (
          <button
            key={valor}
            onClick={() => trocar(valor)}
            aria-pressed={ativo}
            title={label}
            className={[
              'flex items-center justify-center gap-1.5 rounded-md transition',
              preencher ? 'flex-1 py-1.5' : 'px-2.5 py-1.5',
              ativo
                ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
            ].join(' ')}
          >
            <Icon size={14} />
            {!compacto && <span className="text-xs font-medium">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
