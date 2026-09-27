import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import Logo from '@/components/Logo';
import RaioXForm from '@/components/landing/RaioXForm';

export const metadata: Metadata = {
  title: 'Raio-X gratuito do atendimento — AutoConnect',
  description:
    'Testamos o atendimento da sua loja como cliente oculto e mandamos o laudo no seu WhatsApp em 24 h.',
};

const O_QUE_A_LOJA_RECEBE = [
  'Quanto tempo sua loja levou para responder um cliente de verdade',
  'Se houve retorno, e em que momento a conversa esfriou',
  'O que mudar primeiro para não perder o próximo lead',
];

/**
 * Destino do ManyChat e do link da bio (`/raio-x?origem=instagram`). Só o
 * essencial: quem chega aqui já clicou querendo o Raio-X, e cada seção entre
 * a pessoa e o formulário é uma chance de desistir. Fica no grupo `(landing)`
 * para herdar a prévia de link da home.
 */
export default function RaioXPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <main className="mx-auto max-w-md px-4 py-10 sm:py-16">
        <Link href="/" className="inline-block text-lg mb-10">
          <Logo />
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight leading-tight mb-3">
          Raio-X gratuito do atendimento da sua loja
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mb-6">
          Um cliente oculto chama sua loja. Em 24 h você recebe o laudo no WhatsApp.
        </p>
        <ul className="space-y-2.5 mb-8">
          {O_QUE_A_LOJA_RECEBE.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
              <CheckCircle2 size={16} className="text-brand-accent mt-0.5 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <RaioXForm secao="pagina" />
        </div>
      </main>
    </div>
  );
}
