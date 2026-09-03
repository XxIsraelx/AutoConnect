'use client';

import { useState } from 'react';
import { FileText, Download, PenLine, Ban, ShieldCheck, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import {
  useContratos, useEmitirContrato, useAssinarContrato, useAnularContrato,
  baixarPdf, type Contrato as ContratoTipo,
} from '../dados';

const ROTULO: Record<ContratoTipo['status'], string> = {
  draft: 'Rascunho', issued: 'Emitido', signed: 'Assinado', voided: 'Anulado',
};

const COR: Record<ContratoTipo['status'], string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  issued: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  signed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  voided: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
};

const PAPEL: Record<'customer' | 'dealer', string> = {
  customer: 'Comprador', dealer: 'Loja',
};

const ANULA = ['manager', 'tenant_admin', 'super_admin'];

const data = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

export default function Contrato({ dealId }: { dealId: string }) {
  const token = useAuthStore((s) => s.token);
  const papel = useAuthStore((s) => s.user?.role) ?? '';
  const nome = useAuthStore((s) => s.user?.fullName) ?? '';
  const podeAnular = ANULA.includes(papel);

  const { data: contratos, isLoading, error, refetch, isFetching } = useContratos(dealId);
  const emitir = useEmitirContrato(dealId);
  const assinar = useAssinarContrato(dealId);
  const anular = useAnularContrato(dealId);

  const [baixando, setBaixando] = useState<string | null>(null);
  const [erroDownload, setErroDownload] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [assinandoNome, setAssinandoNome] = useState('');

  async function baixar(id: string) {
    if (!token) return;
    setBaixando(id);
    setErroDownload(null);
    try {
      await baixarPdf(id, token);
    } catch (e) {
      setErroDownload(textoDoErro(e));
    } finally {
      setBaixando(null);
    }
  }

  const campo =
    'text-sm bg-transparent border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 md:col-span-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <FileText size={12} /> Contrato
        </p>
        <button
          onClick={() => emitir.mutate()}
          disabled={emitir.isPending}
          className="text-sm bg-brand-accent text-white px-3 py-1.5 rounded-lg font-medium
                     hover:bg-blue-600 transition disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {emitir.isPending && <Loader2 size={14} className="animate-spin" />}
          {contratos?.length ? 'Emitir novo' : 'Emitir contrato'}
        </button>
      </div>

      {emitir.error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-3">{textoDoErro(emitir.error)}</p>
      )}

      {error ? (
        <ErroAoCarregar
          erro={error}
          onTentarNovamente={() => void refetch()}
          carregando={isFetching}
          contexto="os contratos"
        />
      ) : isLoading ? (
        <div className="h-20 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
      ) : !contratos?.length ? (
        <p className="text-sm text-slate-500">
          Nenhum contrato emitido. A emissão congela os valores e a garantia deste negócio.
        </p>
      ) : (
        <ul className="space-y-3">
          {contratos.map((c) => {
            const assinado = new Set(c.signatures.map((s) => s.role));
            const podeAssinar = c.status === 'issued';

            return (
              <li key={c.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${COR[c.status]}`}>
                        {ROTULO[c.status]}
                      </span>
                      <span className="text-xs text-slate-500">
                        {c.template.name} v{c.template.version}
                      </span>
                      <span className="text-xs text-slate-400">{data(c.issuedAt)}</span>
                    </div>
                    {/* O hash identifica o documento. Doze caracteres bastam para
                        conferir com o que o cliente recebeu, sem poluir a tela. */}
                    <p className="text-[11px] text-slate-400 mt-1 font-mono flex items-center gap-1">
                      <ShieldCheck size={11} /> {c.contentHash.slice(0, 12)}…
                      {c.storageKey && <span className="font-sans">· arquivado</span>}
                    </p>
                    {c.voidReason && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
                        Anulado: {c.voidReason}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => void baixar(c.id)}
                    disabled={baixando === c.id}
                    className="shrink-0 text-sm inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                               border border-slate-200 dark:border-slate-800
                               hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
                  >
                    {baixando === c.id
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Download size={14} />}
                    PDF
                  </button>
                </div>

                {c.signatures.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {c.signatures.map((s) => (
                      <li key={s.id} className="text-xs text-slate-500 flex items-center gap-1.5">
                        <PenLine size={11} className="text-emerald-600 dark:text-emerald-400" />
                        {PAPEL[s.role]}: {s.signerName} · {data(s.signedAt)}
                      </li>
                    ))}
                  </ul>
                )}

                {podeAssinar && assinado.size < 2 && (
                  <div className="mt-3 flex flex-wrap gap-2 items-center">
                    <input
                      value={assinandoNome}
                      onChange={(e) => setAssinandoNome(e.target.value)}
                      placeholder="Nome de quem assina"
                      className={`${campo} flex-1 min-w-[10rem]`}
                    />
                    {(['dealer', 'customer'] as const)
                      .filter((r) => !assinado.has(r))
                      .map((r) => (
                        <button
                          key={r}
                          onClick={() =>
                            assinar.mutate(
                              { id: c.id, role: r, signerName: assinandoNome || nome },
                              { onSuccess: () => setAssinandoNome('') },
                            )
                          }
                          disabled={assinar.isPending}
                          className="text-sm px-3 py-1.5 rounded-lg font-medium border
                                     border-emerald-200 dark:border-emerald-900
                                     text-emerald-700 dark:text-emerald-400
                                     hover:bg-emerald-50 dark:hover:bg-emerald-950/30
                                     transition disabled:opacity-50"
                        >
                          Assinar como {PAPEL[r]}
                        </button>
                      ))}
                  </div>
                )}

                {podeAnular && c.status !== 'voided' && (
                  anulando === c.id ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Motivo da anulação (mínimo 5 caracteres)"
                        className={`${campo} flex-1 min-w-[12rem]`}
                      />
                      <button
                        onClick={() =>
                          anular.mutate(
                            { id: c.id, reason: motivo },
                            { onSuccess: () => { setAnulando(null); setMotivo(''); } },
                          )
                        }
                        disabled={anular.isPending || motivo.trim().length < 5}
                        className="text-sm px-3 py-1.5 rounded-lg font-medium bg-rose-600 text-white
                                   hover:bg-rose-700 transition disabled:opacity-50"
                      >
                        Confirmar anulação
                      </button>
                      <button
                        onClick={() => { setAnulando(null); setMotivo(''); }}
                        className="text-sm px-3 py-1.5 rounded-lg text-slate-500"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAnulando(c.id)}
                      className="mt-3 text-xs inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400"
                    >
                      <Ban size={11} /> Anular
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(assinar.error || anular.error || erroDownload) && (
        <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
          {erroDownload ?? textoDoErro(assinar.error ?? anular.error)}
        </p>
      )}
    </div>
  );
}
