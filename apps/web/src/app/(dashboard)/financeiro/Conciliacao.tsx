'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, FileUp, Loader2, RefreshCw, X } from 'lucide-react';
import { formatarBRL } from '@autoconnect/shared';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';
import {
  buscarConciliacao, conciliar, ignorarTransacao, importarOfx,
  type Conciliacao as ConciliacaoDaApi, type ContaFinanceira,
} from './dados';

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

/**
 * O extrato do banco encontra os lançamentos da loja.
 *
 * É o que dá **confiança no número**: antes daqui, o caixa é o que a loja
 * digitou; depois, é o que o banco confirma. O que sobra dos dois lados fica na
 * tela em vez de virar diferença que ninguém explica.
 *
 * A sugestão **não** concilia sozinha. Ela é uma proposta com o valor igual e a
 * data próxima; quem confirma é a pessoa. Conciliação automática silenciosa é
 * como uma diferença de dez centavos vira três meses de extrato errado.
 */
export default function Conciliacao({ contas }: { contas: ContaFinanceira[] }) {
  const token = useAuthStore((s) => s.token);
  const ativas = contas.filter((c) => c.active);
  const [contaId, setContaId] = useState(ativas[0]?.id ?? '');
  const [dados, setDados] = useState<ConciliacaoDaApi | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);

  const [importando, setImportando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null);
  const [agindo, setAgindo] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    if (!token || !contaId) return;
    setCarregando(true);
    setErro(null);
    try {
      setDados(await buscarConciliacao(token, contaId));
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [token, contaId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function enviarArquivo(arquivo: File) {
    if (!token || !contaId) return;
    setImportando(true);
    setAviso(null);
    setErroDaAcao(null);
    try {
      // OFX é texto: o navegador lê e manda no corpo. Multipart exigiria
      // middleware novo para resolver o mesmo problema.
      const conteudo = await arquivo.text();
      const r = await importarOfx(token, contaId, conteudo);
      setAviso(
        `${r.importadas} transação(ões) importada(s)` +
        (r.jaExistiam ? ` · ${r.jaExistiam} já estavam aqui` : '') +
        (r.ignoradas ? ` · ${r.ignoradas} linha(s) ilegível(is)` : ''),
      );
      await carregar();
    } catch (e) {
      setErroDaAcao(textoDoErro(e));
    } finally {
      setImportando(false);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  }

  async function aceitar(transacaoId: string, lancamentoId: string) {
    if (!token) return;
    setAgindo(transacaoId);
    setErroDaAcao(null);
    try {
      const r = await conciliar(token, transacaoId, lancamentoId);
      setAviso(r.deuBaixa ? 'Conciliado, e o lançamento recebeu baixa.' : 'Conciliado.');
      await carregar();
    } catch (e) {
      setErroDaAcao(textoDoErro(e));
    } finally {
      setAgindo(null);
    }
  }

  async function ignorar(transacaoId: string) {
    if (!token) return;
    setAgindo(transacaoId);
    setErroDaAcao(null);
    try {
      await ignorarTransacao(token, transacaoId);
      await carregar();
    } catch (e) {
      setErroDaAcao(textoDoErro(e));
    } finally {
      setAgindo(null);
    }
  }

  if (ativas.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Cadastre uma conta em <strong>Contas</strong> antes de importar o extrato: a conciliação
        é por conta, como o extrato do banco.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={contaId} onChange={(e) => setContaId(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900
                     px-2.5 py-1.5 text-xs">
          {ativas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <input ref={arquivoRef} type="file" accept=".ofx,text/plain" hidden
          onChange={(e) => { const a = e.target.files?.[0]; if (a) void enviarArquivo(a); }} />
        <button onClick={() => arquivoRef.current?.click()} disabled={importando}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                     bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {importando ? <Loader2 size={13} className="animate-spin" /> : <FileUp size={13} />}
          Importar extrato (OFX)
        </button>

        <button onClick={carregar} disabled={carregando} title="Atualizar"
          className="ml-auto p-1.5 rounded-lg border border-slate-200 dark:border-slate-800
                     hover:bg-slate-50 dark:hover:bg-slate-800">
          <RefreshCw size={13} className={cn(carregando && 'animate-spin')} />
        </button>
      </div>

      {aviso && <p className="text-xs text-blue-600 dark:text-blue-400">{aviso}</p>}
      {erroDaAcao && (
        <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10
                      border border-rose-200 dark:border-rose-500/20 rounded-lg px-3 py-2">
          {erroDaAcao}
        </p>
      )}

      {erro ? (
        <ErroAoCarregar erro={erro} onTentarNovamente={carregar} carregando={carregando}
          contexto="a conciliação" />
      ) : !dados ? (
        <p className="text-sm text-slate-400 py-6 text-center">Carregando…</p>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800
                          bg-white dark:bg-slate-900 p-4">
            <h2 className="text-sm font-semibold mb-3">
              No extrato, sem par ({dados.transacoes.length})
            </h2>

            {dados.transacoes.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nada sobrando: todo o extrato importado já está conciliado.
              </p>
            ) : (
              <ul className="space-y-2">
                {dados.transacoes.map((t) => (
                  <li key={t.id}
                    className="flex flex-wrap items-center gap-3 border-t border-slate-100
                               dark:border-slate-800 pt-2 first:border-0 first:pt-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className={cn('font-semibold tabular-nums',
                          t.direction === 'entrada'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400')}>
                          {t.direction === 'entrada' ? '' : '−'}{formatarBRL(t.amount)}
                        </span>
                        <span className="text-slate-400"> · {data(t.postedAt)}</span>
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">{t.memo ?? 'Sem descrição'}</p>

                      {t.sugestao ? (
                        <p className="text-[11px] mt-0.5">
                          <span className={cn('font-semibold',
                            t.sugestao.confianca === 'alta'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400')}>
                            {t.sugestao.confianca === 'alta' ? 'Bate com' : 'Talvez seja'}
                          </span>{' '}
                          <span className="text-slate-600 dark:text-slate-300">
                            {t.sugestao.descricao}
                          </span>
                          {t.sugestao.distanciaEmDias > 0 && (
                            <span className="text-slate-400">
                              {' '}({t.sugestao.distanciaEmDias} dia(s) de diferença)
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Sem lançamento de mesmo valor na janela — lance e concilie depois.
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {t.sugestao && (
                        <button onClick={() => void aceitar(t.id, t.sugestao!.lancamentoId)}
                          disabled={agindo === t.id}
                          title="Conciliar com o lançamento sugerido"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs
                                     font-semibold bg-emerald-600 text-white hover:bg-emerald-700
                                     disabled:opacity-50">
                          {agindo === t.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Check size={12} />}
                          Conciliar
                        </button>
                      )}
                      <button onClick={() => void ignorar(t.id)} disabled={agindo === t.id}
                        title="Não é da loja (tarifa já lançada, transferência interna)"
                        className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100
                                   dark:hover:bg-slate-800 disabled:opacity-40">
                        <X size={13} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800
                          bg-white dark:bg-slate-900 p-4">
            <h2 className="text-sm font-semibold mb-2">
              No sistema, sem extrato ({dados.lancamentosSemExtrato.length})
            </h2>
            <p className="text-[11px] text-slate-400 mb-2">
              Lançamentos que o banco ainda não confirmou. Enquanto estiverem aqui, o caixa do
              sistema e o do banco discordam — e essa diferença tem nome.
            </p>
            <ul className="space-y-1">
              {dados.lancamentosSemExtrato.slice(0, 20).map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-slate-600 dark:text-slate-300">{l.descricao}</span>
                  <span className="text-slate-400 text-[11px] whitespace-nowrap">
                    {data(l.dueDate)} · {formatarBRL(l.valor)}
                  </span>
                </li>
              ))}
              {dados.lancamentosSemExtrato.length === 0 && (
                <li className="text-sm text-slate-500">Nenhum: tudo o que está no sistema o banco confirmou.</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
