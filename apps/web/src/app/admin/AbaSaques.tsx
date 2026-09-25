'use client';

import { useState } from 'react';
import { Ban, Check, KeyRound, Loader2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import {
  MODOS_DE_VALOR, ROTULO_MODO_DE_VALOR, ROTULO_TIPO_DE_SAQUE, TIPOS_DE_SAQUE,
  VALIDADE_MAXIMA_DA_AUTORIZACAO_MIN, VALIDADE_PADRAO_DA_AUTORIZACAO_MIN,
  deCentavos, formatarBRL, type ModoDeValor, type TipoDeSaque,
} from '@autoconnect/shared';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import { cn } from '@/lib/utils';
import {
  Carregando, Secao, Vazio, botaoPrimarioCls, cartaoCls, fmtDateTime, inputCls,
  mensagemDaAcao, useCarga, type PropsDaAba,
} from './comum';
import type { AutorizacaoDeSaqueRow, PainelDeSaques } from './tipos';

/**
 * Validação de saque na conta da plataforma na Asaas.
 *
 * A Asaas pergunta, a cada saque solicitado na conta, se pode. A resposta
 * padrão é **não**: só passa o que casar com uma autorização criada aqui,
 * antes, com tipo, valor e prazo curto — e cada autorização vale uma vez.
 *
 * Esta tela é, portanto, parte do caminho de sacar dinheiro: quem vai
 * transferir abre aqui, autoriza, e só então pede o saque no painel da Asaas.
 */

const SITUACAO: Record<string, { rotulo: string; cor: string }> = {
  valida: { rotulo: 'válida', cor: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  usada: { rotulo: 'usada', cor: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  revogada: { rotulo: 'revogada', cor: 'bg-slate-100 dark:bg-slate-800 text-slate-500' },
  expirada: { rotulo: 'expirada', cor: 'bg-slate-100 dark:bg-slate-800 text-slate-500' },
};

/**
 * Os dois baldes que a API usa para o que não é operação reconhecida. Aparecem
 * na trilha e precisam de nome em português, senão a linha mais importante de
 * todas — a tentativa sem token — fica escrita em constante de código.
 */
const ROTULO_DO_BALDE: Record<string, string> = {
  NAO_AUTENTICADO: 'origem desconhecida',
  INVALIDO: 'corpo não reconhecido',
};

function rotuloDoTipo(tipo: string): string {
  return ROTULO_TIPO_DE_SAQUE[tipo as TipoDeSaque] ?? ROTULO_DO_BALDE[tipo] ?? tipo;
}

/**
 * Máscara de dinheiro por centavos: só dígitos entram, e o que sai para a API
 * é string decimal. Em nenhum momento o valor passa por ponto flutuante —
 * é a mesma regra do resto do sistema, e aqui ela decide um saque.
 */
function centavosDigitados(texto: string): bigint {
  const digitos = texto.replace(/\D/g, '').slice(0, 12);
  return digitos ? BigInt(digitos) : 0n;
}

export function AbaSaques({ chamar, avisar, sinal }: PropsDaAba) {
  const { dados, erro, carregando, recarregar } =
    useCarga(() => chamar<PainelDeSaques>('/admin/saques'), sinal);

  const [tipo, setTipo] = useState<TipoDeSaque>('TRANSFER');
  const [modo, setModo] = useState<ModoDeValor>('exato');
  const [valor, setValor] = useState('');
  const [validade, setValidade] = useState(String(VALIDADE_PADRAO_DA_AUTORIZACAO_MIN));
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [revogando, setRevogando] = useState<string | null>(null);

  const centavos = centavosDigitados(valor);
  const minutos = Number(validade);
  const podeSalvar =
    centavos > 0n && Number.isInteger(minutos) &&
    minutos >= 1 && minutos <= VALIDADE_MAXIMA_DA_AUTORIZACAO_MIN;

  async function autorizar() {
    if (!podeSalvar) return;
    setSalvando(true);
    try {
      await chamar('/admin/saques/autorizacoes', {
        method: 'POST',
        body: {
          tipo, modo,
          valor: deCentavos(centavos),
          validadeMinutos: minutos,
          ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
        },
      });
      setValor(''); setObservacao('');
      avisar('Autorização criada. Peça o saque na Asaas antes de ela expirar.');
      await recarregar();
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao criar a autorização'), 'error');
    } finally {
      setSalvando(false);
    }
  }

  async function revogar(a: AutorizacaoDeSaqueRow) {
    setRevogando(a.id);
    try {
      await chamar(`/admin/saques/autorizacoes/${a.id}/revogar`, { method: 'POST' });
      avisar('Autorização revogada');
      await recarregar();
    } catch (e) {
      avisar(mensagemDaAcao(e, 'Erro ao revogar'), 'error');
    } finally {
      setRevogando(null);
    }
  }

  if (erro) {
    return (
      <div className={cartaoCls}>
        <ErroAoCarregar
          erro={erro} onTentarNovamente={recarregar} carregando={carregando}
          contexto="as autorizações de saque"
        />
      </div>
    );
  }
  if (!dados) return <Carregando />;

  return (
    <div className="space-y-7">
      {/* Estado do mecanismo. Sem token, tudo é recusado — inclusive o saque
          legítimo do dono, que fica sabendo por aqui e não por uma operação
          cancelada no painel da Asaas. */}
      <div
        className={cn(
          'flex items-start gap-3 p-4 rounded-2xl border text-sm',
          dados.configurado
            ? 'bg-emerald-50/60 dark:bg-emerald-500/5 border-emerald-300 dark:border-emerald-500/40'
            : 'bg-rose-50/60 dark:bg-rose-500/5 border-rose-300 dark:border-rose-500/40',
        )}
      >
        {dados.configurado
          ? <ShieldCheck size={17} className="shrink-0 mt-0.5 text-emerald-600" />
          : <ShieldAlert size={17} className="shrink-0 mt-0.5 text-rose-600" />}
        <div className="min-w-0">
          <p className="font-semibold">
            {dados.configurado
              ? 'Validação de saque ativa'
              : 'Sem token configurado — todo saque está sendo recusado'}
          </p>
          <p className="text-slate-600 dark:text-slate-400 mt-0.5">
            {dados.configurado
              ? 'Todo saque pedido na conta da Asaas passa por aqui. Sem autorização prévia, é recusado.'
              : 'Defina ASAAS_SAQUE_TOKEN na API com o mesmo token cadastrado em Asaas › Integrações › Mecanismos de segurança. Até lá, nenhuma operação de saque é aprovada.'}
          </p>
        </div>
      </div>

      {/* ── Autorizar ─────────────────────────────────────────── */}
      <Secao titulo="Autorizar um saque">
        <div className={`${cartaoCls} p-4 sm:p-5 space-y-4`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="saque-tipo" className="block text-xs font-medium text-slate-500 mb-1.5">
                Tipo de operação
              </label>
              <select
                id="saque-tipo" value={tipo} className={inputCls}
                onChange={(e) => setTipo(e.target.value as TipoDeSaque)}
              >
                {TIPOS_DE_SAQUE.map((t) => (
                  <option key={t} value={t}>{ROTULO_TIPO_DE_SAQUE[t]}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="saque-modo" className="block text-xs font-medium text-slate-500 mb-1.5">
                Comparação do valor
              </label>
              <select
                id="saque-modo" value={modo} className={inputCls}
                onChange={(e) => setModo(e.target.value as ModoDeValor)}
              >
                {MODOS_DE_VALOR.map((m) => (
                  <option key={m} value={m}>{ROTULO_MODO_DE_VALOR[m]}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="saque-valor" className="block text-xs font-medium text-slate-500 mb-1.5">
                Valor
              </label>
              <input
                id="saque-valor" type="text" inputMode="numeric" placeholder="R$ 0,00"
                value={centavos > 0n ? formatarBRL(deCentavos(centavos)) : ''}
                onChange={(e) => setValor(e.target.value)}
                className={`${inputCls} tabular-nums`}
              />
            </div>

            <div>
              <label htmlFor="saque-validade" className="block text-xs font-medium text-slate-500 mb-1.5">
                Válida por (minutos)
              </label>
              <input
                id="saque-validade" type="number" min={1} max={VALIDADE_MAXIMA_DA_AUTORIZACAO_MIN}
                value={validade} onChange={(e) => setValidade(e.target.value)}
                className={`${inputCls} tabular-nums`}
              />
            </div>
          </div>

          <div>
            <label htmlFor="saque-obs" className="block text-xs font-medium text-slate-500 mb-1.5">
              Para que é este saque (opcional, vira trilha)
            </label>
            <input
              id="saque-obs" type="text" maxLength={300} value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Retirada mensal para a conta do Itaú"
              className={inputCls}
            />
          </div>

          <button onClick={autorizar} disabled={salvando || !podeSalvar} className={`${botaoPrimarioCls} w-full`}>
            {salvando ? <Loader2 size={14} className="animate-spin shrink-0" /> : <KeyRound size={14} className="shrink-0" />}
            Autorizar uma operação
          </button>

          <p className="text-[11px] text-slate-400">
            Vale <strong>uma vez só</strong> e expira no prazo acima. Crie a autorização e, em
            seguida, peça o saque no painel da Asaas — ela chama esta aplicação cerca de 5 segundos
            depois do pedido.
          </p>
        </div>
      </Secao>

      {/* ── Autorizações ──────────────────────────────────────── */}
      <Secao titulo="Autorizações">
        {dados.autorizacoes.length === 0 ? (
          <Vazio>Nenhuma autorização criada</Vazio>
        ) : (
          <div className="space-y-2">
            {dados.autorizacoes.map((a) => {
              const s = SITUACAO[a.situacao] ?? { rotulo: a.situacao, cor: 'bg-slate-100 text-slate-500' };
              return (
                <div key={a.id} className={`${cartaoCls} p-4 flex items-start gap-3`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm tabular-nums">{formatarBRL(a.valor)}</span>
                      <span className="text-xs text-slate-500">
                        {rotuloDoTipo(a.tipo)}
                        {' · '}
                        {ROTULO_MODO_DE_VALOR[a.modo as ModoDeValor] ?? a.modo}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cor}`}>
                        {s.rotulo}
                      </span>
                    </div>
                    {a.observacao && <p className="text-xs text-slate-500 mt-1 break-words">{a.observacao}</p>}
                    <p className="text-[11px] text-slate-400 mt-1">
                      {a.usadaEm
                        ? `Usada em ${fmtDateTime(a.usadaEm)}`
                        : a.revogadaEm
                          ? `Revogada em ${fmtDateTime(a.revogadaEm)}`
                          : `Expira ${fmtDateTime(a.expiraEm)}`}
                      {a.criadaPor ? ` · por ${a.criadaPor}` : ''}
                    </p>
                  </div>
                  {a.situacao === 'valida' && (
                    <button
                      onClick={() => revogar(a)} disabled={revogando === a.id}
                      title="Revogar" aria-label="Revogar autorização"
                      className="shrink-0 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-400 hover:text-rose-500 disabled:opacity-50"
                    >
                      {revogando === a.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Secao>

      {/* ── Trilha ────────────────────────────────────────────── */}
      <Secao titulo="Decisões enviadas à Asaas">
        {dados.decisoes.length === 0 ? (
          <Vazio>Nenhum pedido de validação recebido ainda</Vazio>
        ) : (
          <div className="space-y-2">
            {dados.decisoes.map((d) => {
              const aprovada = d.decisao === 'APPROVED';
              return (
                <div key={d.id} className={`${cartaoCls} p-4 flex items-start gap-3`}>
                  <span
                    className={cn(
                      'shrink-0 w-7 h-7 rounded-lg flex items-center justify-center',
                      aprovada
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600'
                        : 'bg-rose-50 dark:bg-rose-500/10 text-rose-600',
                    )}
                  >
                    {aprovada ? <Check size={14} /> : <Ban size={14} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{d.decisao}</span>
                      {d.valor && <span className="text-sm tabular-nums">{formatarBRL(d.valor)}</span>}
                      <span className="text-xs text-slate-500">{rotuloDoTipo(d.tipo)}</span>
                      {!d.tokenOk && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-500/10 text-rose-600">
                          sem token válido
                        </span>
                      )}
                    </div>
                    {d.motivo && <p className="text-xs text-slate-500 mt-1 break-words">{d.motivo}</p>}
                    <p className="text-[11px] text-slate-400 mt-1 break-all">
                      {fmtDateTime(d.quando)} · {d.operacao}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Secao>
    </div>
  );
}
