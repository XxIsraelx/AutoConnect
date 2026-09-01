'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';

const SECOES = [
  { href: '#funcionalidades', label: 'Funcionalidades' },
  { href: '#planos', label: 'Planos' },
];

const LINK = 'text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition';

/**
 * Cabeçalho da landing.
 *
 * São cinco itens (duas seções, tema, entrar e o CTA) e eles simplesmente não
 * cabem lado a lado num celular: em 375px o conjunto pedia 421px, então o
 * "Começar grátis" vazava por cima do resto. Abaixo de `md` só ficam o CTA e o
 * botão de menu; o resto vai para o painel que abre embaixo.
 *
 * O corte é `md` (768px) e não `sm` (640px) de propósito — com as duas seções
 * visíveis o nav pede ~627px, que ainda estoura os 592px úteis de uma tela de
 * 640px.
 */
export default function LandingNav() {
  const [aberto, setAberto] = useState(false);
  const fechar = () => setAberto(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-100 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <Link href="/" className="text-lg font-bold tracking-tight shrink-0">
          AutoConnect
        </Link>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-6">
          {SECOES.map(({ href, label }) => (
            <Link key={href} href={href} className={LINK}>
              {label}
            </Link>
          ))}
          <ThemeToggle compacto />
          <Link
            href="/login"
            className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition"
          >
            Entrar
          </Link>
          <Link
            href="/comecar"
            className="text-sm bg-brand-accent text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-600 transition"
          >
            Começar grátis
          </Link>
        </div>

        {/* Celular — o CTA continua à vista porque é o objetivo da página. */}
        <div className="flex md:hidden items-center gap-2">
          <Link
            href="/comecar"
            className="text-sm bg-brand-accent text-white px-3 py-2 rounded-lg font-medium
                       whitespace-nowrap hover:bg-blue-600 transition"
          >
            Começar
          </Link>
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
            className="p-2 -mr-2 rounded-lg text-slate-600 dark:text-slate-300
                       hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            {aberto ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {aberto && (
        <div
          className="md:hidden border-t border-slate-100 dark:border-slate-800
                     bg-white dark:bg-slate-950 px-4 py-3"
        >
          {SECOES.map(({ href, label }) => (
            <Link key={href} href={href} onClick={fechar} className={`block py-2.5 ${LINK}`}>
              {label}
            </Link>
          ))}
          <Link
            href="/login"
            onClick={fechar}
            className="block py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            Entrar
          </Link>
          <div className="pt-3 mt-2 border-t border-slate-100 dark:border-slate-800">
            <ThemeToggle preencher />
          </div>
        </div>
      )}
    </nav>
  );
}
