'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  CARGOS_DO_RAIO_X,
  LIMITE_NOME_DA_LOJA,
  TEXTO_DE_CONSENTIMENTO_RAIO_X,
  mascararTelefoneBr,
  mensagemDoRaioX,
  origemDoRaioX,
  type CargoDoRaioX,
} from '@autoconnect/shared';
import { api, ApiError } from '@/lib/api';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { cn } from '@/lib/utils';
import { waLink } from './config';
import { registrarEvento } from './eventos';

/**
 * Loja "AutoConnect" que recebe os pedidos. Criada pelo cadastro normal em
 * produção; o id vem do build, como toda NEXT_PUBLIC_*. Sem ele, o formulário
 * não aparece — no lugar, o pedido vai pelo WhatsApp, que é melhor que um
 * formulário que responde erro a quem preencheu tudo.
 */
const LOJA_DO_RAIO_X = process.env.NEXT_PUBLIC_RAIO_X_TENANT_ID;

const INPUT =
  'w-full rounded-xl border bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none transition ' +
  'placeholder-slate-400 dark:placeholder-slate-600 focus:ring-2 focus:ring-blue-500/20';

type Campo = 'contactName' | 'contactPhone' | 'loja' | 'cargo' | 'consentimento';

/**
 * Pedido do Raio-X gratuito, que vira lead na loja "AutoConnect" pelo mesmo
 * `POST /leads/public` da vitrine (regra em `packages/shared/src/domain/raio-x.ts`).
 *
 * `origem` vem de `?origem=` (ManyChat, bio) e é lida no efeito, e não com
 * `useSearchParams`, para a home continuar estática.
 */
export default function RaioXForm({ secao }: { secao: 'hero' | 'final' | 'pagina' }) {
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [loja, setLoja] = useState('');
  const [cargo, setCargo] = useState<CargoDoRaioX | ''>('');
  const [consentimento, setConsentimento] = useState(false);
  /** Honeypot: invisível para gente, irresistível para robô. */
  const [website, setWebsite] = useState('');
  const [origem, setOrigem] = useState<string | null>(null);

  const [erros, setErros] = useState<Partial<Record<Campo, string>>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    setOrigem(new URLSearchParams(window.location.search).get('origem'));
  }, []);

  if (!LOJA_DO_RAIO_X) {
    return (
      <a
        href={waLink('Oi, Israel! Quero o Raio-X gratuito do atendimento da minha loja.')}
        target="_blank"
        rel="noopener noreferrer"
        data-evento="whatsapp_click"
        className="flex w-full items-center justify-center gap-2 bg-brand-accent text-white font-semibold px-6 py-3.5 rounded-xl hover:bg-blue-600 transition text-sm"
      >
        Pedir o Raio-X pelo WhatsApp
      </a>
    );
  }

  /** O erro de um campo sai quando a pessoa mexe nele, não no próximo envio. */
  const limpar = (campo: Campo) => setErros((e) => (e[campo] ? { ...e, [campo]: undefined } : e));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    // Loja e cargo não existem no schema do lead — vão no `message` —, então
    // quem confere que foram preenchidos é a tela.
    const locais: Partial<Record<Campo, string>> = {};
    if (loja.trim().length < 2) locais.loja = 'Informe o nome da loja';
    if (!cargo) locais.cargo = 'Escolha o seu cargo';
    if (Object.keys(locais).length > 0) {
      setErros(locais);
      return;
    }

    setEnviando(true);
    try {
      await api('/leads/public', {
        method: 'POST',
        body: {
          tenantId: LOJA_DO_RAIO_X,
          contactName: nome.trim(),
          contactPhone: telefone.trim(),
          message: mensagemDoRaioX({ loja, cargo: cargo as CargoDoRaioX, origem, secao }),
          consentimento,
          consentText: TEXTO_DE_CONSENTIMENTO_RAIO_X,
          website,
        },
      });
      setEnviado(true);
      registrarEvento('raio_x_enviado', { secao, origem: origemDoRaioX(origem) });
    } catch (err) {
      // `fieldErrors` vem do ZodFilter: marca o campo em vez de "Validation failed".
      if (err instanceof ApiError && err.fieldErrors.length > 0) {
        setErros(Object.fromEntries(err.fieldErrors.map((f) => [f.field, f.message])));
      } else {
        setErro(textoDoErro(err));
      }
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div role="status" className="flex flex-col items-center text-center gap-3 py-4">
        <CheckCircle2 size={36} className="text-emerald-500" />
        <p className="font-semibold">Pedido recebido!</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs">
          Em até 24 h o laudo do atendimento da sua loja chega no seu WhatsApp.
        </p>
      </div>
    );
  }

  const id = (campo: string) => `raio-x-${secao}-${campo}`;
  const borda = (campo: Campo) =>
    erros[campo] ? 'border-rose-400 dark:border-rose-500/70' : 'border-slate-200 dark:border-slate-700 focus:border-blue-500';
  const Erro = ({ campo }: { campo: Campo }) =>
    erros[campo] ? <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{erros[campo]}</p> : null;
  const rotulo = 'block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1';

  return (
    // `data-clarity-mask`: o que se digita aqui não entra na gravação do Clarity.
    <form onSubmit={enviar} noValidate data-clarity-mask="true" className="space-y-3 text-left">
      <div>
        <label htmlFor={id('nome')} className={rotulo}>Seu nome</label>
        <input
          id={id('nome')}
          value={nome}
          onChange={(e) => { setNome(e.target.value); limpar('contactName'); }}
          autoComplete="name"
          aria-invalid={!!erros.contactName}
          className={cn(INPUT, borda('contactName'))}
        />
        <Erro campo="contactName" />
      </div>

      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
        <div>
          <label htmlFor={id('whatsapp')} className={rotulo}>WhatsApp</label>
          <input
            id={id('whatsapp')}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={telefone}
            onChange={(e) => { setTelefone(mascararTelefoneBr(e.target.value)); limpar('contactPhone'); }}
            placeholder="(19) 99999-9999"
            aria-invalid={!!erros.contactPhone}
            className={cn(INPUT, borda('contactPhone'))}
          />
          <Erro campo="contactPhone" />
        </div>
        <div>
          <label htmlFor={id('cargo')} className={rotulo}>Seu cargo</label>
          <select
            id={id('cargo')}
            value={cargo}
            onChange={(e) => { setCargo(e.target.value as CargoDoRaioX); limpar('cargo'); }}
            aria-invalid={!!erros.cargo}
            className={cn(INPUT, borda('cargo'), !cargo && 'text-slate-400 dark:text-slate-600')}
          >
            <option value="" disabled>Escolha</option>
            {CARGOS_DO_RAIO_X.map((c) => (
              <option key={c.valor} value={c.valor} className="text-slate-900 dark:text-slate-100">
                {c.rotulo}
              </option>
            ))}
          </select>
          <Erro campo="cargo" />
        </div>
      </div>

      <div>
        <label htmlFor={id('loja')} className={rotulo}>Nome da loja</label>
        <input
          id={id('loja')}
          value={loja}
          maxLength={LIMITE_NOME_DA_LOJA}
          onChange={(e) => { setLoja(e.target.value); limpar('loja'); }}
          autoComplete="organization"
          aria-invalid={!!erros.loja}
          className={cn(INPUT, borda('loja'))}
        />
        <Erro campo="loja" />
      </div>

      {/* Honeypot. `aria-hidden` + `tabIndex={-1}` mantêm o campo fora do
          caminho de quem usa teclado ou leitor de tela; o robô preenche. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor={id('website')}>Não preencha este campo</label>
        <input
          id={id('website')}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <div>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={consentimento}
            onChange={(e) => { setConsentimento(e.target.checked); limpar('consentimento'); }}
            className="mt-0.5 w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-2 focus:ring-blue-500/30"
          />
          <span className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            {TEXTO_DE_CONSENTIMENTO_RAIO_X.replace(' conforme a Política de Privacidade.', '')} conforme a{' '}
            <Link href="/privacidade" target="_blank" className="text-brand-accent hover:underline font-medium">
              Política de Privacidade
            </Link>
            .
          </span>
        </label>
        <Erro campo="consentimento" />
      </div>

      {erro && (
        <div role="alert" className="flex items-start gap-2 text-rose-600 dark:text-rose-400 text-xs bg-rose-500/10 rounded-xl px-3 py-2">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>
            {erro}{' '}
            <a
              href={waLink('Oi, Israel! Tentei pedir o Raio-X pelo site e não consegui.')}
              target="_blank"
              rel="noopener noreferrer"
              data-evento="whatsapp_click"
              className="underline font-medium"
            >
              Pedir pelo WhatsApp
            </a>
          </span>
        </div>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="flex w-full items-center justify-center gap-2 bg-brand-accent text-white font-semibold px-6 py-3.5 rounded-xl
                   hover:bg-blue-600 disabled:opacity-60 transition text-sm"
      >
        {enviando && <Loader2 size={16} className="animate-spin" />}
        Pedir o Raio-X gratuito
      </button>
    </form>
  );
}
