import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SECOES } from './config';
import RaioXForm from './RaioXForm';

/**
 * "Já tenho conta" leva ao `/login` — o painel da loja. Apontava para
 * `/entrar`, que é o login do comprador e manda para `/buscar`: o dono que já
 * tinha conta entrava pela porta errada e não chegava ao painel.
 */
export default function CtaFinal() {
  return (
    <section data-secao={SECOES.final} className="mx-auto max-w-4xl px-4 sm:px-6 mb-16 sm:mb-24 text-center">
      <div className="bg-brand-accent rounded-3xl px-5 sm:px-8 py-12 sm:py-14">
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
          Descubra quanto tempo sua loja leva para responder
        </h2>
        <p className="text-blue-100 mb-8 max-w-lg mx-auto">
          O Raio-X é gratuito e o laudo chega no seu WhatsApp em 24 h.
        </p>
        <div className="mx-auto max-w-md rounded-2xl bg-white dark:bg-slate-900 p-5 text-slate-900 dark:text-slate-100 mb-6">
          <RaioXForm secao="final" />
        </div>
        <Link
          href="/comecar"
          data-evento="conta_criar_click"
          className="inline-flex items-center gap-2 text-sm font-semibold text-white px-6 py-3 rounded-xl border border-white/40 hover:bg-white/10 transition"
        >
          Criar conta grátis
          <ArrowRight size={16} />
        </Link>
        <div>
          <Link href="/login" className="inline-block mt-6 text-sm text-blue-100 hover:text-white font-medium">
            Já tenho conta →
          </Link>
        </div>
      </div>
    </section>
  );
}
