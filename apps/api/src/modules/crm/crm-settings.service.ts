import { Injectable } from '@nestjs/common';
import { SLA_PADRAO_MINUTOS, type UpdateCrmSettingsInput } from '@autoconnect/shared';
import type { ScopedClient } from '../../common/prisma/prisma.service';

/**
 * Ajustes de CRM da loja: rodízio, prazo de primeiro contato e carteira.
 *
 * Os valores são os mesmos `DEFAULT` das colunas, repetidos aqui porque a
 * linha é criada **sob demanda**: loja que nunca abriu a tela de configuração
 * não tem linha nenhuma, e o código precisa responder sem inventar um INSERT
 * em toda leitura.
 */
export interface AjustesDeCrm {
  rodizioAtivo: boolean;
  rodizioIncluiGerentes: boolean;
  slaPrimeiroContatoMinutos: number;
  slaDevolveParaFila: boolean;
  vendedorVeTodosOsLeads: boolean;
  rodizioUltimoUsuarioId: string | null;
}

export const AJUSTES_PADRAO: AjustesDeCrm = {
  rodizioAtivo: true,
  rodizioIncluiGerentes: false,
  slaPrimeiroContatoMinutos: SLA_PADRAO_MINUTOS,
  slaDevolveParaFila: false,
  // **Ligado** de propósito: é o comportamento que a loja já tem hoje, e uma
  // atualização que esconde metade dos leads de quem está atendendo seria um
  // chamado de suporte na primeira segunda-feira.
  vendedorVeTodosOsLeads: true,
  rodizioUltimoUsuarioId: null,
};

/** Forma crua da linha, como o `SELECT … FOR UPDATE` a devolve. */
interface LinhaCrua {
  rodizio_ativo: boolean;
  rodizio_inclui_gerentes: boolean;
  sla_primeiro_contato_minutos: number;
  sla_devolve_para_fila: boolean;
  vendedor_ve_todos_os_leads: boolean;
  rodizio_ultimo_usuario_id: string | null;
}

@Injectable()
export class CrmSettingsService {
  /**
   * Lê os ajustes da loja, caindo no padrão quando ainda não há linha.
   *
   * Recebe o `tx` em vez de abrir o próprio: quem chama já está dentro de um
   * `withTenant`, e é ele que define `app.tenant_id` para a policy.
   */
  async ler(tx: ScopedClient, tenantId: string): Promise<AjustesDeCrm> {
    const linha = await tx.tenantCrmSettings.findUnique({ where: { tenantId } });
    if (!linha) return { ...AJUSTES_PADRAO };

    return {
      rodizioAtivo: linha.rodizioAtivo,
      rodizioIncluiGerentes: linha.rodizioIncluiGerentes,
      slaPrimeiroContatoMinutos: linha.slaPrimeiroContatoMinutos,
      slaDevolveParaFila: linha.slaDevolveParaFila,
      vendedorVeTodosOsLeads: linha.vendedorVeTodosOsLeads,
      rodizioUltimoUsuarioId: linha.rodizioUltimoUsuarioId,
    };
  }

  /**
   * Lê os ajustes **travando a linha** até o fim da transação.
   *
   * É o coração da concorrência do rodízio. Dois leads que chegam no mesmo
   * instante entram aqui: o primeiro trava a linha, escolhe o vendedor, grava
   * o ponteiro e confirma; o segundo fica bloqueado no `FOR UPDATE` e só então
   * lê o ponteiro **já atualizado**. Sem isso os dois leriam o mesmo ponteiro e
   * cairiam no mesmo vendedor — que é o defeito clássico de rodízio feito em
   * memória de processo, e que nem aparece numa máquina só.
   *
   * O `INSERT … ON CONFLICT DO NOTHING` antes do `SELECT` faz a linha existir
   * para ser travada, e ele próprio serializa: o segundo INSERT concorrente
   * espera no índice único e depois não faz nada.
   */
  async lerTravando(tx: ScopedClient, tenantId: string): Promise<AjustesDeCrm> {
    await tx.$executeRaw`
      INSERT INTO tenant_crm_settings (tenant_id, updated_at)
      VALUES (${tenantId}::uuid, now())
      ON CONFLICT (tenant_id) DO NOTHING`;

    const linhas = await tx.$queryRaw<LinhaCrua[]>`
      SELECT rodizio_ativo, rodizio_inclui_gerentes, sla_primeiro_contato_minutos,
             sla_devolve_para_fila, vendedor_ve_todos_os_leads,
             rodizio_ultimo_usuario_id
        FROM tenant_crm_settings
       WHERE tenant_id = ${tenantId}::uuid
         FOR UPDATE`;

    const linha = linhas[0];
    // Sem linha depois do INSERT só acontece se a policy de RLS recusar a
    // leitura — ou seja, contexto de tenant errado. Cair no padrão aqui seria
    // seguir em frente com o ponteiro zerado; melhor entregar o padrão sem
    // ponteiro e deixar o rodízio escolher por carga.
    if (!linha) return { ...AJUSTES_PADRAO };

    return {
      rodizioAtivo: linha.rodizio_ativo,
      rodizioIncluiGerentes: linha.rodizio_inclui_gerentes,
      slaPrimeiroContatoMinutos: linha.sla_primeiro_contato_minutos,
      slaDevolveParaFila: linha.sla_devolve_para_fila,
      vendedorVeTodosOsLeads: linha.vendedor_ve_todos_os_leads,
      rodizioUltimoUsuarioId: linha.rodizio_ultimo_usuario_id,
    };
  }

  /** Move o ponteiro do rodízio. Só faz sentido com a linha já travada. */
  async guardarPonteiro(
    tx: ScopedClient,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    await tx.tenantCrmSettings.update({
      where: { tenantId },
      data: { rodizioUltimoUsuarioId: userId, rodizioAtualizadoEm: new Date() },
    });
  }

  /** Grava o que a tela de configuração mandou, criando a linha se faltar. */
  async salvar(
    tx: ScopedClient,
    tenantId: string,
    input: UpdateCrmSettingsInput,
  ): Promise<AjustesDeCrm> {
    const linha = await tx.tenantCrmSettings.upsert({
      where: { tenantId },
      update: input,
      create: { tenantId, ...AJUSTES_PADRAO, ...input },
    });

    return {
      rodizioAtivo: linha.rodizioAtivo,
      rodizioIncluiGerentes: linha.rodizioIncluiGerentes,
      slaPrimeiroContatoMinutos: linha.slaPrimeiroContatoMinutos,
      slaDevolveParaFila: linha.slaDevolveParaFila,
      vendedorVeTodosOsLeads: linha.vendedorVeTodosOsLeads,
      rodizioUltimoUsuarioId: linha.rodizioUltimoUsuarioId,
    };
  }
}
