'use client';

/**
 * Formulário de interesse — o ponto onde o visitante vira lead.
 *
 * Antes desta tela, demonstrar interesse exigia criar conta: o modal mostrava
 * "Faça login para continuar" e a maior parte das pessoas ia embora ali. O
 * furo estava no caminho mais caro do produto inteiro — a loja paga anúncio
 * para trazer alguém que o próprio site manda embora.
 *
 * Dois caminhos, de propósito:
 *  - **sem conta** → `POST /leads/public`, com consentimento LGPD registrado;
 *  - **logado**    → `POST /leads`, que vincula o lead à conta. Aqui não há
 *    caixa de consentimento porque o aceite já aconteceu no cadastro, e pedir
 *    de novo a cada clique treina a pessoa a marcar sem ler.
 */

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Check, Loader2, MessageCircle, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { textoDoErro } from '@/components/ErroAoCarregar';

/**
 * O texto exibido no aceite. É gravado junto do lead, **por cópia**: quando
 * esta frase mudar, os consentimentos antigos continuam guardando o termo que
 * a pessoa de fato leu. Alterar a frase aqui é publicar uma versão nova.
 */
export const TEXTO_DE_CONSENTIMENTO =
  'Autorizo o contato desta concessionária por telefone, WhatsApp ou e-mail sobre ' +
  'este veículo e o tratamento dos meus dados para esse fim, conforme a Política ' +
  'de Privacidade.';

interface Props {
  /** Loja destinatária. Dispensável quando há `vehicleId` — o veículo já diz de quem é. */
  tenantId?: string;
  vehicleId?: string;
  dealerName: string;
  /** "Toyota Corolla XEi 2024", quando o interesse é num carro específico. */
  vehicleLabel?: string | null;
  onClose: () => void;
}

export default function FormularioDeInteresse({
  tenantId, vehicleId, dealerName, vehicleLabel, onClose,
}: Props) {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const logado = !!user && !!token;

  const [nome, setNome] = useState(user?.fullName ?? '');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState(user?.email ?? '');
  const [mensagem, setMensagem] = useState('');
  const [consentimento, setConsentimento] = useState(false);
  /** Honeypot: invisível para gente, irresistível para robô. */
  const [website, setWebsite] = useState('');

  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [errosDeCampo, setErrosDeCampo] = useState<Record<string, string>>({});

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    setErrosDeCampo({});

    try {
      if (logado) {
        await api('/leads', {
          method: 'POST',
          token: token!,
          body: {
            tenantId,
            vehicleId,
            contactName: nome.trim() || undefined,
            contactPhone: telefone.trim() || undefined,
            message: mensagem.trim() || undefined,
            source: 'website',
          },
        });
      } else {
        await api('/leads/public', {
          method: 'POST',
          body: {
            tenantId,
            vehicleId,
            contactName: nome.trim(),
            contactPhone: telefone.trim(),
            contactEmail: email.trim() || undefined,
            message: mensagem.trim() || undefined,
            consentimento,
            consentText: TEXTO_DE_CONSENTIMENTO,
            website,
          },
        });
      }
      setEnviado(true);
    } catch (err) {
      // `fieldErrors` vem do ZodFilter: marca o campo errado em vez de exibir
      // "Validation failed" solto no rodapé.
      if (err instanceof ApiError && err.fieldErrors.length > 0) {
        setErrosDeCampo(Object.fromEntries(err.fieldErrors.map((f) => [f.field, f.message])));
        setErro('Confira os campos destacados.');
      } else {
        setErro(textoDoErro(err));
      }
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <Moldura onClose={onClose}>
        <div className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <Check size={28} className="text-emerald-400" />
          </div>
          <h3 className="text-lg font-bold txt-forte mb-2">Interesse enviado!</h3>
          <p className="text-sm txt-fraco leading-relaxed mb-6">
            A {dealerName} recebeu seu contato e vai responder em breve pelo telefone
            que você informou.
          </p>
          <button
            onClick={onClose}
            className="w-full bg-emerald-600 text-white font-bold py-2.5 rounded-xl
                       hover:bg-emerald-500 transition-colors text-sm"
          >
            Fechar
          </button>
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura onClose={onClose}>
      <div className="flex items-start justify-between gap-3 p-5 border-b borda">
        <div className="min-w-0">
          <h3 className="text-base font-bold txt-forte flex items-center gap-2">
            <MessageCircle size={16} className="text-blue-400 shrink-0" />
            Tenho interesse
          </h3>
          <p className="text-xs text-slate-500 truncate">{vehicleLabel ?? dealerName}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="p-2 rounded-xl txt-fraco hover:txt-forte hover:sup-fraca transition-all shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      <form onSubmit={enviar} className="p-5 space-y-3.5">
        <Campo
          id="lead-nome"
          label="Seu nome"
          value={nome}
          onChange={setNome}
          erro={errosDeCampo.contactName}
          autoComplete="name"
          required
        />

        <Campo
          id="lead-telefone"
          label="Telefone / WhatsApp"
          value={telefone}
          onChange={setTelefone}
          erro={errosDeCampo.contactPhone}
          inputMode="tel"
          autoComplete="tel"
          placeholder="(11) 98765-4321"
          required
        />

        {!logado && (
          <Campo
            id="lead-email"
            label="E-mail (opcional)"
            value={email}
            onChange={setEmail}
            erro={errosDeCampo.contactEmail}
            type="email"
            autoComplete="email"
          />
        )}

        <div>
          <label htmlFor="lead-mensagem" className="text-[11px] font-semibold txt-fraco block mb-1.5">
            Mensagem (opcional)
          </label>
          <textarea
            id="lead-mensagem"
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            rows={3}
            placeholder="Ex.: gostaria de agendar um test drive no sábado."
            className="w-full rounded-xl sup-base border borda text-sm txt-forte
                       placeholder-slate-400 dark:placeholder-slate-600 px-3 py-2.5 resize-none
                       outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
          />
        </div>

        {/* Honeypot. `aria-hidden` + `tabIndex={-1}` mantêm o campo fora do
            caminho de quem usa teclado ou leitor de tela; o robô preenche. */}
        <div className="hidden" aria-hidden="true">
          <label htmlFor="lead-website">Não preencha este campo</label>
          <input
            id="lead-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        {!logado && (
          <div>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={consentimento}
                onChange={(e) => setConsentimento(e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600
                           text-blue-600 focus:ring-2 focus:ring-blue-500/30"
              />
              <span className="text-[11px] leading-relaxed txt-fraco">
                {TEXTO_DE_CONSENTIMENTO.replace(' conforme a Política de Privacidade.', '')} conforme a{' '}
                <Link
                  href="/privacidade"
                  target="_blank"
                  className="text-blue-500 hover:underline font-medium"
                >
                  Política de Privacidade
                </Link>
                .
              </span>
            </label>
            {errosDeCampo.consentimento && (
              <p className="text-[11px] text-rose-500 mt-1">{errosDeCampo.consentimento}</p>
            )}
          </div>
        )}

        {erro && (
          <div role="alert" className="flex items-start gap-2 text-rose-400 text-xs bg-rose-500/10 rounded-xl px-3 py-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0" /> {erro}
          </div>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl
                     hover:bg-blue-500 transition-colors text-sm
                     disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center justify-center gap-2"
        >
          {enviando
            ? <><Loader2 size={15} className="animate-spin" /> Enviando…</>
            : 'Enviar interesse'}
        </button>
      </form>
    </Moldura>
  );
}

/* ── Peças ───────────────────────────────────────────────── */

function Moldura({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onClose} />
      {/* `overflow-y-auto` + `py-6`: em 375px com o teclado aberto o formulário
          é mais alto que a viewport, e sem isto o botão de enviar ficava fora. */}
      <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 py-6">
        <div className="sup-card border borda rounded-2xl shadow-2xl max-w-md w-full my-auto">
          {children}
        </div>
      </div>
    </>
  );
}

function Campo({
  id, label, value, onChange, erro, required, type = 'text', placeholder, inputMode, autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  erro?: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  inputMode?: 'tel' | 'text' | 'email';
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-[11px] font-semibold txt-fraco block mb-1.5">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        aria-invalid={erro ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl sup-base border text-sm txt-forte
                    placeholder-slate-400 dark:placeholder-slate-600 px-3 py-2.5
                    outline-none focus:ring-2 focus:ring-blue-500/20 transition-all
                    ${erro ? 'border-rose-500 focus:border-rose-500' : 'borda focus:border-blue-500'}`}
      />
      {erro && <p className="text-[11px] text-rose-500 mt-1">{erro}</p>}
    </div>
  );
}
