'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SECOES, waLink } from './config';

/**
 * O sistema de verdade, no lugar da maquete. São telas do painel capturadas
 * do produto rodando com os dados fictícios do seed (loja "Auto Sul"), não
 * desenhos: se uma tela mudar, a captura se refaz — o roteiro está no plano
 * da landing.
 *
 * E a vitrine ao vivo é a da loja de demonstração (`/c/demo`, a "Aurora
 * Seminovos"), que fica fora da busca e do mapa e avisa que é demonstração.
 */
const TELAS = [
  {
    chave: 'leads',
    rotulo: 'Leads',
    legenda: 'Cada lead chega com o vendedor da vez e o prazo de primeiro contato correndo — no prazo, vencendo ou estourado.',
  },
  {
    chave: 'chat',
    rotulo: 'Chat',
    legenda: 'O cliente conversa sem criar conta, e o vendedor responde pelo painel, com a conversa presa ao lead.',
  },
  {
    chave: 'agenda',
    rotulo: 'Agenda',
    legenda: 'Test drives e avaliações da semana, com quem já confirmou e quem ainda não.',
  },
  {
    chave: 'negocio',
    rotulo: 'Negócio',
    legenda: 'Valor de venda, desconto, custo, margem e comissão de cada carro vendido.',
  },
  {
    chave: 'relatorios',
    rotulo: 'Relatórios',
    legenda: 'Funil de conversão, margem por mês, dias em estoque e desempenho de cada vendedor.',
  },
] as const;

export default function SistemaNaPratica() {
  const [ativa, setAtiva] = useState<(typeof TELAS)[number]['chave']>('leads');
  const tela = TELAS.find((t) => t.chave === ativa)!;
  const src = `/landing/sistema/${tela.chave}.webp`;

  return (
    <section data-secao={SECOES.produto} className="mx-auto max-w-6xl px-4 sm:px-6 mb-16 sm:mb-24">
      <div className="text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">Veja o sistema funcionando</h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
          Telas reais do painel de uma loja, com dados de demonstração.
        </p>
      </div>

      <div role="tablist" aria-label="Telas do sistema" className="flex gap-2 overflow-x-auto pb-2 mb-4 sm:justify-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TELAS.map((t) => (
          <button
            key={t.chave}
            type="button"
            role="tab"
            aria-selected={t.chave === ativa}
            onClick={() => setAtiva(t.chave)}
            className={cn(
              'shrink-0 text-sm font-medium px-4 py-2 rounded-full border transition',
              t.chave === ativa
                ? 'bg-brand-accent border-brand-accent text-white'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
            )}
          >
            {t.rotulo}
          </button>
        ))}
      </div>

      <figure role="tabpanel" className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden shadow-2xl shadow-slate-300/50 dark:shadow-none">
        {/* No celular a tela do painel fica pequena: o toque abre a imagem inteira. */}
        <a href={src} target="_blank" rel="noopener" aria-label={`Abrir a tela de ${tela.rotulo} em tamanho real`}>
          <Image
            key={src}
            src={src}
            alt={`Tela de ${tela.rotulo} do AutoConnect: ${tela.legenda}`}
            width={2880}
            height={1800}
            sizes="(min-width: 1152px) 1104px, 100vw"
            className="w-full h-auto"
            priority={tela.chave === 'leads'}
          />
        </a>
        <figcaption className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
          {tela.legenda}
          <span className="sm:hidden text-slate-400"> Toque na imagem para ampliar.</span>
        </figcaption>
      </figure>

      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <a
          href="/c/demo"
          target="_blank"
          rel="noopener"
          data-evento="vitrine_demo_click"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-accent px-6 py-3 rounded-xl border border-brand-accent/40 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition"
        >
          Abrir a vitrine de uma loja demo
          <ExternalLink size={14} />
        </a>
        <a
          href={waLink('Oi, Israel! Quero ver o AutoConnect com o estoque da minha loja.')}
          target="_blank"
          rel="noopener noreferrer"
          data-evento="whatsapp_click"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 px-6 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition"
        >
          Quero ver com o meu estoque
        </a>
      </div>
    </section>
  );
}
