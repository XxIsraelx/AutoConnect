'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, BarChart,
  CartesianGrid, XAxis, YAxis, Tooltip, Cell, Legend,
} from 'recharts';
import { Wallet, Timer, Search } from 'lucide-react';
import { formatarBRL, ROTULO_CONSULTA, type TipoConsulta } from '@autoconnect/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';

interface LinhaMargem {
  periodo: string;
  negocios: number;
  venda: string;
  custo: string;
  margem: string;
}

interface GastoConsultas {
  totalCentavos: number;
  chamadas: number;
  falhas: number;
  porTipo: { tipo: string; chamadas: number; centavos: number }[];
}

interface LinhaEstoque {
  vehicleId: string;
  descricao: string;
  totalCost: string;
  temAquisicao: boolean;
  daysInStock: number;
}

const CARTAO =
  'bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5';

/** Eixo de dinheiro em milhares — "R$ 128.000,00" por tick não caberia. */
const emMil = (v: number) => `${Math.round(v / 1000)}k`;

const mes = (p: string) => {
  const [ano, m] = p.split('-');
  return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(m) - 1]}/${ano.slice(2)}`;
};

/**
 * Os dois gráficos de venda do plano: margem por período e giro de estoque.
 *
 * Ambos usam recharts com o mesmo estilo dos gráficos que já existiam nesta
 * tela — grid tracejada, eixos sem linha, tooltip de 12px.
 */
export default function GraficosDeVenda() {
  const token = useAuthStore((s) => s.token) ?? undefined;

  const margem = useQuery({
    queryKey: ['relatorio-margem'],
    queryFn: () => api<LinhaMargem[]>('/tenant/reports/margin', { token }),
    enabled: Boolean(token),
    retry: false,
  });

  const estoque = useQuery({
    queryKey: ['relatorio-estoque'],
    queryFn: () => api<LinhaEstoque[]>('/tenant/reports/inventory', { token }),
    enabled: Boolean(token),
    retry: false,
  });

  const gasto = useQuery({
    queryKey: ['relatorio-gasto-consultas'],
    queryFn: () => api<GastoConsultas>('/tenant/reports/query-spend', { token }),
    enabled: Boolean(token),
    retry: false,
  });

  const dadosMargem = (margem.data ?? []).map((l) => ({
    ...l,
    label: mes(l.periodo),
    vendaN: Number(l.venda),
    custoN: Number(l.custo),
    margemN: Number(l.margem),
  }));

  // Os mais parados primeiro: é neles que o dinheiro está preso.
  const dadosEstoque = [...(estoque.data ?? [])]
    .sort((a, b) => b.daysInStock - a.daysInStock)
    .slice(0, 12)
    .map((v) => ({ ...v, curto: v.descricao.length > 22 ? `${v.descricao.slice(0, 22)}…` : v.descricao }));

  const mediaDias = dadosEstoque.length
    ? Math.round(dadosEstoque.reduce((a, v) => a + v.daysInStock, 0) / dadosEstoque.length)
    : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Margem por período */}
      <div className={CARTAO}>
        <div className="flex items-center gap-2 mb-4">
          <Wallet size={15} className="text-emerald-500" />
          <h2 className="text-sm font-semibold">Margem por mês</h2>
        </div>

        {margem.error ? (
          <ErroAoCarregar
            erro={margem.error}
            onTentarNovamente={() => void margem.refetch()}
            carregando={margem.isFetching}
            contexto="a margem"
          />
        ) : margem.isLoading ? (
          <div className="h-[220px] rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
        ) : dadosMargem.length === 0 ? (
          <p className="text-sm text-slate-500 py-16 text-center">
            Nenhum negócio faturado ainda. A margem aparece quando o primeiro for.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={dadosMargem} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-100 dark:text-slate-800" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={emMil} />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(v, nome) => [formatarBRL(Number(v).toFixed(2)), String(nome)]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="vendaN" name="Venda" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="custoN" name="Custo" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="margemN" name="Margem" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Gasto com consultas — o plano trata isto como requisito, não enfeite:
          sem ele a loja não sabe quanto gastou em consulta no mês. */}
      {gasto.data && gasto.data.chamadas > 0 && (
        <div className={`${CARTAO} lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Search size={15} className="text-slate-400" />
              <h2 className="text-sm font-semibold">Consultas veiculares no mês</h2>
            </div>
            <span className="text-sm font-bold">
              {formatarBRL((gasto.data.totalCentavos / 100).toFixed(2))}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
            <span>{gasto.data.chamadas} chamadas</span>
            {gasto.data.falhas > 0 && (
              // Falha é cobrada pelo fornecedor: aparece separada para a loja
              // saber quanto gastou sem receber resposta.
              <span className="text-amber-600 dark:text-amber-400">
                {gasto.data.falhas} sem resposta
              </span>
            )}
            {gasto.data.porTipo.map((t) => (
              <span key={t.tipo}>
                {ROTULO_CONSULTA[t.tipo as TipoConsulta] ?? t.tipo}: {t.chamadas}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Giro de estoque */}
      <div className={CARTAO}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Timer size={15} className="text-amber-500" />
            <h2 className="text-sm font-semibold">Dias em estoque</h2>
          </div>
          {dadosEstoque.length > 0 && (
            <span className="text-xs text-slate-500">média {mediaDias} dias</span>
          )}
        </div>

        {estoque.error ? (
          <ErroAoCarregar
            erro={estoque.error}
            onTentarNovamente={() => void estoque.refetch()}
            carregando={estoque.isFetching}
            contexto="o giro de estoque"
          />
        ) : estoque.isLoading ? (
          <div className="h-[220px] rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
        ) : dadosEstoque.length === 0 ? (
          <p className="text-sm text-slate-500 py-16 text-center">Nenhum veículo no estoque.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dadosEstoque} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-100 dark:text-slate-800" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="curto" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={110} />
              <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => [`${Number(v)} dias`, 'Em estoque']} />
              <Bar dataKey="daysInStock" name="Dias" radius={[0, 4, 4, 0]}>
                {dadosEstoque.map((v) => (
                  // A cor é o alerta: 90 dias parado é dinheiro preso.
                  <Cell
                    key={v.vehicleId}
                    fill={v.daysInStock >= 90 ? '#f43f5e' : v.daysInStock >= 60 ? '#f59e0b' : '#3b82f6'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
