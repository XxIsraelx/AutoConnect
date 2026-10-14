'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, AlertTriangle, Info, Loader2, Plus, Send } from 'lucide-react';
import {
  OPERACOES_DE_ENTRADA, OPERACOES_DE_SAIDA, ROTULO_DA_OPERACAO_RENAVE, ROTULO_DO_STATUS_RENAVE,
  ehEntrada, formatarBRL, formatarChaveNfe, normalizarChaveNfe, operacaoTemValor,
  type PendenciaRenave, type RenaveOperacaoValue, type RenaveStatusValue, type SituacaoNoRenave,
} from '@autoconnect/shared';
import { useAuthStore } from '@/store/auth';
import { baixarArquivo } from '@/lib/api';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import {
  notaSugerida, rotuloDaNota, type NotaAutorizada, type NotasAutorizadas,
  PAPEIS_FISCAIS, erroDaAcao, useAcaoRenave, useRegistrarRenave, useRenaveDoVeiculo,
  type AcaoNoRegistro, type RegistroRenave, type RenaveDoVeiculo,
} from './dados';
import EnvioPelaIntegradora from './EnvioPelaIntegradora';

const ROTULO_DA_SITUACAO: Record<SituacaoNoRenave, string> = {
  sem_registro: 'Sem registro',
  em_estoque: 'No estoque do RENAVE',
  fora_do_estoque: 'Fora do estoque do RENAVE',
};

const COR_DO_STATUS: Record<RenaveStatusValue, string> = {
  pendente: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  confirmado: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  recusado: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  cancelado: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

const campo =
  'text-sm bg-transparent border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 min-w-0';
const botao =
  'text-sm px-3 py-1.5 rounded-lg font-medium transition disabled:opacity-50 inline-flex items-center gap-1.5';

const dataCurta = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';

/** `AAAA-MM-DD` para o `<input type="date">`. */
const paraInput = (d: string | null | undefined) => (d ? d.slice(0, 10) : '');

/**
 * Cartão RENAVE do veículo e do negócio (R1 do plano fiscal).
 *
 * O AutoConnect não transmite ao RENAVE: a loja registra pela integradora dela
 * e anota aqui o protocolo. O cartão mostra o que falta, guarda o que foi
 * feito, e **não bloqueia nada** — travar a vitrine ou o negócio por um dado
 * que talvez esteja certo na integradora seria punir a loja pela nossa
 * ignorância.
 *
 * Não usa `<form>`: no veículo ele mora dentro do formulário de edição, e um
 * `<form>` aninhado ou um botão `submit` aqui salvaria o anúncio.
 */
export default function CartaoRenave({
  vehicleId, dealId,
}: {
  vehicleId: string;
  /** No negócio: a saída por venda já vem apontada para ele. */
  dealId?: string;
}) {
  const papel = useAuthStore((s) => s.user?.role) ?? '';
  const podeRegistrar = PAPEIS_FISCAIS.includes(papel);
  const { data, isLoading, error, refetch, isFetching } = useRenaveDoVeiculo(vehicleId);

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <ClipboardCheck size={12} /> RENAVE
        </p>
        {data && (
          <span className="text-xs text-slate-500">{ROTULO_DA_SITUACAO[data.situacao]}</span>
        )}
      </div>

      {error ? (
        <ErroAoCarregar
          erro={error}
          onTentarNovamente={() => void refetch()}
          carregando={isFetching}
          contexto="o RENAVE deste veículo"
        />
      ) : isLoading || !data ? (
        <div className="h-16 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
      ) : (
        <div className="space-y-4">
          <Pendencias pendencias={data.pendencias} />
          <Registros
            registros={data.registros} podeRegistrar={podeRegistrar} simulado={data.integradora.simulado}
            notas={data.sugestao.notasAutorizadas}
          />
          {podeRegistrar && <Formularios dados={data} dealId={dealId} />}
          <p className="text-[11px] text-slate-400">
            O AutoConnect guarda os protocolos e avisa o que falta; o envio é pela sua integradora.
          </p>
        </div>
      )}
    </section>
  );
}

function Pendencias({ pendencias }: { pendencias: PendenciaRenave[] }) {
  if (pendencias.length === 0) {
    return <p className="text-sm text-emerald-700 dark:text-emerald-400">Nada pendente no RENAVE.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {pendencias.map((p, i) => (
        <li
          key={`${p.codigo}-${p.registroId ?? p.dealId ?? i}`}
          className={`flex gap-2 text-sm ${
            p.gravidade === 'obrigatoria'
              ? 'text-amber-700 dark:text-amber-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {p.gravidade === 'obrigatoria'
            ? <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            : <Info size={14} className="shrink-0 mt-0.5" />}
          <span>
            {p.mensagem}
            {p.desde && <span className="text-xs text-slate-400"> · desde {dataCurta(p.desde)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Com integradora configurada, enviar por ela é o caminho principal; anotar o
 * que foi feito fora continua possível — a loja pode ter registrado antes, ou
 * por outra integradora.
 */
function Formularios({ dados, dealId }: { dados: RenaveDoVeiculo; dealId?: string }) {
  const [aberto, setAberto] = useState<'envio' | 'manual' | null>(null);
  const { entrada, saidas } = dados.sugestao;
  const tipoInicial: RenaveOperacaoValue =
    dealId ? 'saida_venda'
    : dados.situacao === 'em_estoque' ? (saidas.length ? 'saida_venda' : 'saida_transferencia')
    : entrada.tipo;
  const fechar = () => setAberto(null);

  if (aberto === 'envio') {
    return <EnvioPelaIntegradora dados={dados} dealId={dealId} tipoInicial={tipoInicial} onFechar={fechar} />;
  }
  if (aberto === 'manual') {
    return <NovoRegistro dados={dados} dealId={dealId} tipoInicial={tipoInicial} onFechar={fechar} />;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {dados.integradora.disponivel && (dados.integradora.credencialCadastrada || !dados.integradora.exigeCredencialDaLoja) && (
        <button
          type="button" onClick={() => setAberto('envio')}
          className={`${botao} bg-brand-accent text-white hover:bg-blue-600`}
        >
          <Send size={14} /> Enviar pela integradora
        </button>
      )}
      {dados.integradora.disponivel && dados.integradora.exigeCredencialDaLoja && !dados.integradora.credencialCadastrada && (
        <p className="text-xs text-slate-500 basis-full">
          Para enviar pela integradora, o administrador da loja cadastra a chave dela em{' '}
          <Link href="/configuracoes" className="text-brand-accent hover:underline">Configurações</Link>.
        </p>
      )}
      <button
        type="button" onClick={() => setAberto('manual')}
        className={`${botao} bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700`}
      >
        <Plus size={14} /> {dados.integradora.disponivel ? 'Anotar registro feito fora' : 'Anotar registro do RENAVE'}
      </button>
    </div>
  );
}

/**
 * De onde veio a chave que está no campo. Igual à da nota autorizada: diz qual
 * nota. Diferente: avisa e segue — a loja pode ter enviado outra ao RENAVE, e
 * quem marca a divergência é a conferência da Fase C, não este formulário.
 */
function SugestaoDaNota({ sugerida, digitada }: { sugerida: NotaAutorizada | null; digitada: string }) {
  if (!sugerida || !digitada.trim()) return null;
  if (normalizarChaveNfe(digitada) === sugerida.chave) {
    return <p className="text-[11px] text-slate-400">Da nota autorizada {rotuloDaNota(sugerida)}.</p>;
  }
  return (
    <p className="text-[11px] text-amber-700 dark:text-amber-400">
      Diferente da nota autorizada {rotuloDaNota(sugerida)}. Se for a certa, salve; a conferência aponta a divergência.
    </p>
  );
}

function Registros({
  registros, podeRegistrar, simulado, notas,
}: { registros: RegistroRenave[]; podeRegistrar: boolean; simulado: boolean; notas: NotasAutorizadas }) {
  if (registros.length === 0) return null;
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800 border-y border-slate-100 dark:border-slate-800">
      {registros.map((r) => (
        <LinhaDoRegistro
          key={r.id} r={r} podeRegistrar={podeRegistrar} simulado={simulado}
          sugerida={notaSugerida(notas, r.tipo, r.dealId)}
        />
      ))}
    </ul>
  );
}

function LinhaDoRegistro({
  r, podeRegistrar, simulado, sugerida,
}: { r: RegistroRenave; podeRegistrar: boolean; simulado: boolean; sugerida: NotaAutorizada | null }) {
  const acao = useAcaoRenave();
  const token = useAuthStore((s) => s.token) ?? undefined;
  const [erroAtpv, setErroAtpv] = useState<unknown>(null);
  const daIntegradora = r.provider !== null;
  const [aberta, setAberta] = useState<'confirmar' | 'recusar' | 'cancelar' | 'nfe' | null>(null);
  const [texto, setTexto] = useState('');
  const [extra, setExtra] = useState('');

  // Ações de um clique: sem campo para preencher.
  const direto = (a: AcaoNoRegistro) => {
    setAberta(null);
    acao.mutate({ id: r.id, ...a });
  };
  const baixarAtpv = () => {
    setErroAtpv(null);
    baixarArquivo(`/renave/registros/${r.id}/atpv`, `atpv-e-${r.id.slice(0, 8)}.pdf`, token)
      .catch(setErroAtpv);
  };

  type AcaoComCampo = 'confirmar' | 'recusar' | 'cancelar' | 'nfe';
  const abrir = (a: AcaoComCampo) => {
    setAberta((atual) => (atual === a ? null : a));
    // A chave já anotada vence; sem ela, a da nota autorizada vem sugerida.
    setTexto(a === 'nfe' ? (r.chaveNfe ?? sugerida?.chave ?? '') : '');
    setExtra('');
    acao.reset();
  };

  const enviar = () => {
    if (!aberta) return;
    const corpo: AcaoNoRegistro =
      aberta === 'confirmar' ? { acao: 'confirmar', protocolo: texto, registradoEm: extra || undefined }
      : aberta === 'recusar' ? { acao: 'recusar', motivo: texto }
      : aberta === 'cancelar' ? { acao: 'cancelar', motivo: texto, protocoloCancelamento: extra || undefined }
      : { acao: 'nfe', chaveNfe: texto };
    acao.mutate({ id: r.id, ...corpo }, { onSuccess: () => setAberta(null) });
  };

  const vivo = r.status === 'pendente' || r.status === 'confirmado';
  const link = 'text-xs text-brand-accent hover:underline';

  return (
    <li className="py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium">{ROTULO_DA_OPERACAO_RENAVE[r.tipo]}</span>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${COR_DO_STATUS[r.status]}`}>
          {ROTULO_DO_STATUS_RENAVE[r.status]}
        </span>
      </div>
      <p className="text-xs text-slate-500 mt-0.5">
        {dataCurta(r.dataOperacao)}
        {r.valor && ` · ${formatarBRL(r.valor)}`}
        {r.protocolo && ` · protocolo ${r.protocolo}`}
        {daIntegradora && ` · pela integradora${r.provider === 'simulado' ? ' (simulada)' : ''}`}
      </p>
      {daIntegradora && r.status === 'pendente' && !r.externalId && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          A integradora não respondeu a este envio. Envie de novo: o pedido é o mesmo, não duplica.
        </p>
      )}
      {r.chaveNfe && sugerida && r.chaveNfe !== sugerida.chave && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          A NF-e anotada é diferente da nota autorizada {rotuloDaNota(sugerida)}.
        </p>
      )}
      {r.chaveNfe && (
        <p className="text-[11px] text-slate-400 font-mono break-all">NF-e {formatarChaveNfe(r.chaveNfe)}</p>
      )}
      {r.motivoRecusa && <p className="text-xs text-rose-600 dark:text-rose-400">{r.motivoRecusa}</p>}
      {r.motivoCancelamento && (
        <p className="text-xs text-slate-400">
          Cancelado em {dataCurta(r.canceladoEm)}: {r.motivoCancelamento}
          {r.protocoloCancelamento && ` · protocolo ${r.protocoloCancelamento}`}
        </p>
      )}

      {podeRegistrar && vivo && (
        <div className="flex flex-wrap gap-3 mt-1.5">
          {r.status === 'pendente' && !daIntegradora && (
            <>
              <button type="button" className={link} onClick={() => abrir('confirmar')}>anotar protocolo</button>
              <button type="button" className={link} onClick={() => abrir('recusar')}>foi recusado</button>
            </>
          )}
          {r.status === 'pendente' && daIntegradora && r.externalId && (
            <>
              <button type="button" className={link} onClick={() => direto({ acao: 'atualizar' })}>atualizar</button>
              {simulado && (
                <>
                  <button type="button" className={link} onClick={() => direto({ acao: 'simular', resultado: 'confirmar' })}>
                    simular confirmação
                  </button>
                  <button type="button" className={link} onClick={() => direto({ acao: 'simular', resultado: 'recusar' })}>
                    simular recusa
                  </button>
                </>
              )}
            </>
          )}
          {(r.temAtpv || (daIntegradora && r.status === 'confirmado' && !ehEntrada(r.tipo))) && (
            <button type="button" className={link} onClick={baixarAtpv}>ATPV-e</button>
          )}
          {r.status === 'confirmado' && (
            <button type="button" className={link} onClick={() => abrir('nfe')}>
              {r.chaveNfe ? 'trocar NF-e' : 'informar NF-e'}
            </button>
          )}
          <button type="button" className={link} onClick={() => abrir('cancelar')}>cancelar</button>
        </div>
      )}

      {aberta && (
        <div className="mt-2 flex flex-col sm:flex-row gap-2">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={
              aberta === 'confirmar' ? 'Protocolo ou ID do estoque'
              : aberta === 'nfe' ? 'Chave da NF-e (44 dígitos)'
              : 'Motivo'
            }
            className={`${campo} flex-1`}
          />
          {aberta === 'confirmar' && (
            <input
              type="date" value={extra} onChange={(e) => setExtra(e.target.value)}
              aria-label="Data do registro" className={campo}
            />
          )}
          {aberta === 'cancelar' && r.status === 'confirmado' && (
            <input
              value={extra} onChange={(e) => setExtra(e.target.value)}
              placeholder="Protocolo do cancelamento (opcional)" className={`${campo} flex-1`}
            />
          )}
          <button
            type="button" onClick={enviar} disabled={acao.isPending || !texto.trim()}
            className={`${botao} ${aberta === 'cancelar' || aberta === 'recusar'
              ? 'border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400'
              : 'bg-brand-accent text-white hover:bg-blue-600'}`}
          >
            {acao.isPending && <Loader2 size={14} className="animate-spin" />}
            Salvar
          </button>
        </div>
      )}
      {aberta === 'nfe' && <SugestaoDaNota sugerida={sugerida} digitada={texto} />}
      {erroAtpv !== null && (
        <p className="mt-1.5 text-sm text-rose-600 dark:text-rose-400">{erroDaAcao(erroAtpv)}</p>
      )}
      {acao.error && (
        <p className="mt-1.5 text-sm text-rose-600 dark:text-rose-400">{erroDaAcao(acao.error)}</p>
      )}
    </li>
  );
}

/**
 * Anotar um registro novo. O **valor não é campo**: o de compra vem do custo
 * do veículo e o de venda do negócio, e aparece aqui só para conferência.
 */
function NovoRegistro({
  dados, dealId, tipoInicial, onFechar,
}: {
  dados: RenaveDoVeiculo;
  dealId?: string;
  tipoInicial: RenaveOperacaoValue;
  onFechar: () => void;
}) {
  const registrar = useRegistrarRenave();
  const { entrada, saidas } = dados.sugestao;

  const [tipo, setTipo] = useState<RenaveOperacaoValue>(tipoInicial);
  const [negocio, setNegocio] = useState(dealId ?? saidas[0]?.dealId ?? '');
  const [protocolo, setProtocolo] = useState('');
  const [registradoEm, setRegistradoEm] = useState('');
  const [dataOperacao, setDataOperacao] = useState('');
  // `null` = a loja não mexeu no campo: ele mostra a chave da nota autorizada
  // da operação escolhida. Digitou, vale o que ela digitou — nunca sobrescrevemos.
  const [chaveDigitada, setChaveNfe] = useState<string | null>(null);

  const saida = saidas.find((s) => s.dealId === negocio);
  const sugerida = notaSugerida(dados.sugestao.notasAutorizadas, tipo, negocio);
  const chaveNfe = chaveDigitada ?? sugerida?.chave ?? '';
  const valor = tipo === 'saida_venda' ? saida?.valor : ehEntrada(tipo) ? entrada.valor : null;
  const dataSugerida = tipo === 'saida_venda' ? saida?.dataOperacao : ehEntrada(tipo) ? entrada.dataOperacao : null;
  const faltaAquisicao = tipo === 'entrada_compra' && !entrada.temAquisicao;
  const faltaNegocio = tipo === 'saida_venda' && !saida;

  const enviar = () => {
    registrar.mutate(
      {
        vehicleId: dados.vehicleId,
        tipo,
        ...(tipo === 'saida_venda' ? { dealId: negocio } : {}),
        ...(protocolo.trim() ? { protocolo: protocolo.trim() } : {}),
        ...(protocolo.trim() && registradoEm ? { registradoEm } : {}),
        ...(dataOperacao ? { dataOperacao } : {}),
        ...(chaveNfe.trim() ? { chaveNfe } : {}),
      },
      { onSuccess: onFechar },
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">Operação</span>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as RenaveOperacaoValue)}
            className={`${campo} w-full`}
          >
            <optgroup label="Entrada">
              {OPERACOES_DE_ENTRADA.map((t) => (
                <option key={t} value={t}>{ROTULO_DA_OPERACAO_RENAVE[t]}</option>
              ))}
            </optgroup>
            <optgroup label="Saída">
              {OPERACOES_DE_SAIDA.map((t) => (
                <option key={t} value={t}>{ROTULO_DA_OPERACAO_RENAVE[t]}</option>
              ))}
            </optgroup>
          </select>
        </label>

        {tipo === 'saida_venda' && !dealId && saidas.length > 1 && (
          <label className="text-xs text-slate-500 space-y-1">
            <span className="block">Negócio</span>
            <select value={negocio} onChange={(e) => setNegocio(e.target.value)} className={`${campo} w-full`}>
              {saidas.map((s) => (
                <option key={s.dealId} value={s.dealId}>
                  {formatarBRL(s.valor)} · {dataCurta(s.dataOperacao)}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">Protocolo (vazio se ainda não chegou)</span>
          <input value={protocolo} onChange={(e) => setProtocolo(e.target.value)}
            placeholder="Protocolo ou ID do estoque" className={`${campo} w-full`} />
        </label>

        {protocolo.trim() && (
          <label className="text-xs text-slate-500 space-y-1">
            <span className="block">Registrado no RENAVE em</span>
            <input type="date" value={registradoEm} onChange={(e) => setRegistradoEm(e.target.value)}
              className={`${campo} w-full`} />
          </label>
        )}

        <label className="text-xs text-slate-500 space-y-1">
          <span className="block">
            Data {ehEntrada(tipo) ? 'da compra' : tipo === 'saida_venda' ? 'da venda' : 'da operação'}
          </span>
          <input type="date" value={dataOperacao || paraInput(dataSugerida)}
            onChange={(e) => setDataOperacao(e.target.value)} className={`${campo} w-full`} />
        </label>

        <label className="text-xs text-slate-500 space-y-1 sm:col-span-2">
          <span className="block">Chave da NF-e {ehEntrada(tipo) ? 'de entrada' : 'de saída'} (opcional)</span>
          <input value={chaveNfe} onChange={(e) => setChaveNfe(e.target.value)}
            placeholder="44 dígitos, como no DANFE" className={`${campo} w-full font-mono`} />
          <SugestaoDaNota sugerida={sugerida} digitada={chaveNfe} />
        </label>
      </div>

      {operacaoTemValor(tipo) && valor && (
        <p className="text-xs text-slate-500">
          Valor declarado: <strong>{formatarBRL(valor)}</strong> — vem{' '}
          {tipo === 'saida_venda' ? 'do negócio' : 'do custo do veículo'}; para mudar, corrija lá.
        </p>
      )}
      {faltaAquisicao && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Registre a compra no custo do veículo primeiro: o valor de compra que vai ao RENAVE vem de lá.
        </p>
      )}
      {faltaNegocio && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          A saída por venda é anotada a partir de um negócio assinado.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button" onClick={enviar}
          disabled={registrar.isPending || faltaAquisicao || faltaNegocio}
          className={`${botao} bg-brand-accent text-white hover:bg-blue-600`}
        >
          {registrar.isPending && <Loader2 size={14} className="animate-spin" />}
          Salvar registro
        </button>
        <button type="button" onClick={onFechar} className={`${botao} text-slate-500`}>
          Fechar
        </button>
      </div>
      {registrar.error && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{erroDaAcao(registrar.error)}</p>
      )}
    </div>
  );
}
