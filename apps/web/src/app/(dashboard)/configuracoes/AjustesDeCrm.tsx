'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { SLA_MINUTOS_MAX, SLA_MINUTOS_MIN } from '@autoconnect/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ErroAoCarregar, textoDoErro } from '@/components/ErroAoCarregar';

export interface AjustesDeCrmDto {
  rodizioAtivo: boolean;
  rodizioIncluiGerentes: boolean;
  slaPrimeiroContatoMinutos: number;
  slaDevolveParaFila: boolean;
  vendedorVeTodosOsLeads: boolean;
}

/** Interruptor com rótulo e explicação — o padrão da tela de configurações. */
function Interruptor({
  titulo, descricao, ligado, onChange, desabilitado,
}: {
  titulo: string;
  descricao: string;
  ligado: boolean;
  onChange: (v: boolean) => void;
  desabilitado?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{titulo}</p>
        <p className="text-xs text-slate-500 mt-0.5">{descricao}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={titulo}
        disabled={desabilitado}
        onClick={() => onChange(!ligado)}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50
          ${ligado ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow
                          transition-transform ${ligado ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

/**
 * Distribuição de leads, prazo de primeiro contato e carteira do vendedor.
 *
 * Seção própria e rota própria (`/crm/settings`), e não parte do `PATCH
 * /tenant/me`: a mesma linha guarda o ponteiro do rodízio, travado a cada lead
 * que chega.
 *
 * Salva **na hora** em cada interruptor, sem botão: são cinco ajustes
 * independentes, e um "Salvar" único faria o gerente que só queria pausar o
 * rodízio confirmar também o prazo que estava editando.
 */
export function AjustesDeCrm() {
  const token = useAuthStore((s) => s.token);

  const [ajustes, setAjustes] = useState<AjustesDeCrmDto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroAoSalvar, setErroAoSalvar] = useState('');
  const [minutos, setMinutos] = useState('');

  const carregar = useCallback(() => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    api<AjustesDeCrmDto>('/crm/settings', { token })
      .then((a) => {
        setAjustes(a);
        setMinutos(String(a.slaPrimeiroContatoMinutos));
      })
      // Sem os valores reais os interruptores mostrariam o padrão, e um clique
      // salvaria esse padrão por cima da configuração da loja.
      .catch(setErro)
      .finally(() => setCarregando(false));
  }, [token]);

  useEffect(() => { carregar(); }, [carregar]);

  async function salvar(patch: Partial<AjustesDeCrmDto>) {
    if (!token || !ajustes) return;
    setSalvando(true);
    setErroAoSalvar('');
    const anterior = ajustes;
    setAjustes({ ...ajustes, ...patch });
    try {
      const atualizado = await api<AjustesDeCrmDto>('/crm/settings', {
        method: 'PATCH', token, body: patch,
      });
      setAjustes(atualizado);
      setMinutos(String(atualizado.slaPrimeiroContatoMinutos));
    } catch (e) {
      // Devolve o interruptor ao que estava: deixá-lo na posição nova faria a
      // tela afirmar uma configuração que o banco não tem.
      setAjustes(anterior);
      setMinutos(String(anterior.slaPrimeiroContatoMinutos));
      setErroAoSalvar(textoDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
        <Loader2 size={14} className="animate-spin" /> Carregando os ajustes…
      </div>
    );
  }

  if (erro || !ajustes) {
    return (
      <ErroAoCarregar
        erro={erro}
        onTentarNovamente={carregar}
        carregando={carregando}
        contexto="os ajustes de CRM"
      />
    );
  }

  return (
    <div className="space-y-5">
      {erroAoSalvar && (
        <p role="alert" className="text-xs rounded-lg bg-rose-50 dark:bg-rose-950/30
                                   border border-rose-200 dark:border-rose-900/40
                                   text-rose-700 dark:text-rose-300 px-3 py-2">
          Não foi possível salvar: {erroAoSalvar}
        </p>
      )}

      <Interruptor
        titulo="Distribuir leads automaticamente"
        descricao="O lead que chega vai para o próximo vendedor de plantão, em rodízio. Sem ninguém de plantão, ele fica na fila."
        ligado={ajustes.rodizioAtivo}
        desabilitado={salvando}
        onChange={(v) => salvar({ rodizioAtivo: v })}
      />

      <Interruptor
        titulo="Gerentes e administradores no rodízio"
        descricao="Por padrão só vendedores recebem. Ligue se quem administra a loja também atende."
        ligado={ajustes.rodizioIncluiGerentes}
        desabilitado={salvando || !ajustes.rodizioAtivo}
        onChange={(v) => salvar({ rodizioIncluiGerentes: v })}
      />

      <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
        <label
          htmlFor="sla-minutos"
          className="block text-sm font-medium text-slate-800 dark:text-slate-200"
        >
          Prazo de primeiro contato
        </label>
        <p className="text-xs text-slate-500 mt-0.5 mb-2">
          Minutos de <strong>expediente</strong> para falar com quem acabou de chegar. O
          relógio só corre no horário de funcionamento da filial: um lead que entra às 23h
          de sábado começa a contar na próxima abertura.
        </p>
        <div className="flex items-center gap-2">
          <input
            id="sla-minutos"
            type="number"
            inputMode="numeric"
            min={SLA_MINUTOS_MIN}
            max={SLA_MINUTOS_MAX}
            value={minutos}
            disabled={salvando}
            onChange={(e) => setMinutos(e.target.value)}
            className="w-24 rounded-xl border border-slate-200 dark:border-slate-700
                       bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none
                       focus:ring-2 focus:ring-blue-500/30"
          />
          <span className="text-sm text-slate-500">minutos</span>
          <button
            type="button"
            disabled={salvando || Number(minutos) === ajustes.slaPrimeiroContatoMinutos}
            onClick={() => salvar({ slaPrimeiroContatoMinutos: Number(minutos) })}
            className="ml-auto px-3 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white
                       hover:bg-blue-700 transition disabled:opacity-40"
          >
            {salvando ? <Loader2 size={13} className="animate-spin" /> : 'Salvar prazo'}
          </button>
        </div>
      </div>

      <Interruptor
        titulo="Devolver à fila quando o prazo estourar"
        descricao="Desligado por padrão: tirar o lead de um vendedor é decisão de gestão. O gerente é avisado do estouro de qualquer forma."
        ligado={ajustes.slaDevolveParaFila}
        desabilitado={salvando}
        onChange={(v) => salvar({ slaDevolveParaFila: v })}
      />

      <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
        <Interruptor
          titulo="Vendedor vê todos os leads da loja"
          descricao="Desligue para que cada vendedor veja só os próprios leads e os que estão na fila. Gerente e administrador continuam vendo tudo."
          ligado={ajustes.vendedorVeTodosOsLeads}
          desabilitado={salvando}
          onChange={(v) => salvar({ vendedorVeTodosOsLeads: v })}
        />
      </div>

      <p className="flex items-start gap-1.5 text-xs text-slate-400">
        <Users size={13} className="shrink-0 mt-0.5" />
        O plantão de cada vendedor fica na tela da equipe.
      </p>
    </div>
  );
}
