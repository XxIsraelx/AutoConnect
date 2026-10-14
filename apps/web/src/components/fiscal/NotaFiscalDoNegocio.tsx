'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, Download, FileText, FlaskConical, Loader2, RefreshCw, Send, XCircle,
} from 'lucide-react';
import {
  formatarBRL, formatarChaveNfe, JUSTIFICATIVA_MAXIMA, JUSTIFICATIVA_MINIMA, ROTULO_DO_STATUS_DA_NOTA,
  type FaltaParaEmitir, type LugarDaFalta, type NotaMontada, type StatusDaNota,
} from '@autoconnect/shared';
import { api, baixarArquivo } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';

const PAPEIS_DO_FISCAL = ['manager', 'tenant_admin', 'super_admin'];

interface Previa {
  operacao: string;
  rotulo: string;
  nota: NotaMontada | null;
  faltas: FaltaParaEmitir[];
}

interface Emissor { disponivel: boolean; provedor: string | null; homologacao: boolean; simulado: boolean }

interface Nota {
  id: string;
  status: StatusDaNota;
  ambiente: string;
  serie: number | null;
  numero: number | null;
  chave: string | null;
  protocolo: string | null;
  motivo: string | null;
  cfop: string;
  valorTotal: string;
  autorizadaEm: string | null;
  canceladaEm: string | null;
  justificativaDoCancelamento: string | null;
  emitidaEm: string;
  cancelamento: { pode: true } | { pode: false; motivo: string };
}

const COR_DO_STATUS: Record<StatusDaNota, string> = {
  processando: 'text-amber-700 dark:text-amber-300',
  autorizada: 'text-emerald-700 dark:text-emerald-300',
  rejeitada: 'text-rose-700 dark:text-rose-300',
  denegada: 'text-rose-700 dark:text-rose-300',
  cancelada: 'text-slate-500',
};

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/** Onde cada falta se corrige — a lista manda a pessoa ao lugar, não só diz o quê. */
function ondeCorrigir(onde: LugarDaFalta, vehicleId: string): { texto: string; href?: string } {
  switch (onde) {
    case 'perfil_fiscal': return { texto: 'Perfil fiscal', href: '/configuracoes/fiscal' };
    case 'loja': return { texto: 'Configurações da loja', href: '/configuracoes' };
    case 'veiculo': return { texto: 'Dados fiscais do veículo', href: `/veiculos/${vehicleId}` };
    case 'contraparte': return { texto: 'Qualificação do comprador, acima' };
    case 'negocio': return { texto: 'Preço do negócio, acima' };
  }
}

const botao = 'inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 transition';
const botaoPrimario = `${botao} bg-blue-600 text-white hover:bg-blue-700`;
const botaoSecundario = `${botao} border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800`;

/**
 * A NF-e de saída do negócio — fases N1 (prévia) e N2 (emissão).
 *
 * Sem nota viva, mostra a prévia: o que falta, ou a nota pronta com o botão de
 * emitir. Com nota viva (processando ou autorizada), mostra a nota — e é só
 * ela que se mexe: o índice do banco garante uma por negócio.
 *
 * O comprador entra na chave da prévia: salvar a qualificação acima refaz o
 * negócio, e a prévia acompanha sem botão.
 */
export default function NotaFiscalDoNegocio({ dealId, vehicleId, comprador }: {
  dealId: string;
  vehicleId: string;
  comprador: unknown;
}) {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const papel = useAuthStore((s) => s.user?.role) ?? '';
  const pode = PAPEIS_DO_FISCAL.includes(papel);
  const qc = useQueryClient();
  const [presencial, setPresencial] = useState(true);
  const [cancelando, setCancelando] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [erroDeAcao, setErroDeAcao] = useState('');

  const emissor = useQuery({
    queryKey: ['fiscal-emissor'],
    queryFn: () => api<Emissor>('/fiscal/emissor', { token }),
    enabled: !!token && pode,
    staleTime: 5 * 60_000,
  });
  const notas = useQuery({
    queryKey: ['fiscal-notas', dealId],
    queryFn: () => api<Nota[]>(`/fiscal/negocios/${dealId}/notas`, { token }),
    enabled: !!token && pode,
  });
  const viva = notas.data?.find((n) => n.status === 'processando' || n.status === 'autorizada') ?? null;
  const anteriores = notas.data?.filter((n) => n.id !== viva?.id) ?? [];

  const previa = useQuery({
    queryKey: ['fiscal-previa', dealId, presencial, comprador],
    queryFn: () => api<Previa>(`/fiscal/negocios/${dealId}/previa?presencial=${presencial}`, { token }),
    enabled: !!token && pode && notas.isSuccess && !viva,
  });

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ['fiscal-notas', dealId] });
    void qc.invalidateQueries({ queryKey: ['fiscal-previa', dealId] });
  };
  const acao = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onMutate: () => setErroDeAcao(''),
    onSuccess: () => { setCancelando(false); setJustificativa(''); atualizar(); },
    onError: (e) => { setErroDeAcao(textoDoErro(e)); atualizar(); },
  });

  if (!pode) return null;

  const emitir = () => acao.mutate(() => api(`/fiscal/negocios/${dealId}/notas`, {
    token, method: 'POST', body: JSON.stringify({ presencial }),
  }));
  const consultar = (id: string) => acao.mutate(() => api(`/fiscal/notas/${id}/consultar`, { token, method: 'POST' }));
  const simular = (id: string, a: 'autorizar' | 'rejeitar' | 'denegar') =>
    acao.mutate(() => api(`/fiscal/notas/${id}/simular`, { token, method: 'POST', body: JSON.stringify({ acao: a }) }));
  const cancelar = (id: string) => acao.mutate(() => api(`/fiscal/notas/${id}/cancelar`, {
    token, method: 'POST', body: JSON.stringify({ justificativa }),
  }));
  const baixar = (n: Nota, tipo: 'xml' | 'danfe') =>
    acao.mutate(() => baixarArquivo(
      `/fiscal/notas/${n.id}/${tipo}`, `nfe-${n.chave ?? n.id}${tipo === 'xml' ? '.xml' : '-danfe.pdf'}`, token,
    ));

  const ocupado = acao.isPending;
  const p = previa.data;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 md:col-span-2 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <FileText size={12} /> Nota fiscal{p && !viva ? ` — ${p.rotulo.toLowerCase()}` : ''}
        </p>
        <div className="flex items-center gap-3">
          {emissor.data?.homologacao && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300">
              homologação — sem valor fiscal
            </span>
          )}
          {!viva && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={presencial} onChange={(e) => setPresencial(e.target.checked)} />
              Comprador retira na loja
            </label>
          )}
          <button type="button" onClick={atualizar} aria-label="Atualizar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <RefreshCw size={13} className={notas.isFetching || previa.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {notas.isError && <ErroAoCarregar erro={notas.error} onTentarNovamente={() => notas.refetch()} />}
      {previa.isError && <ErroAoCarregar erro={previa.error} onTentarNovamente={() => previa.refetch()} />}

      {/* ── A nota viva ─────────────────────────────────── */}
      {viva && (
        <div className="space-y-2">
          <p className={`text-sm font-medium flex items-center gap-1.5 ${COR_DO_STATUS[viva.status]}`}>
            {viva.status === 'processando'
              ? <Loader2 size={14} className="animate-spin" />
              : <CheckCircle2 size={14} />}
            {ROTULO_DO_STATUS_DA_NOTA[viva.status]}
            {viva.numero && <span className="text-slate-500 font-normal">· nº {viva.numero}, série {viva.serie}</span>}
          </p>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div><dt className="text-slate-400">CFOP</dt><dd className="font-mono text-slate-800 dark:text-slate-100">{viva.cfop}</dd></div>
            <div><dt className="text-slate-400">Valor</dt><dd className="text-slate-800 dark:text-slate-100">{formatarBRL(viva.valorTotal)}</dd></div>
            <div><dt className="text-slate-400">Emitida em</dt><dd className="text-slate-800 dark:text-slate-100">{quando(viva.emitidaEm)}</dd></div>
            <div><dt className="text-slate-400">Autorizada em</dt><dd className="text-slate-800 dark:text-slate-100">{quando(viva.autorizadaEm)}</dd></div>
          </dl>
          {viva.chave && (
            <p className="text-xs text-slate-500 break-all">
              Chave <span className="font-mono text-slate-700 dark:text-slate-200">{formatarChaveNfe(viva.chave)}</span>
              {viva.protocolo && <> · protocolo <span className="font-mono">{viva.protocolo}</span></>}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {viva.status === 'processando' && (
              <button type="button" disabled={ocupado} onClick={() => consultar(viva.id)} className={botaoSecundario}>
                <RefreshCw size={13} /> Consultar a SEFAZ
              </button>
            )}
            {viva.status === 'autorizada' && (
              <>
                <button type="button" disabled={ocupado} onClick={() => baixar(viva, 'danfe')} className={botaoSecundario}>
                  <Download size={13} /> DANFE
                </button>
                <button type="button" disabled={ocupado} onClick={() => baixar(viva, 'xml')} className={botaoSecundario}>
                  <Download size={13} /> XML
                </button>
                {viva.cancelamento.pode && !cancelando && (
                  <button type="button" onClick={() => setCancelando(true)} className={`${botaoSecundario} text-rose-700 dark:text-rose-300`}>
                    <XCircle size={13} /> Cancelar nota
                  </button>
                )}
              </>
            )}
          </div>
          {viva.status === 'autorizada' && !viva.cancelamento.pode && (
            <p className="text-xs text-slate-500">{viva.cancelamento.motivo}</p>
          )}
          {viva.motivo && <p className="text-xs text-rose-600 dark:text-rose-400">{viva.motivo}</p>}

          {cancelando && (
            <div className="rounded-lg border border-rose-200 dark:border-rose-900 p-3 space-y-2">
              <label className="block text-xs text-slate-600 dark:text-slate-300">
                Justificativa para a SEFAZ ({JUSTIFICATIVA_MINIMA} a {JUSTIFICATIVA_MAXIMA} caracteres)
                <textarea
                  rows={2} maxLength={JUSTIFICATIVA_MAXIMA} value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCancelando(false)} className={botaoSecundario}>Voltar</button>
                <button
                  type="button" disabled={ocupado || justificativa.trim().length < JUSTIFICATIVA_MINIMA}
                  onClick={() => cancelar(viva.id)}
                  className={`${botao} bg-rose-600 text-white hover:bg-rose-700`}
                >
                  {ocupado ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />} Confirmar cancelamento
                </button>
              </div>
            </div>
          )}

          {viva.status === 'processando' && emissor.data?.simulado && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
              <span className="text-xs text-slate-500 flex items-center gap-1"><FlaskConical size={12} /> Emissor simulado — responder como a SEFAZ:</span>
              <button type="button" disabled={ocupado} onClick={() => simular(viva.id, 'autorizar')} className={botaoSecundario}>Autorizar</button>
              <button type="button" disabled={ocupado} onClick={() => simular(viva.id, 'rejeitar')} className={botaoSecundario}>Rejeitar</button>
              <button type="button" disabled={ocupado} onClick={() => simular(viva.id, 'denegar')} className={botaoSecundario}>Denegar</button>
            </div>
          )}
        </div>
      )}

      {/* ── Sem nota viva: a prévia ──────────────────────── */}
      {!viva && p && p.faltas.length > 0 && (
        <>
          <p className="text-sm text-slate-700 dark:text-slate-200">Para a nota sair, falta:</p>
          <ul className="space-y-1.5">
            {p.faltas.map((f) => {
              const onde = ondeCorrigir(f.onde, vehicleId);
              return (
                <li key={f.campo} className="text-sm text-slate-600 dark:text-slate-300 flex flex-wrap gap-x-2">
                  <span>• {f.mensagem}</span>
                  {onde.href
                    ? <Link href={onde.href} className="text-xs text-brand-accent self-center">{onde.texto} →</Link>
                    : <span className="text-xs text-slate-400 self-center">{onde.texto}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!viva && p?.nota && (
        <div className="space-y-2">
          <p className="text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 size={14} /> Os dados da nota estão completos.
          </p>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div><dt className="text-slate-400">CFOP</dt><dd className="font-mono text-slate-800 dark:text-slate-100">{p.nota.cfop}</dd></div>
            <div><dt className="text-slate-400">Situação tributária</dt><dd className="font-mono text-slate-800 dark:text-slate-100">{p.nota.situacaoTributaria}</dd></div>
            <div><dt className="text-slate-400">Valor</dt><dd className="text-slate-800 dark:text-slate-100">{formatarBRL(p.nota.valorTotal)}</dd></div>
            <div><dt className="text-slate-400">Ambiente</dt><dd className="text-slate-800 dark:text-slate-100">{p.nota.ambiente === 'producao' ? 'Produção' : 'Homologação'}</dd></div>
          </dl>
          <p className="text-xs text-slate-500">{p.nota.item.descricao}</p>
          {emissor.data?.disponivel ? (
            <button type="button" disabled={ocupado} onClick={emitir} className={botaoPrimario}>
              {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Emitir nota
            </button>
          ) : (
            <p className="text-xs text-slate-500">
              A emissão pelo AutoConnect não está ligada nesta instalação — use estes dados no
              emissor da loja.
            </p>
          )}
        </div>
      )}

      {erroDeAcao && <p className="text-xs text-rose-600 dark:text-rose-400">{erroDeAcao}</p>}

      {/* ── Histórico ────────────────────────────────────── */}
      {anteriores.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-800 pt-2">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Notas anteriores</p>
          <ul className="space-y-1">
            {anteriores.map((n) => (
              <li key={n.id} className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2">
                <span className={COR_DO_STATUS[n.status]}>{ROTULO_DO_STATUS_DA_NOTA[n.status]}</span>
                <span>{quando(n.emitidaEm)}</span>
                {n.numero && <span>nº {n.numero}</span>}
                {(n.justificativaDoCancelamento ?? n.motivo) && <span>— {n.justificativaDoCancelamento ?? n.motivo}</span>}
                {n.status === 'cancelada' && (
                  <button type="button" onClick={() => baixar(n, 'xml')} className="text-brand-accent">XML</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
