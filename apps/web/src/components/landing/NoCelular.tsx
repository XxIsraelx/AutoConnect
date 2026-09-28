'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  BatteryFull, BellRing, CalendarCheck, Camera, Inbox, MessagesSquare, Signal, Smartphone, Wifi,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SECOES } from './config';

/**
 * O painel no celular do vendedor. Mesma regra da seção do sistema: telas
 * capturadas do produto rodando com a loja de demonstração (os vendedores da
 * Aurora Seminovos, dados fictícios do `demo.ts`), em 390 × 844, não desenhos.
 *
 * Só entra aqui o que o código faz hoje: o clique no WhatsApp vira interação
 * no lead (`ContatoDoLead`), a foto do veículo sai da câmera (`accept="image/*"`
 * no cadastro), o manifesto é `standalone` e, desde 27/09/2026, lead novo e
 * mensagem do cliente chegam como notificação com o app fechado (web push,
 * que cada vendedor ativa no próprio aparelho, em Canais).
 *
 * A captura fica entre uma barra de status e uma de gestos, desenhadas aqui:
 * são elas que ficam sob os cantos arredondados da tela, e não o menu e o
 * contador do topo do painel, que a curva cortava.
 */

/** Cor do cabeçalho do painel no tema escuro, medida na captura. */
const COR_DO_TOPO = '#0f172b';
/** Fundo das páginas do painel no tema escuro (slate-950). */
const COR_DO_FUNDO = '#020617';

const TELAS = [
  {
    chave: 'leads',
    rotulo: 'Leads',
    icone: Inbox,
    // A lista continua abaixo da dobra: o pé esmaece em vez de cortar um cartão seco.
    rodape: COR_DO_FUNDO,
    titulo: 'O lead chega, o prazo aparece',
    texto:
      'Cada lead mostra quanto falta para o primeiro contato. Um toque no WhatsApp ou no telefone abre a conversa e já registra o contato no lead — o gerente vê que foi atendido sem o vendedor anotar nada.',
  },
  {
    chave: 'chat',
    rotulo: 'Chat',
    icone: MessagesSquare,
    // A captura termina na barra de digitação, que tem a cor do cabeçalho.
    rodape: null,
    titulo: 'Responde de onde estiver',
    texto:
      'No pátio, no test drive ou fora da loja: a conversa com o cliente segue no celular, presa ao lead, e fica no histórico para quem assumir depois.',
  },
  {
    chave: 'agenda',
    rotulo: 'Agenda',
    icone: CalendarCheck,
    rodape: COR_DO_FUNDO,
    titulo: 'O dia na palma da mão',
    texto:
      'Test drives e visitas de hoje e de amanhã, com quem já confirmou. O vendedor confirma, remarca e marca o comparecimento ali mesmo.',
  },
] as const;

export default function NoCelular() {
  const [ativa, setAtiva] = useState<(typeof TELAS)[number]['chave']>('leads');
  const tela = TELAS.find((t) => t.chave === ativa)!;

  return (
    <section data-secao={SECOES.celular} className="mx-auto max-w-6xl px-4 sm:px-6 mb-16 sm:mb-24">
      <div className="text-center mb-10">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-accent mb-3">
          <Smartphone size={14} /> Também no celular
        </p>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          O vendedor não precisa estar na mesa para vender
        </h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
          Vendedor de loja de carro passa o dia no pátio, mostrando veículo e acompanhando test drive.
          O AutoConnect vai junto: o mesmo painel, ajustado para a tela do celular, sem instalar nada.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_auto] gap-8 lg:gap-14 items-center">
        <div className="order-2 lg:order-1">
          {/* No celular os cartões ficariam abaixo do telefone, e o toque trocaria
              uma tela fora de vista: lá quem troca são as abas acima dele. */}
          <div role="tablist" aria-label="Telas no celular" className="hidden lg:block space-y-3">
            {TELAS.map((t) => {
              const Icone = t.icone;
              const selecionada = t.chave === ativa;
              return (
                <button
                  key={t.chave}
                  type="button"
                  role="tab"
                  aria-selected={selecionada}
                  onClick={() => setAtiva(t.chave)}
                  className={cn(
                    'w-full text-left rounded-2xl border p-4 sm:p-5 transition flex gap-4',
                    selecionada
                      ? 'border-brand-accent bg-blue-50/60 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700',
                  )}
                >
                  <span
                    className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                      selecionada
                        ? 'bg-brand-accent text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
                    )}
                  >
                    <Icone size={18} />
                  </span>
                  <span>
                    <span className="block font-semibold mb-1">{t.titulo}</span>
                    <span className="block text-sm text-slate-500 dark:text-slate-400">{t.texto}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <ul className="lg:mt-6 grid sm:grid-cols-2 gap-3 text-sm text-slate-600 dark:text-slate-300">
            <li className="flex gap-2.5 sm:col-span-2">
              <BellRing size={16} className="text-brand-accent shrink-0 mt-0.5" />
              Lead novo e mensagem do cliente chegam como notificação no celular, mesmo com o AutoConnect fechado.
            </li>
            <li className="flex gap-2.5">
              <Camera size={16} className="text-brand-accent shrink-0 mt-0.5" />
              Carro novo no estoque: as fotos saem da câmera do celular, direto no anúncio.
            </li>
            <li className="flex gap-2.5">
              <Smartphone size={16} className="text-brand-accent shrink-0 mt-0.5" />
              Adicione à tela inicial e abra como um app, sem loja de aplicativos.
            </li>
          </ul>
        </div>

        <figure className="order-1 lg:order-2">
          <div role="tablist" aria-label="Telas no celular" className="lg:hidden flex justify-center gap-2 mb-5">
            {TELAS.map((t) => (
              <button
                key={t.chave}
                type="button"
                role="tab"
                aria-selected={t.chave === ativa}
                onClick={() => setAtiva(t.chave)}
                className={cn(
                  'text-sm font-medium px-4 py-2 rounded-full border transition',
                  t.chave === ativa
                    ? 'bg-brand-accent border-brand-accent text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300',
                )}
              >
                {t.rotulo}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="relative isolate mx-auto w-[270px] sm:w-[300px]">
            {/* Brilho atrás do aparelho, para ele não sumir no fundo escuro. */}
            <div aria-hidden className="absolute -z-10 inset-x-4 inset-y-24 rounded-full bg-brand-accent/25 blur-3xl" />
            {/* Botões laterais */}
            <span aria-hidden className="absolute -left-[3px] top-28 h-8 w-[3px] rounded-l bg-slate-700" />
            <span aria-hidden className="absolute -left-[3px] top-40 h-14 w-[3px] rounded-l bg-slate-700" />
            <span aria-hidden className="absolute -right-[3px] top-36 h-20 w-[3px] rounded-r bg-slate-700" />

            <div className="rounded-[3rem] bg-slate-900 dark:bg-slate-800 p-[9px] ring-1 ring-slate-900/10 dark:ring-slate-700 shadow-2xl shadow-slate-900/30 dark:shadow-black/60">
              <div className="relative overflow-hidden rounded-[2.4rem]" style={{ background: COR_DO_TOPO }}>
                <div aria-hidden className="relative flex items-center justify-between h-9 px-7 text-[11px] font-semibold text-white">
                  <span>9:41</span>
                  <span className="absolute left-1/2 top-2 -translate-x-1/2 h-[22px] w-[76px] rounded-full bg-black" />
                  <span className="flex items-center gap-1">
                    <Signal size={12} strokeWidth={2.5} />
                    <Wifi size={12} strokeWidth={2.5} />
                    <BatteryFull size={16} strokeWidth={2} />
                  </span>
                </div>

                <div className="relative">
                  <Image
                    key={tela.chave}
                    src={`/landing/mobile/${tela.chave}.webp`}
                    alt={`Tela de ${tela.rotulo} do AutoConnect no celular: ${tela.titulo}.`}
                    width={780}
                    height={1688}
                    sizes="(min-width: 640px) 282px, 252px"
                    className="block w-full h-auto"
                  />
                  {tela.rodape && (
                    <div
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-14"
                      style={{ background: `linear-gradient(to bottom, transparent, ${tela.rodape})` }}
                    />
                  )}
                </div>

                <div
                  aria-hidden
                  className="h-7 flex items-center justify-center"
                  style={{ background: tela.rodape ?? COR_DO_TOPO }}
                >
                  <span className="h-1 w-24 rounded-full bg-white/70" />
                </div>
              </div>
            </div>
          </div>
          <figcaption className="text-center mt-6 max-w-[320px] mx-auto">
            <span className="lg:hidden block font-semibold mb-1">{tela.titulo}</span>
            <span className="lg:hidden block text-sm text-slate-500 dark:text-slate-400 mb-2">{tela.texto}</span>
            <span className="block text-xs text-slate-400">Tela real, com dados de demonstração</span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
