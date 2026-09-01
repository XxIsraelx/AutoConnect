'use client';

/* Proposta comercial dentro do chat.
   Persistida em Message.metadata.proposal:
   { price, downPayment, installments, installmentValue, vehicleLabel?, status, respondedAt? } */

import { useState } from 'react';
import { BadgeDollarSign, Check, X, Loader2 } from 'lucide-react';

export interface ChatProposal {
  price: number;
  downPayment: number;
  installments: number;
  installmentValue: number;
  vehicleLabel?: string;
  status: 'pending' | 'accepted' | 'declined';
  respondedAt?: string;
}

export function getProposal(metadata: unknown): ChatProposal | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const p = (metadata as { proposal?: ChatProposal }).proposal;
  return p && typeof p.price === 'number' ? p : null;
}

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);

export default function ProposalBubble({
  proposal,
  mine,
  canRespond,
  onRespond,
}: {
  proposal: ChatProposal;
  mine: boolean;                       // enviada por mim (lado vendedor)
  canRespond: boolean;                 // sou o cliente e está pendente
  onRespond?: (accept: boolean) => Promise<void> | void;
}) {
  const [responding, setResponding] = useState<'accept' | 'decline' | null>(null);

  async function respond(accept: boolean) {
    if (!onRespond) return;
    setResponding(accept ? 'accept' : 'decline');
    try { await onRespond(accept); } finally { setResponding(null); }
  }

  const statusChip = {
    pending:  { label: 'Aguardando resposta', cls: 'bg-amber-500/15 text-amber-400' },
    accepted: { label: 'Proposta aceita ✓',   cls: 'bg-emerald-500/15 text-emerald-400' },
    declined: { label: 'Proposta recusada',   cls: 'bg-rose-500/15 text-rose-400' },
  }[proposal.status];

  return (
    <div className={`w-64 rounded-2xl overflow-hidden border shadow-lg
      ${mine ? 'border-blue-500/30 bg-blue-950/60' : 'borda sup-card'}`}>

      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
          <BadgeDollarSign size={14} className="text-amber-400" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold txt-forte leading-tight">Proposta comercial</p>
          {proposal.vehicleLabel && (
            <p className="text-[10px] txt-fraco truncate">{proposal.vehicleLabel}</p>
          )}
        </div>
      </div>

      {/* Valores */}
      <div className="px-3.5 pb-2.5 space-y-1">
        <div className="flex justify-between text-xs">
          <span className="txt-fraco">Valor</span>
          <span className="font-bold txt-forte">{brl(proposal.price)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="txt-fraco">Entrada</span>
          <span className="font-semibold txt-medio">{brl(proposal.downPayment)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="txt-fraco">Parcelas</span>
          <span className="font-semibold txt-medio">
            {proposal.installments}× de {brl(proposal.installmentValue)}
          </span>
        </div>
      </div>

      {/* Status / ações */}
      <div className="px-3.5 pb-3">
        {canRespond && proposal.status === 'pending' ? (
          <div className="flex gap-1.5">
            <button
              onClick={() => respond(true)}
              disabled={!!responding}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg
                         bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold
                         transition-colors disabled:opacity-50"
            >
              {responding === 'accept' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              Aceitar
            </button>
            <button
              onClick={() => respond(false)}
              disabled={!!responding}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg
                         sup-fraca hover:bg-rose-500/20 txt-medio hover:text-rose-300
                         text-[11px] font-bold transition-colors disabled:opacity-50"
            >
              {responding === 'decline' ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
              Recusar
            </button>
          </div>
        ) : (
          <span className={`inline-block text-[10px] font-bold px-2 py-1 rounded-full ${statusChip.cls}`}>
            {statusChip.label}
          </span>
        )}
      </div>
    </div>
  );
}
