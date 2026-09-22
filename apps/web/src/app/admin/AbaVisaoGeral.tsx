'use client';

import {
  Building2, TrendingUp, Users, Car, UserCheck, Ticket, Ban, MessagesSquare,
  Banknote, CalendarRange, Handshake, FileSignature, SearchCheck,
} from 'lucide-react';
import {
  ROTULO_ASSINATURA_EXTERNA, ASSINATURA_EXTERNA_STATUSES, deCentavos, formatarBRL,
} from '@autoconnect/shared';
import { ErroAoCarregar } from '@/components/ErroAoCarregar';
import { Carregando, Secao, StatCard, cartaoCls, useCarga, type PropsDaAba } from './comum';
import type { Stats } from './tipos';

const brlDeCentavos = (c: number) => formatarBRL(deCentavos(BigInt(c)));

export function AbaVisaoGeral({ chamar, sinal }: PropsDaAba) {
  const { dados: s, erro, carregando, recarregar } = useCarga(() => chamar<Stats>('/admin/stats'), sinal);

  if (erro) return <ErroAoCarregar erro={erro} onTentarNovamente={recarregar} carregando={carregando} contexto="os indicadores" />;
  if (!s) return <Carregando />;

  const mes = new Date(s.monthStartsAt).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'America/Sao_Paulo' });
  const consultas = s.vehicleQueries;
  const assinaturas = ASSINATURA_EXTERNA_STATUSES.filter((st) => (s.externalSignatures[st] ?? 0) > 0);

  return (
    <div className="space-y-8">
      <Secao titulo="Vendas na plataforma">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label="Faturado — últimos 30 dias" icon={Banknote}
            value={formatarBRL(s.revenue.last30d.gmv)} dinheiro
            accent="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600"
            sub={`${s.revenue.last30d.count} negócio(s) · margem ${formatarBRL(s.revenue.last30d.margin)}`}
          />
          <StatCard
            label={`Faturado em ${mes}`} icon={CalendarRange}
            value={formatarBRL(s.revenue.monthToDate.gmv)} dinheiro
            accent="bg-blue-50 dark:bg-blue-500/10 text-blue-600"
            sub={`${s.revenue.monthToDate.count} negócio(s) · margem ${formatarBRL(s.revenue.monthToDate.margin)}`}
          />
          <StatCard
            label="Negócios abertos" icon={Handshake} value={s.deals.open}
            accent="bg-purple-50 dark:bg-purple-500/10 text-purple-600"
            sub={`${s.deals.won} faturados · ${s.deals.canceled} cancelados/distratados`}
          />
          <StatCard
            label="Contratos assinados" icon={FileSignature} value={s.contracts.signed}
            accent="bg-slate-100 dark:bg-slate-800 text-slate-500"
            sub={`${s.contracts.signedInternal} no sistema · ${s.contracts.signedExternal} eletrônica · ${s.contracts.issued} emitidos`}
          />
        </div>
        <p className="text-[11px] text-slate-400">
          Faturado = negócio em faturado, documentação ou entregue, pela data de fechamento — a mesma regra
          do relatório de margem de cada loja.
        </p>
      </Secao>

      <Secao titulo="Custo para a plataforma">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            destaque
            label={`Consulta veicular em ${mes} — pago ao fornecedor`} icon={SearchCheck}
            value={brlDeCentavos(consultas.month.spendCents)} dinheiro
            accent="bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400"
            sub={
              <>
                {consultas.month.count} consulta(s) · {consultas.month.failed} com falha (também cobradas)
                <br />
                Fornecedor: {consultas.provider === 'nenhum' ? 'nenhum configurado' : consultas.provider}
                {consultas.unitCostCents > 0 && ` · ${brlDeCentavos(consultas.unitCostCents)} por chamada`}
              </>
            }
          />
          <div className={`${cartaoCls} p-4 sm:p-5 min-w-0 sm:col-span-1 xl:col-span-3`}>
            <p className="text-xs font-medium text-slate-500 mb-3">Assinatura eletrônica — envios por situação</p>
            {assinaturas.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum envio ao provedor até agora.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {assinaturas.map((st) => (
                  <span key={st} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800">
                    <span className="font-bold text-slate-900 dark:text-white">{s.externalSignatures[st]}</span>
                    <span className="text-slate-500">{ROTULO_ASSINATURA_EXTERNA[st]}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </Secao>

      <Secao titulo="Uso">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label="Concessionárias" value={s.totalTenants} icon={Building2}
            accent="bg-blue-50 dark:bg-blue-500/10 text-blue-600"
            sub={`${s.activeTenants} ativas · ${s.newTenantsMonth} novas em 30 dias`} />
          <StatCard label="Trial / Pagas" value={`${s.trialTenants} / ${s.paidTenants}`}
            icon={TrendingUp} accent="bg-purple-50 dark:bg-purple-500/10 text-purple-600" />
          <StatCard label="Usuários" value={s.totalUsers} icon={Users}
            accent="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600" />
          <StatCard label="Veículos" value={s.totalVehicles} icon={Car}
            accent="bg-amber-50 dark:bg-amber-500/10 text-amber-600" />
          <StatCard label="Leads" value={s.totalLeads} icon={UserCheck}
            accent="bg-rose-50 dark:bg-rose-500/10 text-rose-600"
            sub={`${s.totalLeadsNew} aguardando resposta`} />
          <StatCard label="Conversas abertas" value={s.openConversations} icon={MessagesSquare}
            accent="bg-sky-50 dark:bg-sky-500/10 text-sky-600" />
          <StatCard label="Convites ativos" value={s.activeInvites} icon={Ticket}
            accent="bg-slate-100 dark:bg-slate-800 text-slate-500" />
          <StatCard label="Lojas inativas" value={s.inactiveTenants} icon={Ban}
            accent="bg-slate-100 dark:bg-slate-800 text-slate-500" />
        </div>
      </Secao>
    </div>
  );
}
