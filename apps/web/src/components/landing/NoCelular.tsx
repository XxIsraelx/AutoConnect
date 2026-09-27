'use client';

import { useState } from 'react';
import Image from 'next/image';
import { CalendarCheck, Camera, Inbox, MessagesSquare, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SECOES } from './config';

/**
 * O painel no celular do vendedor. Mesma regra da seção do sistema: telas
 * capturadas do produto rodando com os dados fictícios do seed (vendedor
 * "Diego", da Auto Sul), em 390 × 844, não desenhos.
 *
 * Só entra aqui o que o código faz hoje: o clique no WhatsApp vira interação
 * no lead (`ContatoDoLead`), a foto do veículo sai da câmera (`accept="image/*"`
 * no cadastro) e o manifesto é `standalone`. Notificação com o app fechado
 * **não** existe — o aviso de lead novo é a contagem no menu, com a tela aberta.
 */
const TELAS = [
  {
    chave: 'leads',
    rotulo: 'Leads',
    icone: Inbox,
    titulo: 'O lead chega, o prazo aparece',
    texto:
      'Cada lead mostra quanto falta para o primeiro contato. Um toque no WhatsApp ou no telefone abre a conversa e já registra o contato no lead — o gerente vê que foi atendido sem o vendedor anotar nada.',
  },
  {
    chave: 'chat',
    rotulo: 'Chat',
    icone: MessagesSquare,
    titulo: 'Responde de onde estiver',
    texto:
      'No pátio, no test drive ou fora da loja: a conversa com o cliente segue no celular, presa ao lead, e fica no histórico para quem assumir depois.',
  },
  {
    chave: 'agenda',
    rotulo: 'Agenda',
    icone: CalendarCheck,
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

        <figure className="order-1 lg:order-2 mx-auto">
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
          <div
            role="tabpanel"
            className="relative w-[250px] sm:w-[280px] aspect-[390/844] rounded-[2.6rem] border-[10px] border-slate-900 dark:border-slate-700 bg-slate-950 overflow-hidden shadow-2xl shadow-slate-400/40 dark:shadow-none"
          >
            <Image
              key={tela.chave}
              src={`/landing/mobile/${tela.chave}.webp`}
              alt={`Tela de ${tela.rotulo} do AutoConnect no celular: ${tela.titulo}.`}
              fill
              sizes="280px"
              className="object-cover object-top"
            />
          </div>
          <figcaption className="text-center mt-4 max-w-[300px] mx-auto">
            <span className="lg:hidden block font-semibold mb-1">{tela.titulo}</span>
            <span className="lg:hidden block text-sm text-slate-500 dark:text-slate-400 mb-2">{tela.texto}</span>
            <span className="block text-xs text-slate-400">Tela real, com dados de demonstração</span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
