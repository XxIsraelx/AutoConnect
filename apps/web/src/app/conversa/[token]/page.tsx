'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Send, MessageSquare, Car, Store } from 'lucide-react';
import { api } from '@/lib/api';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';

/**
 * # A conversa de quem não tem conta
 *
 * B11 do piloto do primeiro dia: o produto anuncia "chat em tempo real" e não
 * oferecia conversa justamente para o lead que ele mesmo captura — o da Onda 0,
 * que nasce **sem conta** por definição. O botão "Conversar" exigia
 * `lead.customer?.id`, e esse lead nunca tem.
 *
 * Esta é a porta do outro lado. A loja manda o link (por WhatsApp, ou por
 * e-mail quando há endereço) e o visitante lê e responde aqui, sem cadastro,
 * sem senha e sem app.
 *
 * ## Por que não tem WebSocket
 *
 * O visitante não tem JWT, e autenticar socket por link exigiria um segundo
 * mecanismo de identidade só para isto. A página pergunta de novo a cada poucos
 * segundos; a loja, que tem socket, recebe a mensagem dele na hora. O lado que
 * precisa de tempo real para trabalhar é o da loja.
 */

const INTERVALO_DE_ATUALIZACAO_MS = 6000;

interface Mensagem {
  id: string;
  body: string | null;
  kind: string;
  createdAt: string;
  /** `true` = escrita pela loja. */
  deLoja: boolean;
  autor: string | null;
}

interface Conversa {
  id: string;
  status: string;
  contactName: string | null;
  tenant: { tradeName: string; logoUrl: string | null; slug: string; primaryPhone: string | null };
  vehicle: {
    id: string;
    versionName: string | null;
    yearModel: number;
    brand: { name: string };
    model: { name: string };
    images: { url: string }[];
  } | null;
  salesperson: { fullName: string } | null;
}

interface Resposta {
  conversa: Conversa;
  mensagens: Mensagem[];
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function ConversaDoVisitantePage() {
  const { token } = useParams<{ token: string }>();

  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);
  const [tentativa, setTentativa] = useState(0);

  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  const fimRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(
    async (silencioso = false) => {
      if (!token) return;
      if (!silencioso) { setCarregando(true); setErro(null); }
      try {
        setDados(await api<Resposta>(`/public/conversations/${token}`));
        if (silencioso) setErro(null);
      } catch (err) {
        // Falha da atualização automática não pode apagar a conversa que já
        // está na tela: só a carga inicial mostra o erro grande.
        if (!silencioso) setErro(err);
      } finally {
        if (!silencioso) setCarregando(false);
      }
    },
    [token],
  );

  useEffect(() => { void carregar(); }, [carregar, tentativa]);

  useEffect(() => {
    const id = setInterval(() => void carregar(true), INTERVALO_DE_ATUALIZACAO_MS);
    return () => clearInterval(id);
  }, [carregar]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dados?.mensagens.length]);

  async function enviar() {
    const corpo = texto.trim();
    if (!corpo || enviando) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      await api<Mensagem>(`/public/conversations/${token}/messages`, {
        method: 'POST',
        body: { body: corpo },
      });
      setTexto('');
      await carregar(true);
    } catch (err) {
      setErroEnvio(textoDoErro(err));
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 size={22} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (erro || !dados) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
        <div className="w-full max-w-md">
          <ErroAoCarregar
            erro={erro}
            onTentarNovamente={() => setTentativa((n) => n + 1)}
            contexto="esta conversa"
          />
          <p className="text-xs text-slate-500 mt-3 text-center">
            Links de conversa deixam de valer quando a loja gera um novo. Se este
            não abre, peça o link atualizado.
          </p>
        </div>
      </div>
    );
  }

  const { conversa, mensagens } = dados;
  const encerrada = conversa.status === 'closed';
  const veiculo = conversa.vehicle;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      {/* Cabeçalho */}
      <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800
                         bg-white dark:bg-slate-900 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center
                          justify-center shrink-0 overflow-hidden">
            {conversa.tenant.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={conversa.tenant.logoUrl} alt="" className="w-full h-full object-cover" />
              : <Store size={16} className="text-blue-600 dark:text-blue-400" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">{conversa.tenant.tradeName}</p>
            <p className="text-xs text-slate-500 truncate">
              {conversa.salesperson
                ? `com ${conversa.salesperson.fullName}`
                : 'a loja responde por aqui'}
            </p>
          </div>
          <Link
            href={`/c/${conversa.tenant.slug}`}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
          >
            Ver a loja
          </Link>
        </div>
      </header>

      {/* Veículo em pauta */}
      {veiculo && (
        <div className="px-4 pt-3">
          <div className="max-w-2xl mx-auto flex items-center gap-2.5 rounded-xl border
                          border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
            {veiculo.images[0]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={veiculo.images[0].url} alt="" className="w-14 h-10 rounded-lg object-cover shrink-0" />
              : <div className="w-14 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                  <Car size={15} className="text-slate-400" />
                </div>}
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">
                {veiculo.brand.name} {veiculo.model.name} {veiculo.versionName ?? ''}
              </p>
              <p className="text-[11px] text-slate-500">{veiculo.yearModel}</p>
            </div>
          </div>
        </div>
      )}

      {/* Mensagens */}
      <main className="flex-1 px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-3">
          {mensagens.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
              <MessageSquare size={24} />
              <p className="text-xs text-center">
                A loja abriu esta conversa com você. Escreva abaixo — não precisa criar conta.
              </p>
            </div>
          ) : mensagens.map((m) => (
            <div key={m.id} className={`flex ${m.deLoja ? '' : 'justify-end'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${m.deLoja
                ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-sm shadow-sm'
                : 'bg-blue-600 text-white rounded-tr-sm'}`}>
                {m.deLoja && m.autor && (
                  <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 mb-0.5">
                    {m.autor}
                  </p>
                )}
                <p className="leading-relaxed break-words whitespace-pre-wrap">{m.body}</p>
                <p className={`text-[10px] mt-1 ${m.deLoja ? 'text-slate-400' : 'text-blue-200 text-right'}`}>
                  {hora(m.createdAt)}
                </p>
              </div>
            </div>
          ))}
          <div ref={fimRef} />
        </div>
      </main>

      {/* Escrever */}
      <footer className="px-4 py-3 border-t border-slate-200 dark:border-slate-800
                         bg-white dark:bg-slate-900 sticky bottom-0">
        <div className="max-w-2xl mx-auto">
          {encerrada ? (
            <p className="text-xs text-slate-500 text-center py-1.5">
              Esta conversa foi encerrada pela loja.
              {conversa.tenant.primaryPhone
                ? ` Para falar de novo, ligue para ${conversa.tenant.primaryPhone}.`
                : ''}
            </p>
          ) : (
            <>
              <div className="flex items-end gap-2">
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar(); }
                  }}
                  rows={1}
                  placeholder="Escreva sua mensagem…"
                  className="flex-1 resize-none px-3.5 py-2.5 text-sm rounded-xl border
                             border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800
                             outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                             transition max-h-32"
                />
                <button
                  onClick={() => void enviar()}
                  disabled={!texto.trim() || enviando}
                  className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700
                             disabled:opacity-40 transition shrink-0"
                  aria-label="Enviar"
                >
                  {enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
              {erroEnvio && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1.5">{erroEnvio}</p>
              )}
              <p className="text-[10px] text-slate-400 mt-1.5">
                Este link é só seu — quem o tiver entra nesta conversa.
              </p>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
