'use client';

import { useState } from 'react';
import { Send, Loader2, XCircle, Download, MailCheck, MailX, Mail, FlaskConical } from 'lucide-react';
import {
  ROTULO_ASSINATURA_EXTERNA, assinaturaExternaViva, type SignatarioRegistrado,
} from '@autoconnect/shared';
import { useAuthStore } from '@/store/auth';
import { textoDoErro } from '@/components/ErroAoCarregar';
import {
  useEnviarParaAssinatura, useCancelarAssinatura, useSimularAssinatura, baixarPdfAssinado,
  type CapacidadeAssinatura, type Contrato,
} from '../dados';

const PAPEL: Record<SignatarioRegistrado['papel'], string> = { customer: 'Comprador', dealer: 'Loja' };

const COR_STATUS: Record<string, string> = {
  sent: 'text-sky-700 dark:text-sky-300',
  pending: 'text-sky-700 dark:text-sky-300',
  completed: 'text-emerald-700 dark:text-emerald-300',
  refused: 'text-rose-700 dark:text-rose-300',
  failed: 'text-rose-700 dark:text-rose-300',
  expired: 'text-amber-700 dark:text-amber-300',
  canceled: 'text-slate-500',
};

function IconeSignatario({ s }: { s: SignatarioRegistrado }) {
  if (s.status === 'assinou') return <MailCheck size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0" />;
  if (s.status === 'recusou') return <MailX size={12} className="text-rose-600 dark:text-rose-400 shrink-0" />;
  return <Mail size={12} className="text-slate-400 shrink-0" />;
}

/**
 * Assinatura eletrônica por provedor externo, dentro do cartão do contrato.
 *
 * Só aparece quando a API diz que há provedor — sem ele, o registro interno de
 * assinatura segue sendo o caminho, e oferecer um botão que termina em 503
 * seria pior que não oferecer. Com envio vivo, o registro interno some do
 * cartão (a API também o recusa): as duas formas não se misturam.
 */
export default function AssinaturaExterna({
  dealId, contrato, capacidade,
}: {
  dealId: string;
  contrato: Contrato;
  capacidade: CapacidadeAssinatura;
}) {
  const token = useAuthStore((s) => s.token);
  const enviar = useEnviarParaAssinatura(dealId);
  const cancelar = useCancelarAssinatura(dealId);
  const simular = useSimularAssinatura(dealId);
  const [baixando, setBaixando] = useState(false);
  const [erroDownload, setErroDownload] = useState<string | null>(null);

  const s = contrato.signatureRequests[0];
  const viva = s ? assinaturaExternaViva(s.status) : false;
  const assinadaPorFora = s?.status === 'completed';

  // Com assinatura interna já registrada, o envio externo não é oferecido: a
  // API o recusaria, porque as duas trilhas de evidência não se misturam.
  const podeEnviar = capacidade.disponivel && contrato.status === 'issued' &&
    !viva && contrato.signatures.length === 0;

  if (!s && !podeEnviar) return null;

  async function baixar() {
    if (!token) return;
    setBaixando(true);
    setErroDownload(null);
    try {
      await baixarPdfAssinado(contrato.id, token);
    } catch (e) {
      setErroDownload(textoDoErro(e));
    } finally {
      setBaixando(false);
    }
  }

  const erro = enviar.error ?? cancelar.error ?? simular.error;
  const botao =
    'text-sm px-3 py-1.5 rounded-lg font-medium border transition disabled:opacity-50 ' +
    'inline-flex items-center gap-1.5';

  return (
    <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 p-3 space-y-2">
      <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
        <Send size={11} /> Assinatura eletrônica
        {s && (
          <span className={`font-semibold ${COR_STATUS[s.status] ?? ''}`}>
            · {ROTULO_ASSINATURA_EXTERNA[s.status]}
          </span>
        )}
      </p>

      {s && s.status !== 'failed' && (
        <ul className="space-y-1">
          {s.signers.map((sg) => (
            <li key={sg.papel} className="text-xs flex items-center gap-1.5 min-w-0">
              <IconeSignatario s={sg} />
              <span className="shrink-0 text-slate-500">{PAPEL[sg.papel]}:</span>
              <span className="truncate">{sg.nome}</span>
              <span className="text-slate-400 truncate hidden sm:inline">{sg.email}</span>
              <span className="ml-auto shrink-0 text-slate-500">{sg.status}</span>
            </li>
          ))}
        </ul>
      )}

      {s?.status === 'failed' && s.errorMessage && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{s.errorMessage}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {podeEnviar && (
          <button
            onClick={() => enviar.mutate(contrato.id)}
            disabled={enviar.isPending}
            className={`${botao} border-sky-200 dark:border-sky-900 text-sky-700 dark:text-sky-300
                        hover:bg-sky-50 dark:hover:bg-sky-950/30`}
          >
            {enviar.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {s ? 'Reenviar para assinatura eletrônica' : 'Enviar para assinatura eletrônica'}
          </button>
        )}

        {viva && (
          <button
            onClick={() => cancelar.mutate(contrato.id)}
            disabled={cancelar.isPending}
            className={`${botao} border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300
                        hover:bg-slate-100 dark:hover:bg-slate-800`}
          >
            {cancelar.isPending ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
            Cancelar envio
          </button>
        )}

        {assinadaPorFora && (
          <button
            onClick={() => void baixar()}
            disabled={baixando}
            className={`${botao} border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300
                        hover:bg-emerald-50 dark:hover:bg-emerald-950/30`}
          >
            {baixando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Baixar PDF assinado
          </button>
        )}
      </div>

      {/* Só com o provedor simulado, fora de produção: faz o papel de quem
          assinaria no provedor, pelo mesmo webhook da entrega real. */}
      {capacidade.simulado && s?.status === 'sent' && (
        <div className="flex flex-wrap gap-1.5 items-center pt-1 border-t border-dashed border-slate-200 dark:border-slate-800">
          <span className="text-[11px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
            <FlaskConical size={11} /> simulação:
          </span>
          {s.signers.filter((sg) => sg.status === 'enviado').map((sg) => (
            <button
              key={sg.papel}
              onClick={() => simular.mutate({ contratoId: contrato.id, acao: 'assinar', papel: sg.papel })}
              disabled={simular.isPending}
              className="text-[11px] px-2 py-0.5 rounded border border-amber-200 dark:border-amber-900
                         text-amber-700 dark:text-amber-300 disabled:opacity-50"
            >
              {PAPEL[sg.papel]} assina
            </button>
          ))}
          <button
            onClick={() => simular.mutate({ contratoId: contrato.id, acao: 'recusar', papel: 'customer' })}
            disabled={simular.isPending}
            className="text-[11px] px-2 py-0.5 rounded border border-amber-200 dark:border-amber-900
                       text-amber-700 dark:text-amber-300 disabled:opacity-50"
          >
            Comprador recusa
          </button>
        </div>
      )}

      {(erro || erroDownload) && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{erroDownload ?? textoDoErro(erro)}</p>
      )}
    </div>
  );
}
