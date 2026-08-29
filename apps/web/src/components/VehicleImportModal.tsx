'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, UploadCloud, FileSpreadsheet, Download, AlertTriangle,
  CheckCircle2, Loader2, ArrowLeft, CircleAlert, Car,
} from 'lucide-react';
import { api } from '@/lib/api';
import {
  parseAndValidate, downloadTemplate,
  type ParsedSheet, type CellError,
} from '@/lib/vehicleImport';

const COLUMN_LABELS: Record<string, string> = {
  marca: 'Marca', modelo: 'Modelo', versao: 'Versão', condicao: 'Condição',
  ano_modelo: 'Ano modelo', ano_fabricacao: 'Ano fabricação',
  quilometragem: 'Quilometragem', cor: 'Cor', combustivel: 'Combustível',
  cambio: 'Câmbio', motor: 'Motor', portas: 'Portas', preco: 'Preço',
  preco_promocional: 'Preço promocional', descricao: 'Descrição',
};

export default function VehicleImportModal({
  token, onClose, onImported,
}: {
  token: string;
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setSheet(parseAndValidate(String(reader.result ?? '')));
    reader.readAsText(file, 'utf-8');
  }, []);

  /** erros indexados por célula para destacar na tabela */
  const errorByCell = useMemo(() => {
    const map = new Map<string, CellError>();
    sheet?.errors.forEach((e) => {
      const key = `${e.rowIndex}|${e.column}`;
      if (!map.has(key)) map.set(key, e);
    });
    return map;
  }, [sheet]);

  const errorRows = useMemo(
    () => new Set(sheet?.errors.map((e) => e.rowIndex) ?? []),
    [sheet],
  );

  const canImport = !!sheet && sheet.errors.length === 0
    && sheet.missingColumns.length === 0 && sheet.rows.length > 0;

  async function handleImport() {
    if (!canImport || !sheet) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await api<{ imported: number }>('/vehicles/import', {
        method: 'POST', token, body: { rows: sheet.rows },
      });
      setDone(res.imported);
      onImported(res.imported);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro ao importar veículos');
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setSheet(null); setFileName(''); setSubmitError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div onClick={onClose} className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm" />
      <div className="fixed inset-0 z-[2001] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl
                        bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">

          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center">
              <FileSpreadsheet size={17} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-[15px]">Importar estoque</h2>
              <p className="text-xs text-slate-500">
                {done !== null ? 'Importação concluída'
                  : sheet ? `Revisão de ${fileName}`
                  : 'Suba uma planilha CSV com seus veículos'}
              </p>
            </div>
            <button onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white
                         hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              <X size={18} />
            </button>
          </div>

          {/* ── Sucesso ── */}
          {done !== null ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center mb-4">
                <CheckCircle2 size={32} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-lg font-bold mb-1">
                {done} veículo{done !== 1 ? 's' : ''} importado{done !== 1 ? 's' : ''}!
              </h3>
              <p className="text-sm text-slate-500 mb-6 max-w-sm">
                O estoque já está disponível na listagem. Agora você pode adicionar fotos
                em cada veículo para publicá-los no catálogo.
              </p>
              <button onClick={onClose}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition">
                Ver estoque
              </button>
            </div>

          /* ── Passo 1: upload ── */
          ) : !sheet ? (
            <div className="p-6 overflow-y-auto">
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) readFile(f);
                }}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all
                  ${dragOver
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                    : 'border-slate-300 dark:border-slate-700 hover:border-blue-400'}`}
              >
                <input ref={fileRef} type="file" accept=".csv,text/csv" hidden
                  onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
                <UploadCloud size={36} className={`mx-auto mb-3 ${dragOver ? 'text-blue-500' : 'text-slate-400'}`} />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Arraste a planilha aqui ou clique para selecionar
                </p>
                <p className="text-xs text-slate-400 mt-1">Arquivo .csv · até 300 veículos por importação</p>
              </div>

              <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold mb-1">Primeira vez importando?</p>
                    <p className="text-xs text-slate-500 leading-relaxed max-w-md">
                      Baixe o modelo com as colunas corretas e dois exemplos preenchidos.
                      Colunas obrigatórias: <span className="font-medium text-slate-600 dark:text-slate-300">
                      marca, modelo, condição, ano modelo, ano fabricação, quilometragem e preço</span>.
                    </p>
                  </div>
                  <button onClick={downloadTemplate}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold shrink-0
                               bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
                               text-blue-600 dark:text-blue-400 hover:border-blue-400 transition">
                    <Download size={15} /> Baixar modelo (.csv)
                  </button>
                </div>
              </div>
            </div>

          /* ── Passo 2: revisão ── */
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-5 space-y-4">

                {/* Colunas obrigatórias ausentes */}
                {sheet.missingColumns.length > 0 ? (
                  <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <CircleAlert size={16} className="text-red-500" />
                      <p className="text-sm font-bold text-red-700 dark:text-red-300">
                        Colunas obrigatórias não encontradas no arquivo
                      </p>
                    </div>
                    <p className="text-xs text-red-600/80 dark:text-red-300/70 mb-2">
                      Faltando: {sheet.missingColumns.map((c) => COLUMN_LABELS[c] ?? c).join(', ')}.
                    </p>
                    <p className="text-xs text-red-600/80 dark:text-red-300/70">
                      Confira se a primeira linha da planilha tem exatamente os nomes do modelo —
                      baixe o modelo no passo anterior se precisar.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Resumo */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full
                                       bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        <Car size={12} /> {sheet.rows.length} linha{sheet.rows.length !== 1 ? 's' : ''}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full
                                       bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 size={12} /> {sheet.rows.length - errorRows.size} válida{sheet.rows.length - errorRows.size !== 1 ? 's' : ''}
                      </span>
                      {sheet.errors.length > 0 && (
                        <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full
                                         bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400">
                          <AlertTriangle size={12} /> {sheet.errors.length} erro{sheet.errors.length !== 1 ? 's' : ''} em {errorRows.size} linha{errorRows.size !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {/* Lista de erros */}
                    {sheet.errors.length > 0 && (
                      <div className="rounded-xl border border-red-200 dark:border-red-900/60 overflow-hidden">
                        <div className="px-4 py-2.5 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-900/60
                                        flex items-center gap-2">
                          <AlertTriangle size={14} className="text-red-500" />
                          <p className="text-xs font-bold text-red-700 dark:text-red-300">
                            Corrija os erros abaixo na planilha e suba o arquivo novamente
                          </p>
                        </div>
                        <div className="max-h-44 overflow-y-auto divide-y divide-red-100 dark:divide-red-900/40">
                          {sheet.errors.map((e, i) => (
                            <div key={i} className="px-4 py-2.5 text-xs">
                              <p className="font-semibold text-slate-700 dark:text-slate-200">
                                <span className="inline-flex items-center justify-center min-w-[52px] mr-2 px-1.5 py-0.5
                                                 rounded bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400 font-bold">
                                  Linha {e.line}
                                </span>
                                <span className="text-blue-600 dark:text-blue-400">{COLUMN_LABELS[e.column] ?? e.column}</span>
                                {e.value && <span className="text-slate-400"> · valor: &ldquo;{e.value}&rdquo;</span>}
                              </p>
                              <p className="text-red-600 dark:text-red-400 mt-0.5">{e.message}</p>
                              <p className="text-slate-500 mt-0.5">✓ {e.hint}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Preview */}
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                      <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                          Pré-visualização do que será importado
                        </p>
                      </div>
                      <div className="overflow-x-auto max-h-72 overflow-y-auto">
                        <table className="w-full text-xs whitespace-nowrap">
                          <thead className="sticky top-0 bg-white dark:bg-slate-900 shadow-sm">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold text-slate-400 w-12">Linha</th>
                              {sheet.columns.map((c) => (
                                <th key={c} className="px-3 py-2 text-left font-semibold text-slate-500">
                                  {COLUMN_LABELS[c] ?? c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sheet.rawRows.map((row, ri) => (
                              <tr key={ri} className={`border-t border-slate-100 dark:border-slate-800
                                ${errorRows.has(ri) ? 'bg-red-50/60 dark:bg-red-950/20' : ''}`}>
                                <td className="px-3 py-2 text-slate-400 font-medium">{ri + 2}</td>
                                {sheet.columns.map((c, ci) => {
                                  const err = errorByCell.get(`${ri}|${c}`);
                                  return (
                                    <td key={ci} title={err ? `${err.message} — ${err.hint}` : undefined}
                                      className={`px-3 py-2 max-w-[180px] truncate
                                        ${err
                                          ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 font-semibold ring-1 ring-inset ring-red-300 dark:ring-red-800 cursor-help'
                                          : 'text-slate-600 dark:text-slate-300'}`}>
                                      {row[ci] || <span className="text-slate-300 dark:text-slate-600">—</span>}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}

                {submitError && (
                  <p className="text-sm text-red-500 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
                    {submitError}
                  </p>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-800 shrink-0">
                <button onClick={reset}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-xl
                             border border-slate-200 dark:border-slate-700
                             hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                  <ArrowLeft size={15} /> Escolher outro arquivo
                </button>
                <div className="flex items-center gap-3">
                  {!canImport && sheet.missingColumns.length === 0 && sheet.errors.length > 0 && (
                    <p className="text-xs text-red-500 font-medium hidden sm:block">
                      Corrija os erros para liberar a importação
                    </p>
                  )}
                  <button
                    onClick={handleImport}
                    disabled={!canImport || submitting}
                    className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white
                               text-sm font-semibold rounded-xl transition
                               disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {submitting
                      ? <><Loader2 size={15} className="animate-spin" /> Importando…</>
                      : <>Importar {sheet.rows.length > 0 && sheet.missingColumns.length === 0 ? `${sheet.rows.length} veículo${sheet.rows.length !== 1 ? 's' : ''}` : ''}</>}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
