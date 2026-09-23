'use client';

/**
 * Telefone, WhatsApp e e-mail de um lead — e o registro do clique.
 *
 * O buraco que isto fecha: o vendedor clicava no WhatsApp, conversava meia
 * hora e o lead continuava "Novo, sem interação" na tela do gerente. A
 * timeline só sabia o que alguém digitasse à mão, então nunca sabia nada.
 *
 * Duas regras deste componente:
 *
 *  1. **o registro nunca atrapalha o clique.** O `<a>` tem `href` de verdade e
 *     o navegador o segue; o POST sai em paralelo. Se a API cair, o vendedor
 *     ainda liga para o cliente — perder o registro é ruim, perder a ligação é
 *     pior;
 *  2. **a falha não some.** O projeto tem dívida declarada de `catch {}` que
 *     engolem erro; aqui a falha vira um aviso discreto ao lado dos botões,
 *     com o que fazer (anotar à mão).
 */

import { useState } from 'react';
import { Mail, MessageCircle, Phone } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { paraWhatsApp, formatarTelefoneBr } from '@autoconnect/shared';

type TipoDeContato = 'call' | 'whatsapp' | 'email';

export function ContatoDoLead({
  leadId,
  phone,
  email,
  compacto = false,
}: {
  /** Sem lead não há timeline: os links continuam, o registro não. */
  leadId: string | null;
  phone: string | null | undefined;
  email: string | null | undefined;
  /** Versão miúda, para o cartão do funil. */
  compacto?: boolean;
}) {
  const token = useAuthStore((s) => s.token);
  const [falhou, setFalhou] = useState(false);

  const whatsapp = paraWhatsApp(phone);

  function registrar(kind: TipoDeContato, destino: string) {
    if (!leadId || !token) return;
    setFalhou(false);

    const rotulo: Record<TipoDeContato, string> = {
      call: `Ligação iniciada para ${destino}`,
      whatsapp: `WhatsApp aberto para ${destino}`,
      email: `E-mail aberto para ${destino}`,
    };

    // Sem `await`: o clique já está indo para o discador.
    api(`/leads/${leadId}/interactions`, {
      method: 'POST',
      token,
      body: { kind, content: rotulo[kind] },
    }).catch(() => setFalhou(true));
  }

  const tamanho = compacto ? 10 : 12;
  const classe = compacto
    ? 'flex items-center gap-1 text-[10px] text-slate-500 hover:text-blue-500 transition-colors'
    : 'flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-500 transition-colors';

  if (!phone && !email) return null;

  return (
    <div className={`flex flex-wrap items-center min-w-0 ${compacto ? 'gap-x-2.5 gap-y-1' : 'gap-x-4 gap-y-1'}`}>
      {phone && (
        <a
          href={`tel:${phone.replace(/\D/g, '')}`}
          onClick={() => registrar('call', formatarTelefoneBr(phone))}
          className={`${classe} shrink-0`}
          title="Ligar e registrar na timeline"
        >
          <Phone size={tamanho} /> {formatarTelefoneBr(phone)}
        </a>
      )}

      {whatsapp && (
        <a
          href={`https://wa.me/${whatsapp}`}
          target="_blank"
          rel="noreferrer"
          onClick={() => registrar('whatsapp', formatarTelefoneBr(phone))}
          className={`${classe} shrink-0 hover:!text-emerald-500`}
          title="Abrir WhatsApp e registrar na timeline"
        >
          <MessageCircle size={tamanho} /> WhatsApp
        </a>
      )}

      {email && (
        <a
          href={`mailto:${email}`}
          onClick={() => registrar('email', email)}
          className={`${classe} min-w-0`}
          title="Escrever e registrar na timeline"
        >
          <Mail size={tamanho} /> <span className="truncate">{email}</span>
        </a>
      )}

      {falhou && (
        <span role="alert" className="text-[10px] text-amber-600 dark:text-amber-400 basis-full">
          O contato foi aberto, mas não conseguimos registrar na timeline — anote a
          interação à mão.
        </span>
      )}
    </div>
  );
}
