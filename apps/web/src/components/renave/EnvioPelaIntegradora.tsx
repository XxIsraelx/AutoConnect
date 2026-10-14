'use client';

import { useState } from 'react';
import { Loader2, Send, ShieldCheck } from 'lucide-react';
import {
  OPERACOES_DE_ENTRADA, OPERACOES_DE_SAIDA, ROTULO_DA_OPERACAO_RENAVE, TIPOS_DE_CRV,
  ehEntrada, formatarBRL, operacaoTemValor, type RenaveOperacaoValue,
} from '@autoconnect/shared';
import { erroDaAcao, useEnviarRenave, type RenaveDoVeiculo } from './dados';

const campo =
  'text-sm bg-transparent border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 min-w-0 w-full';
const botao =
  'text-sm px-3 py-1.5 rounded-lg font-medium transition disabled:opacity-50 inline-flex items-center gap-1.5';

const dataCurta = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';

/**
 * Envio ao RENAVE pela integradora configurada (R2 do plano fiscal).
 *
 * O documento do veículo é digitado aqui porque o AutoConnect não o tem. O
 * **código de segurança do CRV não é guardado** — vai à integradora e some —, e
 * por isso reenviar pede de novo. O valor não é campo: vem do custo do veículo
 * ou do negócio, como no registro manual.
 *
 * Sem `<form>`, pelo mesmo motivo do cartão: no veículo ele vive dentro do
 * formulário de edição do anúncio.
 */
export default function EnvioPelaIntegradora({
  dados, dealId, tipoInicial, onFechar,
}: {
  dados: RenaveDoVeiculo;
  dealId?: string;
  tipoInicial: RenaveOperacaoValue;
  onFechar: () => void;
}) {
  const enviar = useEnviarRenave();
  const { entrada, saidas } = dados.sugestao;

  const [tipo, setTipo] = useState<RenaveOperacaoValue>(tipoInicial);
  const [negocio, setNegocio] = useState(dealId ?? saidas[0]?.dealId ?? '');
  const [tipoCrv, setTipoCrv] = useState<string>('DIGITAL');
  const [numeroCrv, setNumeroCrv] = useState('');
  const [codigo, setCodigo] = useState('');
  const [km, setKm] = useState('');

  const saida = saidas.find((s) => s.dealId === negocio);
  const valor = tipo === 'saida_venda' ? saida?.valor : ehEntrada(tipo) ? entrada.valor : null;
  const faltaAquisicao = tipo === 'entrada_compra' && !entrada.temAquisicao;
  const faltaNegocio = tipo === 'saida_venda' && !saida;
  // Um dado, um lugar: RENAVAM e vendedor vêm dos cartões da nota fiscal.
  const faltaRenavam = !dados.sugestao.renavam;
  const faltaVendedor = tipo === 'entrada_compra' && !entrada.vendedor;
  const incompleto = !codigo.trim();

  const mandar = () => {
    enviar.mutate(
      {
        vehicleId: dados.vehicleId,
        tipo,
        ...(tipo === 'saida_venda' ? { dealId: negocio } : {}),
        crv: {
          tipoCrv,
          ...(numeroCrv.trim() ? { numeroCrv: numeroCrv.replace(/\D/g, '') } : {}),
          codigoSegurancaCrv: codigo.replace(/\D/g, ''),
        },
        ...(ehEntrada(tipo) && km.trim() ? { quilometragem: Number(km.replace(/\D/g, '')) } : {}),
      },
      // O código some do estado assim que sai daqui, com sucesso ou não: a
      // tela também não o guarda.
      { onSettled: () => setCodigo(''), onSuccess: onFechar },
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-brand-accent/40 p-3">
      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
        <Send size={12} /> Enviar pela integradora
        {dados.integradora.sandbox && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            homologação — sem valor legal
          </span>
        )}
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">Operação</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as RenaveOperacaoValue)} className={campo}>
            <optgroup label="Entrada">
              {OPERACOES_DE_ENTRADA.map((t) => <option key={t} value={t}>{ROTULO_DA_OPERACAO_RENAVE[t]}</option>)}
            </optgroup>
            <optgroup label="Saída">
              {OPERACOES_DE_SAIDA.map((t) => <option key={t} value={t}>{ROTULO_DA_OPERACAO_RENAVE[t]}</option>)}
            </optgroup>
          </select>
        </label>

        {tipo === 'saida_venda' && !dealId && saidas.length > 1 && (
          <label className="text-xs text-slate-500 space-y-1">
            <span className="block">Negócio</span>
            <select value={negocio} onChange={(e) => setNegocio(e.target.value)} className={campo}>
              {saidas.map((s) => (
                <option key={s.dealId} value={s.dealId}>{formatarBRL(s.valor)} · {dataCurta(s.dataOperacao)}</option>
              ))}
            </select>
          </label>
        )}

        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">Tipo do CRV</span>
          <select value={tipoCrv} onChange={(e) => setTipoCrv(e.target.value)} className={campo}>
            {TIPOS_DE_CRV.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
          </select>
        </label>

        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">Número do CRV (opcional)</span>
          <input value={numeroCrv} onChange={(e) => setNumeroCrv(e.target.value)} inputMode="numeric" className={campo} />
        </label>

        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">Código de segurança do CRV</span>
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} inputMode="numeric"
            autoComplete="off" className={`${campo} font-mono`} />
        </label>

        {ehEntrada(tipo) && (
          <>
            <label className="text-xs text-slate-500 space-y-1">
              <span className="block">Hodômetro (vazio = o do cadastro)</span>
              <input value={km} onChange={(e) => setKm(e.target.value)} inputMode="numeric" placeholder="km" className={campo} />
            </label>
          </>
        )}
      </div>

      <dl className="text-xs text-slate-500 space-y-0.5">
        <div>
          <dt className="inline">RENAVAM: </dt>
          <dd className="inline font-mono">{dados.sugestao.renavam ?? '—'}</dd>
          <span className="text-slate-400"> · do cartão “Dados fiscais”</span>
        </div>
        {ehEntrada(tipo) && (
          <div>
            <dt className="inline">Vendedor: </dt>
            <dd className="inline">{entrada.vendedor?.nome ?? '—'}</dd>
            <span className="text-slate-400"> · do cartão “Nota de entrada”</span>
          </div>
        )}
      </dl>
      {faltaRenavam && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Cadastre o RENAVAM no cartão “Dados fiscais”, nesta página: é de lá que o envio o lê.
        </p>
      )}
      {faltaVendedor && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Cadastre quem entregou o veículo (nome e CPF/CNPJ) no cartão “Nota de entrada”, nesta página.
        </p>
      )}

      <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
        <ShieldCheck size={12} className="shrink-0 mt-0.5" />
        O código de segurança vai para a integradora e não é guardado pelo AutoConnect. Se precisar reenviar, ele é pedido de novo.
      </p>
      {operacaoTemValor(tipo) && valor && (
        <p className="text-xs text-slate-500">
          Valor declarado: <strong>{formatarBRL(valor)}</strong> — vem{' '}
          {tipo === 'saida_venda' ? 'do negócio' : 'do custo do veículo'}.
        </p>
      )}
      {faltaAquisicao && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Registre a compra no custo do veículo primeiro: o valor de compra que vai ao RENAVE vem de lá.
        </p>
      )}
      {faltaNegocio && (
        <p className="text-xs text-amber-700 dark:text-amber-400">A saída por venda é enviada a partir de um negócio assinado.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button" onClick={mandar}
          disabled={enviar.isPending || incompleto || faltaAquisicao || faltaNegocio || faltaRenavam || faltaVendedor}
          className={`${botao} bg-brand-accent text-white hover:bg-blue-600`}
        >
          {enviar.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Enviar ao RENAVE
        </button>
        <button type="button" onClick={onFechar} className={`${botao} text-slate-500`}>Fechar</button>
      </div>
      {enviar.error && <p className="text-sm text-rose-600 dark:text-rose-400">{erroDaAcao(enviar.error)}</p>}
    </div>
  );
}
