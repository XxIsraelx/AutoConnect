'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, FileArchive, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import {
  formatarBRL, ROTULO_DO_STATUS_DA_NOTA,
  type ResumoDasNotas, type StatusDaNota,
} from '@autoconnect/shared';
import { api, baixarArquivo } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';
import ConferenciaFiscal from './ConferenciaFiscal';

interface NotaDoPeriodo {
  id: string;
  status: StatusDaNota;
  rotulo: string;
  direcao: 'entrada' | 'saida';
  numero: number | null;
  serie: number | null;
  chave: string | null;
  cfop: string;
  valorTotal: string;
  contraparte: string;
  emitidaEm: string;
  motivo: string | null;
  pendente: boolean;
  origem: { tipo: 'negocio' | 'veiculo'; id: string };
}

interface Relatorio {
  resumo: ResumoDasNotas;
  notas: NotaDoPeriodo[];
}

/** O mês de hoje em Brasília, como o `<input type="month">` quer: `AAAA-MM`. */
const mesDeHoje = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 7);

function intervaloDoMes(mes: string): { from: string; to: string } {
  const [ano, m] = mes.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return { from: `${mes}-01`, to: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

const COR_DO_STATUS: Record<StatusDaNota, string> = {
  processando: 'text-amber-700 dark:text-amber-300',
  autorizada: 'text-emerald-700 dark:text-emerald-300',
  rejeitada: 'text-rose-700 dark:text-rose-300',
  denegada: 'text-rose-700 dark:text-rose-300',
  cancelada: 'text-slate-500',
};

function Cartao({ titulo, quantidade, valor, destaque }: {
  titulo: string; quantidade: number; valor?: string; destaque?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${destaque
      ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40'
      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'}`}>
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">{quantidade}</p>
      {valor !== undefined && <p className="text-xs tabular-nums text-slate-500">{formatarBRL(valor)}</p>}
    </div>
  );
}

/**
 * As notas fiscais do mês e o pacote para o contador — fase N4 do plano fiscal.
 *
 * O período é o da autorização, em horário de Brasília: nota autorizada em
 * outubro e cancelada em novembro é de outubro, com o cancelamento junto. O
 * pacote leva o XML de cada autorizada ou cancelada e um índice; o que ficou sem
 * XML vai nomeado no LEIA-ME de dentro do ZIP, nunca some em silêncio.
 */
export default function NotasDoPeriodo() {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const [mes, setMes] = useState(mesDeHoje());
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);
  const [baixando, setBaixando] = useState<'zip' | 'csv' | null>(null);
  const [erroDoDownload, setErroDoDownload] = useState('');

  const { from, to } = intervaloDoMes(mes);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      setRelatorio(await api<Relatorio>(`/fiscal/notas?from=${from}&to=${to}`, { token }));
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [token, from, to]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function baixar(tipo: 'zip' | 'csv') {
    setBaixando(tipo);
    setErroDoDownload('');
    try {
      await baixarArquivo(
        tipo === 'zip' ? `/fiscal/notas/pacote.zip?from=${from}&to=${to}` : `/fiscal/notas.csv?from=${from}&to=${to}`,
        `notas-fiscais_${mes}.${tipo}`,
        token,
      );
    } catch (e) {
      setErroDoDownload(textoDoErro(e));
    } finally {
      setBaixando(null);
    }
  }

  const r = relatorio?.resumo;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block">
          <span className="block text-xs text-slate-500 mb-1">Mês</span>
          <input
            type="month" value={mes} max={mesDeHoje()} onChange={(e) => e.target.value && setMes(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button" onClick={() => baixar('zip')} disabled={baixando !== null || !relatorio?.notas.length}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {baixando === 'zip' ? <Loader2 size={13} className="animate-spin" /> : <FileArchive size={13} />}
            Pacote para o contador (ZIP)
          </button>
          <button
            type="button" onClick={() => baixar('csv')} disabled={baixando !== null || !relatorio?.notas.length}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            {baixando === 'csv' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Índice (CSV)
          </button>
          <button type="button" onClick={carregar} aria-label="Atualizar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-1">
            <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        O pacote leva o XML de cada nota autorizada ou cancelada no mês e um índice em CSV. Se alguma
        nota ficar sem XML, o LEIA-ME de dentro do ZIP diz qual e por quê.
      </p>
      {erroDoDownload && <p className="text-xs text-rose-600 dark:text-rose-400">{erroDoDownload}</p>}

      {erro !== null && !carregando && <ErroAoCarregar erro={erro} onTentarNovamente={carregar} />}

      {r && erro === null && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Cartao titulo="Saídas autorizadas" quantidade={r.saidas.quantidade} valor={r.saidas.valor} />
            <Cartao titulo="Entradas autorizadas" quantidade={r.entradas.quantidade} valor={r.entradas.valor} />
            <Cartao titulo="Canceladas" quantidade={r.porStatus.cancelada.quantidade} />
            <Cartao titulo="Pedem ação" quantidade={r.pendentes.length} destaque={r.pendentes.length > 0} />
          </div>

          {r.pendentes.length > 0 && (
            <p className="flex gap-2 text-sm text-amber-800 dark:text-amber-200">
              <TriangleAlert size={16} className="shrink-0 mt-0.5" />
              Nota processando precisa ser consultada; rejeitada ou denegada sem outra emitida depois
              deixa a venda (ou a compra) sem nota.
            </p>
          )}

          {relatorio!.notas.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">Nenhuma nota emitida neste mês.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Data</th>
                    <th className="text-left font-medium px-3 py-2">Operação</th>
                    <th className="text-left font-medium px-3 py-2">Nº</th>
                    <th className="text-left font-medium px-3 py-2">Destinatário / remetente</th>
                    <th className="text-right font-medium px-3 py-2">Valor</th>
                    <th className="text-left font-medium px-3 py-2">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {relatorio!.notas.map((n) => (
                    <tr key={n.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{new Date(n.emitidaEm).toLocaleDateString('pt-BR')}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={n.origem.tipo === 'negocio' ? `/negocios/${n.origem.id}` : `/veiculos/${n.origem.id}`}
                          className="text-brand-accent"
                        >
                          {n.rotulo}
                        </Link>
                        <span className="text-xs text-slate-400"> · CFOP {n.cfop}</span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{n.numero ?? '—'}</td>
                      <td className="px-3 py-2">{n.contraparte}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatarBRL(n.valorTotal)}</td>
                      <td className="px-3 py-2">
                        <span className={COR_DO_STATUS[n.status]}>{ROTULO_DO_STATUS_DA_NOTA[n.status]}</span>
                        {n.pendente && (
                          <span className="ml-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300">
                            pede ação
                          </span>
                        )}
                        {n.motivo && n.status !== 'autorizada' && <p className="text-xs text-slate-500">{n.motivo}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Fase C: o mesmo mês, cruzado com o RENAVE. */}
      <ConferenciaFiscal from={from} to={to} />
    </div>
  );
}
