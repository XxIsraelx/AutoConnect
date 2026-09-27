'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, MessageCircle, Plug, Unplug } from 'lucide-react';
import { formatarTelefoneBr, mascararTelefoneBr } from '@autoconnect/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';

interface Capacidade {
  disponivel: boolean;
  provedor: string;
  simulado: boolean;
  conta: { id: string; numero: string; conectadaEm: string } | null;
}

interface Uso {
  conversas: number;
  mensagensRecebidas: number;
  modelosEnviados: number;
  modelosPorCategoria: Record<string, number>;
}

const CATEGORIA: Record<string, string> = {
  utility: 'utilidade',
  marketing: 'marketing',
  authentication: 'autenticação',
};

const input =
  'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm ' +
  'outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition';

/**
 * Canais: por onde o cliente chega e por onde a loja responde.
 *
 * Hoje, o WhatsApp oficial. Conectar o número é do administrador (é a voz da
 * loja); o resto da equipe vê o estado e usa o canal pelo chat e pelo lead.
 * Com o provedor simulado, a tela diz isso em destaque e oferece o simulador —
 * é assim que se testa o fluxo inteiro antes de existir conta na Meta.
 */
export default function CanaisPage() {
  const token = useAuthStore((s) => s.token);
  const papel = useAuthStore((s) => s.user?.role);
  const administra = papel === 'tenant_admin' || papel === 'super_admin';

  const [cap, setCap] = useState<Capacidade | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      const c = await api<Capacidade>('/whatsapp/capacidade', { token });
      setCap(c);
      setUso(c.conta ? await api<Uso>('/whatsapp/uso', { token }) : null);
    } catch (err) {
      setErro(err);
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="p-4 sm:p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold txt-forte">Canais</h1>
        <p className="text-sm txt-fraco mt-1">Por onde os clientes chegam, e por onde a loja responde.</p>
      </div>

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center gap-2.5 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
            <MessageCircle size={14} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="font-semibold txt-forte text-sm">WhatsApp oficial</h2>
          {cap?.simulado && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full
                             bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              <FlaskConical size={11} /> Simulação
            </span>
          )}
        </div>

        <div className="p-6 space-y-5">
          {carregando && !cap ? (
            <Loader2 size={20} className="animate-spin text-slate-400" />
          ) : erro ? (
            <ErroAoCarregar erro={erro} onTentarNovamente={carregar} carregando={carregando} contexto="o estado do WhatsApp" />
          ) : !cap?.disponivel ? (
            <p className="text-sm txt-fraco">
              O WhatsApp oficial ainda não está ligado neste servidor. Enquanto isso, o botão de WhatsApp do
              lead abre a conversa no celular do vendedor e registra o contato no histórico.
            </p>
          ) : (
            <>
              {cap.simulado && (
                <p className="text-xs rounded-xl px-3 py-2 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  Ambiente de simulação: nenhuma mensagem sai deste servidor. Com um número conectado, o
                  simulador aparece aqui embaixo para você fazer o papel do cliente.
                </p>
              )}

              <Explicacao />

              {cap.conta ? (
                <ContaConectada
                  conta={cap.conta}
                  uso={uso}
                  administra={administra}
                  token={token!}
                  onMudou={carregar}
                />
              ) : administra ? (
                <Conectar simulado={cap.simulado} token={token!} onConectou={carregar} />
              ) : (
                <p className="text-sm txt-fraco">
                  A loja ainda não conectou um número. Peça ao administrador para conectar em Canais.
                </p>
              )}

              {cap.simulado && cap.conta && <Simulador token={token!} />}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Explicacao() {
  return (
    <div className="text-sm txt-medio space-y-2">
      <p>
        As mensagens que os clientes mandam para o número da loja chegam no <strong>Chat</strong>, ligadas ao
        lead — quem ainda não era lead vira um, e entra no rodízio com o prazo de primeiro contato correndo.
        O vendedor responde de lá, sem copiar e colar.
      </p>
      <p className="txt-fraco text-xs">
        Regra do WhatsApp: a loja escreve livremente até 24 horas depois da última mensagem do cliente. Fora
        disso, e no primeiro contato, só com um <strong>modelo aprovado</strong> — o sistema oferece o modelo na
        hora certa.
      </p>
    </div>
  );
}

function Conectar({ simulado, token, onConectou }: { simulado: boolean; token: string; onConectou: () => void }) {
  const [numero, setNumero] = useState('');
  const [idExterno, setIdExterno] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function conectar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await api('/whatsapp/conta', {
        method: 'POST',
        token,
        body: { numero, ...(idExterno.trim() ? { idExterno: idExterno.trim() } : {}) },
      });
      onConectou();
    } catch (err) {
      setErro(textoDoErro(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={conectar} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <p className="text-sm font-medium txt-forte">Conectar o número da loja</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-medium txt-medio mb-1">Número do WhatsApp</span>
          <input className={input} value={numero} inputMode="tel" placeholder="(11) 98888-0001"
                 onChange={(e) => setNumero(mascararTelefoneBr(e.target.value))} required />
        </label>
        {!simulado && (
          <label className="block">
            <span className="block text-xs font-medium txt-medio mb-1">Id do número (phone_number_id)</span>
            <input className={input} value={idExterno} inputMode="numeric" placeholder="106540352242922"
                   onChange={(e) => setIdExterno(e.target.value.replace(/\D/g, ''))} required />
          </label>
        )}
      </div>
      {!simulado && (
        <p className="text-xs txt-fraco">
          O id aparece no painel do WhatsApp da Meta, em Configuração da API, ao lado do número.
        </p>
      )}
      {erro && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{erro}</p>}
      <button type="submit" disabled={salvando || numero.replace(/\D/g, '').length < 10}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white
                         hover:bg-emerald-700 disabled:opacity-50 transition">
        {salvando ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} Conectar
      </button>
    </form>
  );
}

function ContaConectada({ conta, uso, administra, token, onMudou }: {
  conta: NonNullable<Capacidade['conta']>;
  uso: Uso | null;
  administra: boolean;
  token: string;
  onMudou: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function desconectar() {
    setSaindo(true);
    setErro(null);
    try {
      await api('/whatsapp/conta', { method: 'DELETE', token });
      onMudou();
    } catch (err) {
      setErro(textoDoErro(err));
      setSaindo(false);
    }
  }

  const categorias = Object.entries(uso?.modelosPorCategoria ?? {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30
                      bg-emerald-50/60 dark:bg-emerald-500/5 px-4 py-3">
        <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
        <div className="text-sm">
          <p className="font-semibold txt-forte">{formatarTelefoneBr(conta.numero)}</p>
          <p className="text-xs txt-fraco">
            Conectado em {new Date(conta.conectadaEm).toLocaleDateString('pt-BR')}
          </p>
        </div>
        {administra && !confirmando && (
          <button onClick={() => setConfirmando(true)}
                  className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium txt-fraco hover:text-rose-600 transition">
            <Unplug size={13} /> Desconectar
          </button>
        )}
      </div>

      {confirmando && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-500/30 p-4 space-y-3">
          <p className="text-sm txt-medio flex gap-2">
            <AlertTriangle size={16} className="text-rose-500 shrink-0 mt-0.5" />
            Desconectado, o número para de receber e de enviar pelo sistema. As conversas ficam guardadas, e
            reconectar o mesmo número as retoma.
          </p>
          {erro && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{erro}</p>}
          <div className="flex gap-2">
            <button onClick={desconectar} disabled={saindo}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 transition">
              {saindo && <Loader2 size={14} className="animate-spin" />} Desconectar
            </button>
            <button onClick={() => setConfirmando(false)}
                    className="px-4 py-2 rounded-xl text-sm font-medium txt-medio hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {uso && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide txt-fraco mb-2">Neste mês</p>
          <div className="grid grid-cols-3 gap-3">
            <Numero valor={uso.conversas} rotulo="conversas" />
            <Numero valor={uso.mensagensRecebidas} rotulo="mensagens recebidas" />
            <Numero valor={uso.modelosEnviados} rotulo="modelos enviados" />
          </div>
          {categorias.length > 0 && (
            <p className="text-xs txt-fraco mt-2">
              Modelos por categoria: {categorias.map(([c, n]) => `${n} de ${CATEGORIA[c] ?? c}`).join(', ')}.
              A Meta cobra por modelo enviado; responder o cliente dentro das 24 horas não é cobrado.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Numero({ valor, rotulo }: { valor: number; rotulo: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2">
      <p className="text-xl font-bold txt-forte">{valor}</p>
      <p className="text-[11px] txt-fraco">{rotulo}</p>
    </div>
  );
}

/** Faz o papel do cliente: a mensagem entra pelo mesmo webhook que a Meta usaria. */
function Simulador({ token }: { token: string }) {
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    setFeito(false);
    try {
      await api('/whatsapp/simular', { method: 'POST', token, body: { acao: 'mensagem', nome, telefone, texto } });
      setFeito(true);
      setTexto('');
    } catch (err) {
      setErro(textoDoErro(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="rounded-xl border border-dashed border-amber-300 dark:border-amber-500/40 p-4 space-y-3">
      <p className="text-sm font-medium txt-forte flex items-center gap-2">
        <FlaskConical size={14} className="text-amber-600" /> Simular a mensagem de um cliente
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <input className={input} placeholder="Nome do cliente" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <input className={input} placeholder="(11) 97777-0000" inputMode="tel" value={telefone}
               onChange={(e) => setTelefone(mascararTelefoneBr(e.target.value))} required />
      </div>
      <textarea className={input} rows={2} placeholder="Oi, o carro do anúncio ainda está disponível?"
                value={texto} onChange={(e) => setTexto(e.target.value)} required />
      {erro && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{erro}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={enviando}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition">
          {enviando && <Loader2 size={14} className="animate-spin" />} Entregar como cliente
        </button>
        {feito && (
          <span className="text-sm text-emerald-700 dark:text-emerald-400">
            Entregue. <Link href="/chat" className="underline">Ver no Chat</Link>
          </span>
        )}
      </div>
    </form>
  );
}
