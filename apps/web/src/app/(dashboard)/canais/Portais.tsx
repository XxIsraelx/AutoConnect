'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, FlaskConical, Globe, Loader2, RefreshCw, RotateCcw, Unplug } from 'lucide-react';
import { mascararTelefoneBr, type ChaveDoPortal } from '@autoconnect/shared';
import { api, API_URL } from '@/lib/api';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import { cn } from '@/lib/utils';
import PassoAPassoDoPortal, { type ProgressoDoPortal } from './PassoAPassoDoPortal';

interface Entrega {
  id: string;
  situacao: 'aplicado' | 'duplicado' | 'nao_entendido' | 'ignorado';
  resumo: string | null;
  transporte: 'webhook' | 'email';
  recebidaEm: string;
  leads: number;
}

interface Portal {
  chave: ChaveDoPortal;
  nome: string;
  conexao: { id: string; conectadaEm: string; ultimoRecebimento: string | null } | null;
  progresso: ProgressoDoPortal;
  mes: Partial<Record<Entrega['situacao'], number>>;
  recentes: Entrega[];
}

interface Estado {
  emailDisponivel: boolean;
  simulavel: boolean;
  portais: Portal[];
}

const SITUACAO: Record<Entrega['situacao'], { rotulo: string; classe: string }> = {
  aplicado: { rotulo: 'Lead criado', classe: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  duplicado: { rotulo: 'Cliente repetido', classe: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300' },
  nao_entendido: { rotulo: 'Não entendido', classe: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  ignorado: { rotulo: 'Aviso', classe: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300' },
};

const input =
  'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm ' +
  'outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition';

/**
 * Leads dos portais em Canais.
 *
 * Cada portal ganha um endereço da loja — um e-mail de encaminhamento e uma
 * URL de webhook, com o mesmo token. O endereço aparece **uma vez** (o banco
 * guarda o hash); perdeu, gera outro. As entregas recentes ficam à vista, com
 * o que não foi entendido e o botão de reprocessar: é por aqui que o dono vê o
 * código de confirmação do encaminhamento do Gmail, que chega neste endereço.
 */
export default function Portais({ token, administra }: { token: string; administra: boolean }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setEstado(await api<Estado>('/portais', { token }));
    } catch (err) {
      setErro(err);
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="flex items-center gap-2.5 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
          <Globe size={14} className="text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="font-semibold txt-forte text-sm">Leads dos portais</h2>
        <button onClick={carregar} disabled={carregando} title="Atualizar"
                className="ml-auto p-1.5 rounded-lg txt-fraco hover:bg-slate-100 dark:hover:bg-slate-800 transition">
          <RefreshCw size={13} className={cn(carregando && 'animate-spin')} />
        </button>
      </div>

      <div className="p-6 space-y-4">
        <p className="text-sm txt-medio">
          Cada portal ganha um endereço da loja. Encaminhe para ele os e-mails de lead do portal — ou
          cadastre a URL, se o portal ou a sua integração mandarem webhook — e o lead entra sozinho, no
          rodízio, com o prazo de primeiro contato correndo.
        </p>

        {erro ? (
          <ErroAoCarregar erro={erro} onTentarNovamente={carregar} carregando={carregando} contexto="os portais" />
        ) : !estado ? (
          <Loader2 size={20} className="animate-spin text-slate-400" />
        ) : (
          <>
            {!estado.emailDisponivel && (
              <p className="text-xs rounded-xl px-3 py-2 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                O e-mail de entrada ainda não está ligado neste servidor: por enquanto, só a URL de webhook
                recebe leads.
              </p>
            )}
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {estado.portais.map((p) => (
                <LinhaDoPortal
                  key={p.chave}
                  portal={p}
                  token={token}
                  administra={administra}
                  simulavel={estado.simulavel}
                  emailDisponivel={estado.emailDisponivel}
                  onMudou={carregar}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function LinhaDoPortal({ portal, token, administra, simulavel, emailDisponivel, onMudou }: {
  portal: Portal;
  token: string;
  administra: boolean;
  simulavel: boolean;
  emailDisponivel: boolean;
  onMudou: () => void;
}) {
  const [endereco, setEndereco] = useState<{ token: string; email: string | null } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<'regenerar' | 'desconectar' | null>(null);
  const [aberto, setAberto] = useState(false);

  async function acao(caminho: string, metodo: 'POST' | 'DELETE', guardar: boolean) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api<{ token: string; email: string | null }>(caminho, { method: metodo, token });
      if (guardar) setEndereco(r);
      setConfirmar(null);
      onMudou();
    } catch (err) {
      setErro(textoDoErro(err));
    } finally {
      setOcupado(false);
    }
  }

  const { mes } = portal;
  const contagem = [
    mes.aplicado && `${mes.aplicado} lead${mes.aplicado > 1 ? 's' : ''}`,
    mes.duplicado && `${mes.duplicado} repetido${mes.duplicado > 1 ? 's' : ''}`,
    mes.nao_entendido && `${mes.nao_entendido} não entendido${mes.nao_entendido > 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="py-4 first:pt-0 last:pb-0 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-semibold txt-forte text-sm">{portal.nome}</p>
        {portal.conexao ? (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">
            Conectado{portal.conexao.ultimoRecebimento
              ? ` · última entrega ${new Date(portal.conexao.ultimoRecebimento).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
              : ' · nada recebido ainda'}
          </span>
        ) : (
          <span className="text-xs txt-fraco">Não conectado</span>
        )}
        {contagem && <span className="text-xs txt-fraco">Neste mês: {contagem}</span>}

        <div className="ml-auto flex items-center gap-3">
          {portal.recentes.length > 0 && (
            <button onClick={() => setAberto((v) => !v)} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
              {aberto ? 'Esconder entregas' : `Entregas (${portal.recentes.length})`}
            </button>
          )}
          {administra && !portal.conexao && (
            <button onClick={() => acao(`/portais/${portal.chave}/conectar`, 'POST', true)} disabled={ocupado}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition">
              {ocupado && <Loader2 size={12} className="animate-spin" />} Conectar
            </button>
          )}
          {administra && portal.conexao && !confirmar && (
            <>
              <button onClick={() => setConfirmar('regenerar')} className="text-xs txt-fraco hover:text-blue-600 transition">
                Novo endereço
              </button>
              <button onClick={() => setConfirmar('desconectar')} className="inline-flex items-center gap-1 text-xs txt-fraco hover:text-rose-600 transition">
                <Unplug size={12} /> Desconectar
              </button>
            </>
          )}
        </div>
      </div>

      {confirmar && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2 text-sm txt-medio">
          <p>
            {confirmar === 'regenerar'
              ? 'O endereço atual para de receber. O encaminhamento e a URL já configurados precisam ser trocados pelo novo.'
              : `A ${portal.nome} para de entregar leads aqui. As entregas que já chegaram ficam guardadas.`}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => confirmar === 'regenerar'
                ? acao(`/portais/${portal.chave}/regenerar`, 'POST', true)
                : acao(`/portais/${portal.chave}`, 'DELETE', false)}
              disabled={ocupado}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50">
              {confirmar === 'regenerar' ? 'Gerar endereço novo' : 'Desconectar'}
            </button>
            <button onClick={() => setConfirmar(null)} className="px-3 py-1.5 rounded-lg text-xs txt-medio hover:bg-slate-100 dark:hover:bg-slate-800">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {erro && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{erro}</p>}

      {endereco && <EnderecoNovo endereco={endereco} />}

      <PassoAPassoDoPortal
        chave={portal.chave}
        nome={portal.nome}
        conectado={!!portal.conexao}
        progresso={portal.progresso}
        endereco={endereco}
        emailDisponivel={emailDisponivel}
        administra={administra}
      />

      {aberto && <Entregas entregas={portal.recentes} token={token} podeReprocessar={administra} onMudou={onMudou} />}

      {simulavel && portal.conexao && <Simulador chave={portal.chave} token={token} onMudou={onMudou} />}
    </div>
  );
}

function Copiavel({ rotulo, valor }: { rotulo: string; valor: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
    } catch {
      // Silencioso com motivo: a área de transferência é negada em alguns
      // contextos, e o valor está na tela para copiar à mão.
    }
  }
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide txt-fraco mb-1">{rotulo}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 break-all text-xs rounded-lg px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          {valor}
        </code>
        <button onClick={copiar} className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
          <Copy size={12} /> {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}

function EnderecoNovo({ endereco }: { endereco: { token: string; email: string | null } }) {
  const url = `${API_URL.replace(/\/+$/, '')}/api/v1/webhooks/portais/${endereco.token}`;
  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5 p-4 space-y-3">
      <p className="text-sm font-semibold txt-forte">
        Guarde agora: por segurança, este endereço não aparece de novo. Se perder, gere outro.
      </p>
      {endereco.email && <Copiavel rotulo="E-mail de encaminhamento" valor={endereco.email} />}
      <Copiavel rotulo="URL de webhook (formato AutoConnect)" valor={url} />
      <p className="text-xs txt-fraco">O passo a passo logo abaixo mostra onde usar cada um.</p>
    </div>
  );
}

function Entregas({ entregas, token, podeReprocessar, onMudou }: {
  entregas: Entrega[];
  token: string;
  podeReprocessar: boolean;
  onMudou: () => void;
}) {
  const [reprocessando, setReprocessando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function reprocessar(id: string) {
    setReprocessando(id);
    setErro(null);
    try {
      await api(`/portais/entregas/${id}/reprocessar`, { method: 'POST', token });
      onMudou();
    } catch (err) {
      setErro(textoDoErro(err));
    } finally {
      setReprocessando(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
      {erro && <p role="alert" className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{erro}</p>}
      {entregas.map((e) => (
        <div key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
          <span className={cn('px-2 py-0.5 rounded-full font-semibold', SITUACAO[e.situacao].classe)}>
            {SITUACAO[e.situacao].rotulo}
          </span>
          <span className="txt-medio flex-1 min-w-[12rem] break-words">{e.resumo ?? '—'}</span>
          <span className="txt-fraco">
            {e.transporte === 'email' ? 'e-mail' : 'webhook'} ·{' '}
            {new Date(e.recebidaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
          {podeReprocessar && e.situacao === 'nao_entendido' && (
            <button onClick={() => reprocessar(e.id)} disabled={reprocessando === e.id}
                    className="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 disabled:opacity-50">
              {reprocessando === e.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Reprocessar
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Simulador({ chave, token, onMudou }: { chave: ChaveDoPortal; token: string; onMudou: () => void }) {
  const [via, setVia] = useState<'email' | 'webhook'>('email');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [anuncio, setAnuncio] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await api(`/portais/${chave}/simular`, {
        method: 'POST', token,
        body: { via, nome, telefone, ...(mensagem.trim() && { mensagem }), ...(anuncio.trim() && { anuncio }) },
      });
      setNome(''); setTelefone(''); setMensagem(''); setAnuncio('');
      onMudou();
    } catch (err) {
      setErro(textoDoErro(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="rounded-xl border border-dashed border-amber-300 dark:border-amber-500/40 p-3 space-y-2">
      <p className="text-xs font-semibold txt-forte flex items-center gap-1.5">
        <FlaskConical size={12} className="text-amber-600" /> Simular um lead deste portal
        <select value={via} onChange={(e) => setVia(e.target.value as 'email' | 'webhook')}
                className="ml-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5">
          <option value="email">por e-mail</option>
          <option value="webhook">por webhook</option>
        </select>
      </p>
      <div className="grid sm:grid-cols-2 gap-2">
        <input className={input} placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <input className={input} placeholder="(11) 97777-0000" inputMode="tel" value={telefone}
               onChange={(e) => setTelefone(mascararTelefoneBr(e.target.value))} required />
        <input className={input} placeholder="Mensagem (opcional)" value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
        <input className={input} placeholder="Anúncio (opcional)" value={anuncio} onChange={(e) => setAnuncio(e.target.value)} />
      </div>
      {erro && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{erro}</p>}
      <button type="submit" disabled={enviando}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition">
        {enviando && <Loader2 size={11} className="animate-spin" />} Entregar
      </button>
    </form>
  );
}
