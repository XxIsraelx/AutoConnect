'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, BadgeCheck, Building2, FileText, KeyRound, Loader2, Save, Sparkles, TriangleAlert,
} from 'lucide-react';
import { api, ApiError, type FieldError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import CertificadoA1 from '@/components/fiscal/CertificadoA1';
import {
  AMBIENTES_FISCAIS, PIS_COFINS_SEM_VALOR_CALCULADO, REGIMES_TRIBUTARIOS, ROTULO_DA_DIRECAO, ROTULO_DO_REGIME,
  type AmbienteFiscal, type OperacaoFiscal, type RegimeTributario,
} from '@autoconnect/shared';

/* ── O que a API devolve em GET /fiscal/perfil ───────────── */

interface PerfilDaOperacao {
  natureza: string;
  cfopInterno: string;
  cfopInterestadual: string;
  situacaoTributaria: string | null;
  pisCofinsSituacaoTributaria: string | null;
  informacoesComplementares: string | null;
}

interface Operacao {
  operacao: OperacaoFiscal;
  rotulo: string;
  direcao: 'entrada' | 'saida';
  quando: string;
  sugestao: { natureza: string; cfopInterno: string; cfopInterestadual: string };
  perfil: PerfilDaOperacao | null;
}

interface PerfilFiscal {
  configuracao: {
    regime: RegimeTributario;
    serie: number;
    ambiente: AmbienteFiscal;
    usaCsosn: boolean;
    contadorConfirmouEm: string | null;
    contadorNome: string | null;
    contadorCrc: string | null;
    certificado: { validoAte: string | null; cnpj: string | null; enviadoEm: string | null } | null;
  } | null;
  loja: { cnpj: string | null; inscricaoEstadual: string | null; razaoSocial: string | null; ufDaMatriz: string | null };
  operacoes: Operacao[];
}

const ROTULO_DO_AMBIENTE: Record<AmbienteFiscal, string> = {
  homologacao: 'Homologação (teste)',
  producao: 'Produção',
};

const campo = 'w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white ' +
  'dark:bg-slate-950 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500';

function Section({ title, icon: Icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
          <Icon size={14} className="text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{title}</h2>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

function Rotulo({ texto, erro, children }: { texto: string; erro?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{texto}</span>
      {children}
      {erro && <span className="block text-xs text-rose-600 dark:text-rose-400 mt-1">{erro}</span>}
    </label>
  );
}

const erroDoCampo = (erros: FieldError[], nome: string) => erros.find((e) => e.field === nome)?.message;

/**
 * Uma operação: natureza, CFOPs, situação tributária e texto complementar.
 *
 * Salva por operação, e não num botão só para a página: mudar uma operação
 * apaga a confirmação do contador, e um "Salvar tudo" apagaria por causa de um
 * campo que a pessoa nem tocou.
 */
function CartaoDaOperacao({ op, usaCsosn, token, onSalvo }: {
  op: Operacao; usaCsosn: boolean; token?: string; onSalvo: (p: PerfilFiscal) => void;
}) {
  const inicial = op.perfil ?? {
    ...op.sugestao, situacaoTributaria: null, pisCofinsSituacaoTributaria: null, informacoesComplementares: null,
  };
  const [natureza, setNatureza] = useState(inicial.natureza);
  const [cfopInterno, setCfopInterno] = useState(inicial.cfopInterno);
  const [cfopInterestadual, setCfopInterestadual] = useState(inicial.cfopInterestadual);
  const [situacao, setSituacao] = useState(inicial.situacaoTributaria ?? '');
  const [pisCofins, setPisCofins] = useState(inicial.pisCofinsSituacaoTributaria ?? '');
  const [info, setInfo] = useState(inicial.informacoesComplementares ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<FieldError[]>([]);
  const [erro, setErro] = useState('');

  async function salvar() {
    setSalvando(true);
    setErros([]);
    setErro('');
    try {
      const p = await api<PerfilFiscal>(`/fiscal/perfil/operacoes/${op.operacao}`, {
        token,
        method: 'PUT',
        body: JSON.stringify({
          natureza,
          cfopInterno,
          cfopInterestadual,
          situacaoTributaria: situacao.trim() || null,
          pisCofinsSituacaoTributaria: pisCofins.trim() || null,
          informacoesComplementares: info.trim() || null,
        }),
      });
      onSalvo(p);
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.length > 0) setErros(e.fieldErrors);
      else setErro(textoDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{op.rotulo}</p>
          <p className="text-xs text-slate-500 mt-0.5">{op.quando}</p>
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full
          ${op.direcao === 'saida'
            ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
          nota de {ROTULO_DA_DIRECAO[op.direcao]}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Rotulo texto="Natureza da operação" erro={erroDoCampo(erros, 'natureza')}>
          <input className={campo} value={natureza} maxLength={60} onChange={(e) => setNatureza(e.target.value)} />
        </Rotulo>
        <Rotulo
          texto={usaCsosn ? 'CSOSN (3 dígitos)' : 'CST do ICMS (2 dígitos)'}
          erro={erroDoCampo(erros, 'situacaoTributaria')}
        >
          <input
            className={campo} value={situacao} inputMode="numeric" maxLength={3}
            placeholder="Definir com o contador"
            onChange={(e) => setSituacao(e.target.value.replace(/\D/g, ''))}
          />
        </Rotulo>
        <Rotulo texto="CST de PIS/COFINS (2 dígitos)" erro={erroDoCampo(erros, 'pisCofinsSituacaoTributaria')}>
          <input
            className={campo} value={pisCofins} inputMode="numeric" maxLength={2}
            placeholder="Definir com o contador"
            onChange={(e) => setPisCofins(e.target.value.replace(/\D/g, ''))}
          />
          <span className="block text-[11px] text-slate-400 mt-1">
            Saem sem valor calculado: {PIS_COFINS_SEM_VALOR_CALCULADO.join(', ')}.
          </span>
        </Rotulo>
        <div className="hidden sm:block" />
        <Rotulo texto="CFOP dentro do estado" erro={erroDoCampo(erros, 'cfopInterno')}>
          <input
            className={campo} value={cfopInterno} inputMode="numeric" maxLength={4}
            onChange={(e) => setCfopInterno(e.target.value.replace(/\D/g, ''))}
          />
        </Rotulo>
        <Rotulo texto="CFOP para outro estado" erro={erroDoCampo(erros, 'cfopInterestadual')}>
          <input
            className={campo} value={cfopInterestadual} inputMode="numeric" maxLength={4}
            onChange={(e) => setCfopInterestadual(e.target.value.replace(/\D/g, ''))}
          />
        </Rotulo>
      </div>
      <Rotulo texto="Informações complementares (opcional)" erro={erroDoCampo(erros, 'informacoesComplementares')}>
        <textarea className={campo} rows={2} maxLength={2000} value={info} onChange={(e) => setInfo(e.target.value)} />
      </Rotulo>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-rose-600 dark:text-rose-400">{erro}</p>
        <button
          type="button" onClick={salvar} disabled={salvando}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg
                     bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {salvando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {op.perfil ? 'Salvar operação' : 'Criar operação'}
        </button>
      </div>
    </div>
  );
}

/**
 * Perfil fiscal da loja — fase N1 do plano fiscal.
 *
 * A tela diz duas coisas o tempo todo, porque são as duas que mais custam se
 * forem esquecidas: **a situação tributária é do contador** (nasce em branco,
 * sem sugestão) e **mudar o perfil apaga a confirmação dele**.
 *
 * Gerência só; a API recusa o vendedor com 403 e o `ErroAoCarregar` explica.
 */
export default function PerfilFiscalPage() {
  const token = useAuthStore((s) => s.token) ?? undefined;

  const [perfil, setPerfil] = useState<PerfilFiscal | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroDeCarga, setErroDeCarga] = useState<unknown>(null);

  const [regime, setRegime] = useState<RegimeTributario>('simples_nacional');
  const [serie, setSerie] = useState('1');
  const [ambiente, setAmbiente] = useState<AmbienteFiscal>('homologacao');
  const [salvandoCfg, setSalvandoCfg] = useState(false);
  const [errosCfg, setErrosCfg] = useState<FieldError[]>([]);
  const [erroCfg, setErroCfg] = useState('');

  const [semeando, setSemeando] = useState(false);
  const [erroSemear, setErroSemear] = useState('');

  const [contador, setContador] = useState('');
  const [crc, setCrc] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [erroConfirmar, setErroConfirmar] = useState('');

  /** Versão da lista de operações: troca a `key` dos cartões e os remonta com o que a API devolveu. */
  const [versao, setVersao] = useState(0);

  const aplicar = useCallback((p: PerfilFiscal) => {
    setPerfil(p);
    if (p.configuracao) {
      setRegime(p.configuracao.regime);
      setSerie(String(p.configuracao.serie));
      setAmbiente(p.configuracao.ambiente);
    }
  }, []);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErroDeCarga(null);
    try {
      aplicar(await api<PerfilFiscal>('/fiscal/perfil', { token }));
      setVersao((v) => v + 1);
    } catch (e) {
      setErroDeCarga(e);
    } finally {
      setCarregando(false);
    }
  }, [token, aplicar]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function salvarConfiguracao() {
    setSalvandoCfg(true);
    setErrosCfg([]);
    setErroCfg('');
    try {
      aplicar(await api<PerfilFiscal>('/fiscal/perfil', {
        token, method: 'PUT', body: JSON.stringify({ regime, serie: Number(serie), ambiente }),
      }));
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.length > 0) setErrosCfg(e.fieldErrors);
      else setErroCfg(textoDoErro(e));
    } finally {
      setSalvandoCfg(false);
    }
  }

  async function semear() {
    setSemeando(true);
    setErroSemear('');
    try {
      await api('/fiscal/perfil/operacoes/padrao', { token, method: 'POST' });
      await carregar();
    } catch (e) {
      setErroSemear(textoDoErro(e));
    } finally {
      setSemeando(false);
    }
  }

  async function confirmar() {
    setConfirmando(true);
    setErroConfirmar('');
    try {
      aplicar(await api<PerfilFiscal>('/fiscal/perfil/confirmacao-do-contador', {
        token, method: 'POST', body: JSON.stringify({ nomeDoContador: contador, crc: crc.trim() || undefined }),
      }));
      setContador('');
      setCrc('');
    } catch (e) {
      setErroConfirmar(textoDoErro(e));
    } finally {
      setConfirmando(false);
    }
  }

  const cfg = perfil?.configuracao ?? null;
  const operacoesCriadas = perfil?.operacoes.filter((o) => o.perfil).length ?? 0;
  const faltasDaLoja = perfil
    ? [
      !perfil.loja.cnpj && 'CNPJ',
      !perfil.loja.inscricaoEstadual && 'inscrição estadual',
      !perfil.loja.ufDaMatriz && 'endereço da matriz',
    ].filter(Boolean) as string[]
    : [];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/configuracoes" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
          <ArrowLeft size={13} /> Configurações
        </Link>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-2">Perfil fiscal</h1>
        <p className="text-sm text-slate-500 mt-1">
          Como a loja fatura. O AutoConnect monta a nota a partir do negócio; quem decide o
          tributo é o seu contador — por isso a situação tributária começa em branco.
        </p>
      </div>

      {carregando && !perfil && (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-400" /></div>
      )}

      {erroDeCarga !== null && !carregando && (
        <ErroAoCarregar erro={erroDeCarga} onTentarNovamente={carregar} />
      )}

      {/* Formulário que edita dado existente não renderiza se a carga falhou:
          aberto com os padrões, "Salvar" gravaria o padrão por cima. */}
      {perfil && erroDeCarga === null && (
        <>
          {faltasDaLoja.length > 0 && (
            <div className="flex gap-2.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50
                            dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
              <TriangleAlert size={16} className="shrink-0 mt-0.5" />
              <p>
                Falta {faltasDaLoja.join(', ')} da loja. A nota não sai sem eles —{' '}
                <Link href="/configuracoes" className="underline font-medium">preencha em Configurações</Link>.
              </p>
            </div>
          )}

          <Section title="Regime e série" icon={Building2}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Rotulo texto="Regime tributário" erro={erroDoCampo(errosCfg, 'regime')}>
                <select className={campo} value={regime} onChange={(e) => setRegime(e.target.value as RegimeTributario)}>
                  {REGIMES_TRIBUTARIOS.map((r) => <option key={r} value={r}>{ROTULO_DO_REGIME[r]}</option>)}
                </select>
              </Rotulo>
              <Rotulo texto="Série da NF-e" erro={erroDoCampo(errosCfg, 'serie')}>
                <input className={campo} inputMode="numeric" value={serie} onChange={(e) => setSerie(e.target.value.replace(/\D/g, ''))} />
              </Rotulo>
              <Rotulo texto="Ambiente" erro={erroDoCampo(errosCfg, 'ambiente')}>
                <select className={campo} value={ambiente} onChange={(e) => setAmbiente(e.target.value as AmbienteFiscal)}>
                  {AMBIENTES_FISCAIS.map((a) => <option key={a} value={a}>{ROTULO_DO_AMBIENTE[a]}</option>)}
                </select>
              </Rotulo>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Em homologação a nota é de teste e não tem valor fiscal. Produção só emite depois
              que o contador confirmar o perfil.
            </p>
            {cfg && cfg.regime !== regime && cfg.contadorConfirmouEm && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-3">
                Trocar o regime apaga a confirmação do contador.
              </p>
            )}
            <div className="flex items-center justify-between gap-3 mt-4">
              <p className="text-xs text-rose-600 dark:text-rose-400">{erroCfg}</p>
              <button
                type="button" onClick={salvarConfiguracao} disabled={salvandoCfg}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg
                           bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {salvandoCfg ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Salvar
              </button>
            </div>
          </Section>

          <Section title="Certificado digital A1" icon={KeyRound}>
            <CertificadoA1
              certificado={cfg?.certificado ?? null}
              temPerfil={!!cfg}
              onEnviado={carregar}
            />
          </Section>

          <Section title="Operações" icon={FileText}>
            {!cfg ? (
              <p className="text-sm text-slate-500">Salve o regime tributário primeiro: é ele que diz se a situação tributária é CST ou CSOSN.</p>
            ) : (
              <div className="space-y-4">
                {operacoesCriadas < (perfil.operacoes.length) && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Crie as operações que faltam com a natureza e o CFOP sugeridos. Leve ao contador antes de usar.
                    </p>
                    <button
                      type="button" onClick={semear} disabled={semeando}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg
                                 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      {semeando ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                      Usar as sugestões
                    </button>
                    {erroSemear && <p className="w-full text-xs text-rose-600 dark:text-rose-400">{erroSemear}</p>}
                  </div>
                )}
                {perfil.operacoes.map((op) => (
                  <CartaoDaOperacao
                    key={`${op.operacao}-${versao}`}
                    op={op} usaCsosn={cfg.usaCsosn} token={token} onSalvo={aplicar}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title="Confirmação do contador" icon={BadgeCheck}>
            {cfg?.contadorConfirmouEm ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                Confirmado por {cfg.contadorNome}{cfg.contadorCrc ? ` (CRC ${cfg.contadorCrc})` : ''} em{' '}
                {new Date(cfg.contadorConfirmouEm).toLocaleDateString('pt-BR')}.
              </p>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Ainda não confirmado. Em homologação dá para testar sem a confirmação; em produção a
                nota só sai depois dela.
              </p>
            )}
            <p className="text-xs text-slate-500 mt-1">
              Qualquer mudança no regime ou numa operação apaga a confirmação — o contador conferiu
              o que viu, não o que veio depois.
            </p>
            {cfg && !cfg.contadorConfirmouEm && (
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] items-end mt-4">
                <Rotulo texto="Nome do contador">
                  <input className={campo} value={contador} maxLength={120} onChange={(e) => setContador(e.target.value)} />
                </Rotulo>
                <Rotulo texto="CRC (opcional)">
                  <input className={campo} value={crc} maxLength={30} onChange={(e) => setCrc(e.target.value)} />
                </Rotulo>
                <button
                  type="button" onClick={confirmar} disabled={confirmando || contador.trim().length < 3}
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg
                             bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition"
                >
                  {confirmando ? <Loader2 size={13} className="animate-spin" /> : <BadgeCheck size={13} />}
                  Registrar confirmação
                </button>
                {erroConfirmar && <p className="sm:col-span-3 text-xs text-rose-600 dark:text-rose-400">{erroConfirmar}</p>}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
