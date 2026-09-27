'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { baixarArquivo } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { textoDoErro } from '@/components/ErroAoCarregar';

/**
 * Levar os dados da loja embora.
 *
 * A LGPD dá ao titular o direito à portabilidade e o termo do programa de
 * fundadores promete o mesmo à loja. Os quatro primeiros arquivos já existiam,
 * espalhados por `/leads` e `/relatorios`; os três últimos não tinham como sair
 * — e é em agendamento, conversa e mensagem que mora o histórico de
 * atendimento. Ficam juntos aqui porque "levar meus dados" é uma ação só, não
 * uma caça a botões em três telas.
 *
 * O recorte é o mesmo do resto do painel: vendedor leva a carteira dele,
 * gerência leva a loja inteira. Quem filtra é a API.
 */
const EXPORTACOES: { chave: string; rotulo: string; descricao: string; rota: string; arquivo: string }[] = [
  {
    chave: 'leads',
    rotulo: 'Leads',
    descricao: 'Contato, origem, status e o texto do consentimento aceito.',
    rota: '/leads/export/csv',
    arquivo: 'leads.csv',
  },
  {
    chave: 'agendamentos',
    rotulo: 'Agendamentos',
    descricao: 'Visitas e test drives, com o contato de quem agendou sem conta.',
    rota: '/tenant/reports/appointments.csv?days=3660',
    arquivo: 'agendamentos.csv',
  },
  {
    chave: 'conversas',
    rotulo: 'Conversas',
    descricao: 'Uma linha por conversa, com o número de mensagens.',
    rota: '/tenant/reports/conversations.csv?days=3660',
    arquivo: 'conversas.csv',
  },
  {
    chave: 'mensagens',
    rotulo: 'Mensagens',
    descricao: 'O conteúdo do atendimento, uma linha por mensagem.',
    rota: '/tenant/reports/messages.csv?days=3660',
    arquivo: 'mensagens.csv',
  },
  {
    chave: 'negocios',
    rotulo: 'Negócios',
    descricao: 'Valores, desconto e margem dos últimos 12 meses.',
    rota: '/tenant/reports/deals.csv?days=366',
    arquivo: 'negocios.csv',
  },
  {
    chave: 'estoque',
    rotulo: 'Estoque',
    descricao: 'Veículos não vendidos, com custo e dias em estoque.',
    rota: '/tenant/reports/inventory.csv',
    arquivo: 'estoque.csv',
  },
  {
    chave: 'desempenho',
    rotulo: 'Desempenho da equipe',
    descricao: 'Leads, agendamentos, negócios e comissão por vendedor.',
    rota: '/tenant/reports/salespeople.csv?days=366',
    arquivo: 'desempenho.csv',
  },
];

export default function ExportarDados() {
  const { token } = useAuthStore();
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function baixar(chave: string, rota: string, arquivo: string) {
    setBaixando(chave);
    setErro(null);
    try {
      await baixarArquivo(rota, arquivo, token ?? undefined);
    } catch (e) {
      // Erro de download aparece aqui, não no console: quem clicou está esperando.
      setErro(textoDoErro(e));
    } finally {
      setBaixando(null);
    }
  }

  return (
    <>
      <p className="text-sm text-slate-500">
        Cada arquivo sai em CSV com acentuação para o Excel. São os dados desta loja: nada de
        outra concessionária entra neles.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {EXPORTACOES.map((e) => (
          <button
            key={e.chave}
            onClick={() => void baixar(e.chave, e.rota, e.arquivo)}
            disabled={baixando !== null}
            className="flex items-start gap-3 text-left p-3 rounded-xl border
                       border-slate-200 dark:border-slate-800 hover:border-blue-400
                       disabled:opacity-40 transition"
          >
            <span className="mt-0.5 text-blue-600 dark:text-blue-400">
              {baixando === e.chave
                ? <Loader2 size={15} className="animate-spin" />
                : <Download size={15} />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                {e.rotulo}
              </span>
              <span className="block text-xs text-slate-500 mt-0.5">{e.descricao}</span>
            </span>
          </button>
        ))}
      </div>

      {erro && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-500/10 border
                      border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
          Não foi possível baixar o arquivo: {erro}
        </p>
      )}

      <p className="text-[11px] text-slate-400">
        Exportação grande sai nas 5.000 linhas mais recentes, e o próprio arquivo diz na última
        linha quando cortou — reduza o período para levar o resto.
      </p>
    </>
  );
}
