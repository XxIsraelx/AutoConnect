'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Loader2, TriangleAlert, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { textoDoErro } from '@/components/ErroAoCarregar';

interface Emissor { disponivel: boolean; provedor: string | null; homologacao: boolean; exigeCertificado: boolean }

export interface CertificadoDaLoja { validoAte: string | null; cnpj: string | null; enviadoEm: string | null }

/** O PFX vira base64 aqui no navegador; o arquivo nunca é guardado — nem aqui, nem na API. */
function lerComoBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).replace(/^data:[^,]*,/, ''));
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo do certificado.'));
    leitor.readAsDataURL(arquivo);
  });
}

const DIA = 86_400_000;

/**
 * O certificado A1 da loja — fase N3 do plano fiscal.
 *
 * O arquivo e a senha vão ao emissor pela API e **não ficam**: a tela mostra o
 * que o emissor disse dele (validade e CNPJ) e avisa 30 dias antes de vencer —
 * certificado vencido para a emissão da loja inteira de um dia para o outro.
 */
export default function CertificadoA1({ certificado, temPerfil, onEnviado }: {
  certificado: CertificadoDaLoja | null;
  temPerfil: boolean;
  onEnviado: () => void;
}) {
  const token = useAuthStore((s) => s.token) ?? undefined;
  const [emissor, setEmissor] = useState<Emissor | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    if (!token) return;
    // Sem a capacidade, a seção explica que não há emissor — não é falha que esconde dado.
    api<Emissor>('/fiscal/emissor', { token }).then(setEmissor).catch(() => setEmissor(null));
  }, [token]);

  async function enviar() {
    if (!arquivo) return;
    setEnviando(true);
    setErro('');
    setOk('');
    try {
      const arquivoBase64 = await lerComoBase64(arquivo);
      await api('/fiscal/certificado', {
        token, method: 'POST', body: JSON.stringify({ arquivoBase64, senha }),
      });
      setSenha('');
      setArquivo(null);
      setOk('Certificado enviado ao emissor.');
      onEnviado();
    } catch (e) {
      setErro(textoDoErro(e));
    } finally {
      setEnviando(false);
    }
  }

  if (emissor && !emissor.disponivel) {
    return (
      <p className="text-sm text-slate-500">
        A emissão pelo AutoConnect não está ligada nesta instalação — não há para onde enviar o certificado.
      </p>
    );
  }

  const validoAte = certificado?.validoAte ? new Date(certificado.validoAte) : null;
  const diasRestantes = validoAte ? Math.floor((validoAte.getTime() - Date.now()) / DIA) : null;

  return (
    <div className="space-y-3">
      {certificado ? (
        <p className={`text-sm flex items-center gap-1.5 ${diasRestantes !== null && diasRestantes < 30
          ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {diasRestantes !== null && diasRestantes < 30 ? <TriangleAlert size={14} /> : <KeyRound size={14} />}
          {diasRestantes !== null && diasRestantes < 0
            ? `Certificado vencido em ${validoAte!.toLocaleDateString('pt-BR')}: a emissão para até enviar um novo.`
            : `Certificado do CNPJ ${certificado.cnpj ?? '—'}, válido até ${validoAte?.toLocaleDateString('pt-BR') ?? '—'}`
              + (diasRestantes !== null && diasRestantes < 30 ? ` — vence em ${diasRestantes} dia(s).` : '.')}
        </p>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {emissor?.exigeCertificado
            ? 'Nenhum certificado enviado. O emissor só emite a nota da loja com o certificado A1 dela.'
            : 'Nenhum certificado enviado.'}
        </p>
      )}
      <p className="text-xs text-slate-500">
        O arquivo (.pfx ou .p12) e a senha vão direto ao emissor{emissor?.provedor ? ` (${emissor.provedor})` : ''}.
        O AutoConnect não guarda nenhum dos dois — só a validade, para avisar antes de vencer.
      </p>

      {!temPerfil ? (
        <p className="text-xs text-slate-500">Salve o regime tributário primeiro.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] items-end">
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Arquivo do certificado</span>
            <input
              type="file" accept=".pfx,.p12,application/x-pkcs12"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-600 dark:text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:px-3 file:py-2 file:text-xs"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Senha do certificado</span>
            <input
              type="password" autoComplete="off" value={senha} onChange={(e) => setSenha(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </label>
          <button
            type="button" onClick={enviar} disabled={enviando || !arquivo || !senha}
            className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {enviando ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {certificado ? 'Trocar certificado' : 'Enviar certificado'}
          </button>
        </div>
      )}
      {erro && <p className="text-xs text-rose-600 dark:text-rose-400">{erro}</p>}
      {ok && <p className="text-xs text-emerald-600">{ok}</p>}
    </div>
  );
}
