'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ExternalLink, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SECOES, waLink } from './config';

/**
 * O sistema de verdade, no lugar da maquete. São telas do painel capturadas
 * do produto rodando com a loja de demonstração (a "Aurora Seminovos" do
 * `demo.ts`, a mesma da vitrine ao vivo), não desenhos: se uma tela mudar, a
 * captura se refaz — o roteiro está no plano da landing.
 *
 * As capturas entram num MacBook desenhado aqui — moldura, câmera, base e uma
 * janela de navegador com o endereço da tela —, para o visitante ler "é o
 * sistema aberto num computador", e não "é uma imagem".
 *
 * E a vitrine ao vivo é a da loja de demonstração (`/c/demo`, a "Aurora
 * Seminovos"), que fica fora da busca e do mapa e avisa que é demonstração.
 */
const TELAS = [
  {
    chave: 'leads',
    rota: '/leads',
    rotulo: 'Leads',
    legenda: 'Do site ou encaminhado dos portais, cada lead chega com o vendedor da vez e o prazo de primeiro contato correndo — no prazo, vencendo ou estourado.',
  },
  {
    chave: 'chat',
    rota: '/chat',
    rotulo: 'Chat',
    legenda: 'O cliente conversa sem criar conta, e o vendedor responde pelo painel, com a conversa presa ao lead.',
  },
  {
    chave: 'agenda',
    rota: '/agendamentos',
    rotulo: 'Agenda',
    legenda: 'Test drives e avaliações da semana, com quem já confirmou e quem ainda não.',
  },
  {
    chave: 'negocio',
    rota: '/negocios',
    rotulo: 'Negócio',
    legenda: 'Valor de venda, desconto, custo, margem e comissão de cada carro vendido.',
  },
  {
    chave: 'financeiro',
    rota: '/financeiro',
    rotulo: 'Financeiro',
    legenda: 'O caixa dos próximos 30 dias, dia a dia, com o aviso se ele ficar negativo — e as contas nascem sozinhas da compra, da preparação e da venda do carro.',
  },
  {
    chave: 'relatorios',
    rota: '/relatorios',
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

      <figure role="tabpanel">
        <div className="relative isolate">
          {/* Brilho atrás do computador, para ele não sumir no fundo escuro. */}
          <div aria-hidden className="absolute -z-10 inset-x-[15%] inset-y-[10%] rounded-full bg-brand-accent/15 blur-3xl" />

          {/* Tampa: moldura preta com a câmera no alto. */}
          <div className="relative mx-auto w-[92%] rounded-t-[10px] sm:rounded-t-[22px] bg-slate-950 dark:bg-slate-900 p-[1.6%] pb-[2%] ring-1 ring-slate-900/20 dark:ring-slate-700/70">
            <span aria-hidden className="absolute left-1/2 top-[0.55%] -translate-x-1/2 w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-slate-700" />
            <div className="overflow-hidden rounded-[3px] sm:rounded-md bg-slate-950">
              {/* Janela do navegador, no escuro como o painel capturado. */}
              <div aria-hidden className="flex items-center gap-2 h-5 sm:h-8 px-2 sm:px-3 bg-slate-800 border-b border-slate-700/60">
                <span className="flex gap-1 sm:gap-1.5 shrink-0">
                  <span className="w-1.5 h-1.5 sm:w-2.5 sm:h-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="w-1.5 h-1.5 sm:w-2.5 sm:h-2.5 rounded-full bg-[#febc2e]" />
                  <span className="w-1.5 h-1.5 sm:w-2.5 sm:h-2.5 rounded-full bg-[#28c840]" />
                </span>
                <span className="mx-auto flex items-center justify-center gap-1 min-w-0 w-[55%] rounded sm:rounded-md bg-slate-900 px-2 py-px sm:py-1 text-[7px] sm:text-xs text-slate-400">
                  <Lock className="w-1.5 h-1.5 sm:w-3 sm:h-3 shrink-0" />
                  <span className="truncate">autoconnectapp.com.br{tela.rota}</span>
                </span>
                {/* Contrapeso dos três botões, para o endereço ficar no centro. */}
                <span className="w-[26px] sm:w-[42px] shrink-0" />
              </div>
              {/* No celular a tela do painel fica pequena: o toque abre a imagem inteira. */}
              <a href={src} target="_blank" rel="noopener" aria-label={`Abrir a tela de ${tela.rotulo} em tamanho real`}>
                <Image
                  key={src}
                  src={src}
                  alt={`Tela de ${tela.rotulo} do AutoConnect: ${tela.legenda}`}
                  width={2880}
                  height={1800}
                  sizes="(min-width: 1152px) 980px, 90vw"
                  className="block w-full h-auto"
                  priority={tela.chave === 'leads'}
                />
              </a>
            </div>
          </div>

          {/* Base: alumínio, mais larga que a tampa, com o rebaixo para abrir. */}
          <div aria-hidden className="relative h-2 sm:h-4 rounded-b-[8px] sm:rounded-b-[18px] bg-gradient-to-b from-slate-300 via-slate-200 to-slate-400 dark:from-slate-500 dark:via-slate-600 dark:to-slate-700 shadow-xl shadow-slate-900/20 dark:shadow-black/50">
            <span className="absolute left-1/2 top-0 -translate-x-1/2 w-[14%] h-1/2 rounded-b-md bg-slate-400/70 dark:bg-slate-800/70" />
          </div>
        </div>

        <figcaption className="mt-6 text-center text-sm text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
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
