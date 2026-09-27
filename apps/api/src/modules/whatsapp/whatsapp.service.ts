import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@autoconnect/db';
import {
  MODELOS_DE_WHATSAPP,
  ROTULO_DO_FORMATO,
  chaveDoEventoDeWhatsApp,
  contatoDoWhatsApp,
  ehCelularBr,
  enderecoDoWhatsApp,
  janelaDeAtendimentoAberta,
  normalizarTelefoneBr,
  renderizarModelo,
  statusDeEntregaAvanca,
  type CabecalhosDeWhatsApp,
  type ChaveDoModelo,
  type ConectarWhatsAppInput,
  type EventoDeWhatsApp,
  type MensagemRecebidaDoWhatsApp,
  type ProvedorDeWhatsApp,
  type StatusDeEntrega,
  type StatusDoWhatsApp,
} from '@autoconnect/shared';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { ChatEventosService } from '../../gateway/chat-eventos.service';
import { LeadsService, type AvisoDeLeadNovo } from '../leads/leads.service';
import { carteiraDe, type Ator } from '../leads/carteira';
import { CrmSettingsService } from '../crm/crm-settings.service';
import { SlaService } from '../crm/sla.service';
import { sha256Hex } from '../contracts/assinatura/hmac';
import { PROVEDOR_DE_WHATSAPP } from './provedor';
import { ProvedorSimuladoDeWhatsApp } from './provedor-simulado';
import { RecusaDoWhatsApp } from './recusa';
import { PushService } from '../users/push/push.service';

/** O mesmo `include` do gateway: a tela recebe a mensagem num formato só. */
const COM_REMETENTE = {
  sender: { select: { id: true, fullName: true, avatarUrl: true } },
} as const;

/** O que o envio precisa saber da conversa. */
const PARA_ENVIAR = {
  id: true,
  status: true,
  channel: true,
  contactName: true,
  contactPhoneNormalized: true,
  externalContactId: true,
  customerLastMessageAt: true,
  salespersonId: true,
  whatsappAccount: { select: { externalId: true, active: true, provider: true } },
  lead: { select: { id: true, contactName: true, firstRespondedAt: true } },
  vehicle: {
    select: {
      versionName: true, yearModel: true,
      brand: { select: { name: true } }, model: { select: { name: true } },
    },
  },
} as const;

type ConversaParaEnviar = Prisma.ConversationGetPayload<{ select: typeof PARA_ENVIAR }>;
type MensagemComRemetente = Prisma.MessageGetPayload<{ include: typeof COM_REMETENTE }>;

export interface CapacidadeDoWhatsApp {
  disponivel: boolean;
  provedor: string;
  simulado: boolean;
  conta: { id: string; numero: string; conectadaEm: Date } | null;
}

function primeiroNome(nome: string | null | undefined): string | null {
  return nome?.trim().split(/\s+/)[0] || null;
}

function ehUnicidade(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * WhatsApp oficial: o número da loja, a caixa de entrada e o envio.
 *
 * O fluxo, nos dois sentidos:
 *
 *  - **entrada** (`receberWebhook`): confere a assinatura → acha a loja pelo id
 *    do número (o único passo privilegiado) → um evento por transação, dentro
 *    de `withTenant`: grava o evento (idempotência) → acha ou cria o lead
 *    (pelo mesmo caminho do formulário público) → acha ou abre a conversa →
 *    grava a mensagem;
 *  - **saída** (`enviarTexto`, `enviarModelo`): grava a mensagem como
 *    `enviando` → avisa a tela → chama o provedor **fora** da transação → grava
 *    o id externo ou a recusa. O provedor fora do ar não prende uma transação
 *    aberta, e a mensagem nunca some: ou sai, ou fica `falhou` com o motivo.
 *
 * O porquê de cada regra: `docs/decisoes/2026-09-27 whatsapp oficial.md`.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    /**
     * Um uso só: achar a loja pelo id do número, na entrada do webhook — antes
     * disso não existe contexto. Mesmo desenho do webhook de assinatura.
     */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly config: ConfigService,
    @Inject(PROVEDOR_DE_WHATSAPP)
    private readonly provedor: ProvedorDeWhatsApp,
    private readonly eventos: ChatEventosService,
    private readonly leads: LeadsService,
    private readonly ajustes: CrmSettingsService,
    private readonly sla: SlaService,
    private readonly push: PushService,
  ) {}

  get simulado(): boolean {
    return this.provedor instanceof ProvedorSimuladoDeWhatsApp &&
      this.config.get<string>('NODE_ENV') !== 'production';
  }

  private exigirProvedor(): void {
    if (!this.provedor.disponivel) {
      throw new ServiceUnavailableException(
        'O WhatsApp oficial não está configurado neste servidor.',
      );
    }
  }

  /* ── O número da loja ─────────────────────────────────────── */

  async capacidade(tenantId: string): Promise<CapacidadeDoWhatsApp> {
    const conta = this.provedor.disponivel
      ? await this.prisma.withTenant(tenantId, (tx) =>
          tx.whatsappAccount.findFirst({
            where: { tenantId, active: true, provider: this.provedor.nome },
            select: { id: true, displayPhone: true, connectedAt: true },
          }),
        )
      : null;

    return {
      disponivel: this.provedor.disponivel,
      provedor: this.provedor.nome,
      simulado: this.simulado,
      conta: conta ? { id: conta.id, numero: conta.displayPhone, conectadaEm: conta.connectedAt } : null,
    };
  }

  /**
   * Conecta o número da loja. Com o provedor real, o id vem do painel da Meta
   * (ou, depois, do cadastro incorporado); com o simulado, é derivado do
   * número — estável, para que reconectar o mesmo número reative a mesma linha.
   */
  async conectar(
    tenantId: string,
    usuarioId: string,
    entrada: ConectarWhatsAppInput,
  ): Promise<CapacidadeDoWhatsApp['conta']> {
    this.exigirProvedor();
    const numero = normalizarTelefoneBr(entrada.numero);
    if (!numero) throw new BadRequestException('Informe o número do WhatsApp com DDD.');

    let idExterno = entrada.idExterno;
    if (!idExterno) {
      if (!this.simulado) {
        throw new BadRequestException(
          'Informe o id do número (phone_number_id) que aparece no painel do WhatsApp da Meta.',
        );
      }
      idExterno = `sim${numero}`;
    }
    const externalId = idExterno;

    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const ativa = await tx.whatsappAccount.findFirst({
          where: { tenantId, active: true },
          select: { id: true },
        });
        if (ativa) {
          throw new ConflictException(
            'A loja já tem um WhatsApp conectado. Desconecte o atual antes de conectar outro.',
          );
        }

        const anterior = await tx.whatsappAccount.findFirst({
          where: { tenantId, provider: this.provedor.nome, externalId },
          select: { id: true },
        });
        const conta = anterior
          ? await tx.whatsappAccount.update({
              where: { id: anterior.id },
              data: {
                active: true,
                displayPhone: numero,
                connectedBy: usuarioId,
                connectedAt: new Date(),
                disconnectedAt: null,
              },
            })
          : await tx.whatsappAccount.create({
              data: {
                tenantId,
                provider: this.provedor.nome,
                externalId,
                displayPhone: numero,
                connectedBy: usuarioId,
              },
            });
        return { id: conta.id, numero: conta.displayPhone, conectadaEm: conta.connectedAt };
      });
    } catch (err) {
      // `whatsapp_accounts_numero_ativo_idx`: o número está ativo em outra loja.
      // Sob RLS não dá para vê-la — é o índice que conta.
      if (ehUnicidade(err)) {
        throw new ConflictException('Este número de WhatsApp já está conectado a outra loja.');
      }
      throw err;
    }
  }

  /** Desconecta sem apagar: as conversas que passaram pelo número ficam. */
  async desconectar(tenantId: string): Promise<{ ok: true }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const r = await tx.whatsappAccount.updateMany({
        where: { tenantId, active: true },
        data: { active: false, disconnectedAt: new Date() },
      });
      if (r.count === 0) throw new NotFoundException('Nenhum WhatsApp conectado.');
    });
    return { ok: true };
  }

  private async contaAtiva(tx: ScopedClient, tenantId: string): Promise<{ id: string; externalId: string }> {
    const conta = await tx.whatsappAccount.findFirst({
      where: { tenantId, active: true, provider: this.provedor.nome },
      select: { id: true, externalId: true },
    });
    if (!conta) {
      throw new ConflictException('Conecte o WhatsApp da loja em Canais antes de conversar por ele.');
    }
    return conta;
  }

  /* ── Conversa aberta pela loja ────────────────────────────── */

  /**
   * Abre (ou retoma) a conversa de WhatsApp com o lead. A janela nasce fechada
   * — o cliente ainda não escreveu —, então o primeiro envio é um modelo.
   */
  async abrirConversaDoLead(
    tenantId: string,
    ator: Ator,
    leadId: string,
  ): Promise<{ id: string; criada: boolean }> {
    this.exigirProvedor();

    const abrir = () => this.prisma.withTenant(tenantId, async (tx) => {
      const conta = await this.contaAtiva(tx, tenantId);
      const ajustes = await this.ajustes.ler(tx, tenantId);
      const lead = await tx.lead.findFirst({
        where: { id: leadId, tenantId, ...carteiraDe(ator, ajustes.vendedorVeTodosOsLeads) },
        select: {
          id: true, contactName: true, contactPhone: true, contactEmail: true,
          customerUserId: true, vehicleId: true, assignedTo: true,
        },
      });
      if (!lead) throw new NotFoundException('Lead não encontrado');

      const contato = normalizarTelefoneBr(lead.contactPhone);
      if (!contato || !ehCelularBr(contato)) {
        throw new BadRequestException('Este lead não tem um celular para o WhatsApp.');
      }

      const existente = await tx.conversation.findFirst({
        where: {
          tenantId,
          channel: 'whatsapp',
          whatsappAccountId: conta.id,
          contactPhoneNormalized: contato,
          status: { not: 'closed' },
        },
        select: { id: true },
      });
      if (existente) return { id: existente.id, criada: false };

      const nova = await tx.conversation.create({
        data: {
          tenantId,
          channel: 'whatsapp',
          whatsappAccountId: conta.id,
          contactPhoneNormalized: contato,
          leadId: lead.id,
          customerUserId: lead.customerUserId,
          vehicleId: lead.vehicleId,
          salespersonId: lead.assignedTo ?? ator.id,
          contactName: lead.contactName,
          contactPhone: lead.contactPhone,
          contactEmail: lead.contactEmail,
        },
        select: { id: true },
      });
      return { id: nova.id, criada: true };
    });

    let resultado: { id: string; criada: boolean };
    try {
      resultado = await abrir();
    } catch (err) {
      // Dois cliques (ou o cliente escrevendo no mesmo instante): o índice
      // `conversations_whatsapp_viva_idx` recusou a segunda. A que ficou serve.
      if (!ehUnicidade(err)) throw err;
      resultado = await abrir();
    }

    if (resultado.criada) {
      this.eventos.emitirParaLoja(tenantId, 'conversation:updated', { conversationId: resultado.id });
    }
    return resultado;
  }

  /* ── Saída ────────────────────────────────────────────────── */

  private async conversaParaEnviar(
    tx: ScopedClient,
    tenantId: string,
    conversationId: string,
  ): Promise<ConversaParaEnviar & { whatsappAccount: NonNullable<ConversaParaEnviar['whatsappAccount']> }> {
    const conv = await tx.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: PARA_ENVIAR,
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (conv.channel !== 'whatsapp') {
      throw new BadRequestException('Esta conversa não é de WhatsApp.');
    }
    if (conv.status === 'closed') {
      throw new ConflictException('Esta conversa foi encerrada. Abra outra pelo lead.');
    }
    const conta = conv.whatsappAccount;
    if (!conta?.active || conta.provider !== this.provedor.nome) {
      throw new ConflictException(
        'O WhatsApp da loja foi desconectado. Reconecte o número em Canais para continuar.',
      );
    }
    return { ...conv, whatsappAccount: conta };
  }

  /**
   * Mensagem livre, do vendedor, dentro da janela de 24 h. Chamado pelo
   * gateway do chat: a tela escreve na conversa de WhatsApp pelo mesmo campo
   * de sempre.
   */
  async enviarTexto(
    tenantId: string,
    ator: Ator,
    conversationId: string,
    texto: string,
  ): Promise<MensagemComRemetente> {
    this.exigirProvedor();
    const corpo = texto.trim();
    if (!corpo) throw new BadRequestException('Escreva uma mensagem.');
    // Limite do WhatsApp para o corpo de texto.
    if (corpo.length > 4096) {
      throw new BadRequestException('Mensagem longa demais para o WhatsApp (até 4.096 caracteres).');
    }

    const { conv, msg } = await this.prisma.withTenant(tenantId, async (tx) => {
      const c = await this.conversaParaEnviar(tx, tenantId, conversationId);
      if (!janelaDeAtendimentoAberta(c.customerLastMessageAt)) {
        throw new ConflictException({
          message:
            'A janela de 24 horas do WhatsApp está fechada: o cliente não escreveu nas últimas 24 horas. ' +
            'Mande um modelo aprovado — quando ele responder, a conversa livre volta.',
          codigo: 'whatsapp_janela_fechada',
        });
      }
      const m = await this.gravarSaida(tx, tenantId, ator, c, { body: corpo, metadata: {} });
      return { conv: c, msg: m };
    });

    return this.despachar(tenantId, conv, msg, (para, conta) =>
      this.provedor.enviarTexto({ conta, para, texto: corpo }),
    );
  }

  /**
   * Modelo aprovado — o único envio possível fora da janela, e o primeiro
   * contato de toda conversa que a loja abre. Os parâmetros saem do lead, da
   * loja e de quem envia: a tela só escolhe o modelo, e o texto que o cliente
   * lê fica gravado na conversa.
   */
  async enviarModelo(
    tenantId: string,
    ator: Ator,
    conversationId: string,
    chave: ChaveDoModelo,
  ): Promise<MensagemComRemetente> {
    this.exigirProvedor();
    const modelo = MODELOS_DE_WHATSAPP[chave];

    const { conv, msg, parametros } = await this.prisma.withTenant(tenantId, async (tx) => {
      const c = await this.conversaParaEnviar(tx, tenantId, conversationId);
      const [loja, remetente] = await Promise.all([
        tx.tenant.findUnique({ where: { id: tenantId }, select: { tradeName: true } }),
        tx.user.findFirst({ where: { id: ator.id }, select: { fullName: true } }),
      ]);

      const cliente = primeiroNome(c.lead?.contactName ?? c.contactName);
      if (!cliente) {
        throw new BadRequestException(
          'O modelo começa pelo nome do cliente, e este contato está sem nome. Informe o nome no lead.',
        );
      }
      const veiculo = c.vehicle
        ? `${c.vehicle.brand.name} ${c.vehicle.model.name} ${c.vehicle.yearModel}`
        : 'um dos nossos veículos';

      let render: ReturnType<typeof renderizarModelo>;
      try {
        render = renderizarModelo(chave, {
          cliente,
          vendedor: primeiroNome(remetente?.fullName) ?? loja?.tradeName,
          loja: loja?.tradeName,
          veiculo,
        });
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }

      const m = await this.gravarSaida(tx, tenantId, ator, c, {
        body: render.texto,
        metadata: {
          modelo: chave,
          nomeDoModelo: modelo.nome,
          categoria: modelo.categoria,
          parametros: render.parametros,
        },
      });
      return { conv: c, msg: m, parametros: render.parametros };
    });

    return this.despachar(tenantId, conv, msg, (para, conta) =>
      this.provedor.enviarModelo({
        conta, para, modelo: modelo.nome, idioma: modelo.idioma, parametros,
      }),
    );
  }

  /**
   * Grava a mensagem de saída como `enviando`, e o que ela significa para o
   * lead. A primeira mensagem da loja numa conversa entra na timeline (é o
   * "falou com o cliente pelo WhatsApp" que o gerente procura); as seguintes,
   * não — seriam uma linha por frase. O prazo de primeiro contato para aqui,
   * pela mesma regra das demais interações de saída.
   */
  private async gravarSaida(
    tx: ScopedClient,
    tenantId: string,
    ator: Ator,
    conv: ConversaParaEnviar,
    dados: { body: string; metadata: Record<string, unknown> },
  ): Promise<MensagemComRemetente> {
    const agora = new Date();
    const anteriores = await tx.message.count({
      where: { conversationId: conv.id, senderUserId: { not: null } },
    });

    const msg = await tx.message.create({
      data: {
        conversationId: conv.id,
        tenantId,
        senderUserId: ator.id,
        kind: 'text',
        body: dados.body,
        metadata: dados.metadata as Prisma.InputJsonValue,
        deliveryStatus: 'enviando' satisfies StatusDeEntrega,
      },
      include: COM_REMETENTE,
    });

    await tx.conversation.update({
      where: { id: conv.id },
      data: {
        lastMessageAt: agora,
        // Conversa sem responsável (aberta pelo cliente, com o rodízio
        // desligado) fica com quem respondeu primeiro.
        ...(conv.salespersonId ? {} : { salespersonId: ator.id }),
      },
    });

    if (conv.lead) {
      if (anteriores === 0) {
        const modelo = typeof dados.metadata.modelo === 'string'
          ? MODELOS_DE_WHATSAPP[dados.metadata.modelo as ChaveDoModelo]?.rotulo
          : null;
        await tx.leadInteraction.create({
          data: {
            leadId: conv.lead.id,
            tenantId,
            actorUserId: ator.id,
            kind: 'whatsapp',
            content: modelo
              ? `Conversa pelo WhatsApp oficial — modelo "${modelo}"`
              : 'Conversa pelo WhatsApp oficial',
            occurredAt: agora,
          },
        });
      }
      await this.sla.registrarPrimeiraResposta(tx, conv.lead, 'whatsapp', agora);
      await tx.lead.update({ where: { id: conv.lead.id }, data: { lastActivityAt: agora } });
    }

    return msg;
  }

  /**
   * Manda pelo provedor, fora da transação, e grava o que aconteceu.
   *
   * O "sent" da Meta pode chegar pelo webhook antes de o id externo estar
   * gravado aqui (são caminhos independentes). O evento fica registrado sem
   * aplicar; depois de gravar o id, os status pendentes dele são reaplicados —
   * senão a mensagem ficaria "enviada" para sempre, mesmo lida.
   */
  private async despachar(
    tenantId: string,
    conv: ConversaParaEnviar & { whatsappAccount: { externalId: string } },
    msg: MensagemComRemetente,
    envio: (para: string, conta: string) => Promise<{ idExterno: string }>,
  ): Promise<MensagemComRemetente> {
    this.eventos.emitir(conv.id, 'conversation:message', msg);
    this.eventos.emitirParaLoja(tenantId, 'conversation:updated', { conversationId: conv.id });

    let dados: Prisma.MessageUpdateInput;
    try {
      const para = enderecoDoWhatsApp(conv.contactPhoneNormalized!, conv.externalContactId);
      const { idExterno } = await envio(para, conv.whatsappAccount.externalId);
      dados = { externalId: idExterno, deliveryStatus: 'enviada' };
    } catch (err) {
      const motivo = err instanceof RecusaDoWhatsApp
        ? err.motivo
        : 'Falha inesperada ao enviar pelo WhatsApp.';
      if (!(err instanceof RecusaDoWhatsApp)) {
        this.logger.error(`Envio pelo WhatsApp quebrou (mensagem ${msg.id}): ${err}`);
      }
      dados = { deliveryStatus: 'falhou', failureReason: motivo };
    }

    const atualizada = await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.message.update({ where: { id: msg.id }, data: dados });
      if (typeof dados.externalId === 'string') {
        await this.reaplicarStatusPendentes(tx, tenantId, dados.externalId);
      }
      return tx.message.findUniqueOrThrow({ where: { id: msg.id }, include: COM_REMETENTE });
    });

    this.eventos.emitir(conv.id, 'conversation:message:update', atualizada);
    return atualizada;
  }

  /* ── Entrada: o webhook ───────────────────────────────────── */

  /** Desafio do cadastro do webhook. `null` → 403. */
  responderDesafio(consulta: Record<string, unknown>): string | null {
    return this.provedor.disponivel ? this.provedor.responderDesafio(consulta) : null;
  }

  /**
   * Uma entrega do provedor. Lança 401 se a assinatura não conferir — antes de
   * qualquer acesso ao banco.
   *
   * Evento de número sem loja é descartado com aviso (a entrega é autêntica, e
   * responder erro faria a Meta insistir por dias). Evento que **quebra** é
   * diferente: os demais da entrega são aplicados e a resposta é 500, para a
   * Meta reentregar — a idempotência torna a repetição inofensiva, e perder a
   * mensagem de um cliente não é aceitável.
   */
  async receberWebhook(
    cabecalhos: CabecalhosDeWhatsApp,
    corpo: Buffer,
  ): Promise<{ recebidos: number; aplicados: number }> {
    const eventos = this.provedor.interpretarWebhook(cabecalhos, corpo);
    const rawSha256 = sha256Hex(corpo);

    const contas = new Map<string, { id: string; tenantId: string } | null>();
    let aplicados = 0;
    let quebrou = false;

    for (const evento of eventos) {
      if (!contas.has(evento.conta)) {
        contas.set(
          evento.conta,
          await this.privilegiado.whatsappAccount.findFirst({
            where: { provider: this.provedor.nome, externalId: evento.conta, active: true },
            select: { id: true, tenantId: true },
          }),
        );
      }
      const conta = contas.get(evento.conta);
      if (!conta) {
        this.logger.warn(`WhatsApp: evento para um número que nenhuma loja conectou (${evento.conta}).`);
        continue;
      }

      try {
        const aplicou = evento.tipo === 'mensagem'
          ? await this.aplicarMensagem(conta, evento, rawSha256)
          : await this.aplicarStatus(conta.tenantId, evento, rawSha256);
        if (aplicou) aplicados++;
      } catch (err) {
        quebrou = true;
        this.logger.error(`WhatsApp: evento ${chaveDoEventoDeWhatsApp(evento)} não aplicado: ${err}`);
      }
    }

    if (quebrou) {
      throw new InternalServerErrorException('Parte da entrega não foi aplicada; reentregue.');
    }
    return { recebidos: eventos.length, aplicados };
  }

  /**
   * Idempotência, camada 1: `(provider, event_key)` é único. A segunda entrega
   * do mesmo evento bate aqui e nada mais acontece. `false` = já visto.
   */
  private async registrarEvento(
    tx: ScopedClient,
    tenantId: string,
    evento: EventoDeWhatsApp,
    rawSha256: string,
  ): Promise<string | null> {
    try {
      const linha = await tx.whatsappWebhookEvent.create({
        data: {
          tenantId,
          provider: this.provedor.nome,
          eventKey: chaveDoEventoDeWhatsApp(evento),
          kind: evento.tipo,
          normalized: evento as unknown as Prisma.InputJsonValue,
          rawSha256,
        },
        select: { id: true },
      });
      return linha.id;
    } catch (err) {
      if (ehUnicidade(err)) return null;
      throw err;
    }
  }

  private async aplicarMensagem(
    conta: { id: string; tenantId: string },
    evento: MensagemRecebidaDoWhatsApp,
    rawSha256: string,
  ): Promise<boolean> {
    const { tenantId } = conta;
    const contato = contatoDoWhatsApp(evento.de);
    const corpo = evento.formato === 'texto'
      ? (evento.texto ?? '')
      : [`O cliente enviou ${ROTULO_DO_FORMATO[evento.formato]} — abra no WhatsApp para ver.`, evento.texto]
          .filter(Boolean)
          .join('\n');

    const executar = () => this.prisma.withTenant(tenantId, async (tx) => {
      const eventoId = await this.registrarEvento(tx, tenantId, evento, rawSha256);
      if (!eventoId) return null;

      let conversa = await tx.conversation.findFirst({
        where: {
          tenantId,
          channel: 'whatsapp',
          whatsappAccountId: conta.id,
          contactPhoneNormalized: contato,
          status: { not: 'closed' },
        },
        select: { id: true, leadId: true, contactName: true, salespersonId: true },
      });

      let aviso: AvisoDeLeadNovo | null = null;
      if (!conversa) {
        // O primeiro contato vira lead pelo mesmo caminho do formulário:
        // deduplicação (quem já é lead ganha a interação no lead existente),
        // rodízio e prazo de primeiro contato.
        const lead = await this.leads.criarDeCanal(tx, tenantId, {
          source: 'whatsapp',
          contactName: evento.nome,
          contactPhone: contato,
          message: corpo || null,
          comoChegou: 'WhatsApp oficial',
          metadata: { canal: 'whatsapp' },
        });
        aviso = lead.aviso;
        const dadosDoLead = await tx.lead.findUniqueOrThrow({
          where: { id: lead.leadId },
          select: { contactName: true, contactPhone: true, contactEmail: true, vehicleId: true, customerUserId: true },
        });
        conversa = await tx.conversation.create({
          data: {
            tenantId,
            channel: 'whatsapp',
            whatsappAccountId: conta.id,
            contactPhoneNormalized: contato,
            leadId: lead.leadId,
            customerUserId: dadosDoLead.customerUserId,
            vehicleId: dadosDoLead.vehicleId,
            salespersonId: lead.assignedTo,
            contactName: dadosDoLead.contactName ?? evento.nome,
            contactPhone: dadosDoLead.contactPhone,
            contactEmail: dadosDoLead.contactEmail,
          },
          select: { id: true, leadId: true, contactName: true, salespersonId: true },
        });
      }

      const mensagem = await tx.message.create({
        data: {
          conversationId: conversa.id,
          tenantId,
          // Sem usuário: é o cliente, como no visitante do link.
          senderUserId: null,
          kind: 'text',
          body: corpo,
          externalId: evento.idExterno,
          metadata: { canal: 'whatsapp', formato: evento.formato } as Prisma.InputJsonValue,
          createdAt: evento.recebidaEm,
        },
        include: COM_REMETENTE,
      });

      await tx.conversation.update({
        where: { id: conversa.id },
        data: {
          lastMessageAt: new Date(),
          customerLastMessageAt: evento.recebidaEm,
          externalContactId: evento.de,
          unreadCountSalesperson: { increment: 1 },
          ...(!conversa.contactName && evento.nome ? { contactName: evento.nome } : {}),
        },
      });
      if (conversa.leadId) {
        await tx.lead.update({ where: { id: conversa.leadId }, data: { lastActivityAt: new Date() } });
      }
      await tx.whatsappWebhookEvent.update({ where: { id: eventoId }, data: { applied: true } });

      return {
        conversationId: conversa.id,
        mensagem,
        aviso,
        salespersonId: conversa.salespersonId,
        nome: conversa.contactName ?? evento.nome,
      };
    });

    let r: Awaited<ReturnType<typeof executar>>;
    try {
      r = await executar();
    } catch (err) {
      // Duas mensagens do mesmo cliente novo, processadas ao mesmo tempo: a
      // segunda bateu no índice da conversa viva. Repetir encontra a conversa.
      if (!ehUnicidade(err)) throw err;
      r = await executar();
    }
    if (!r) return false;

    // Lead novo: o aviso de lead já leva a mensagem — dois avisos para o mesmo
    // contato seriam ruído. Conversa que já existia (ou lead que a deduplicação
    // achou): o aviso é da mensagem, para quem cuida da conversa.
    this.leads.avisarDeLeadDeCanal(r.aviso);
    if (!r.aviso) {
      this.push.avisarMensagem(tenantId, {
        conversationId: r.conversationId,
        salespersonId: r.salespersonId,
        nome: r.nome,
        canal: 'WhatsApp',
        texto: corpo,
      });
    }
    this.eventos.emitir(r.conversationId, 'conversation:message', {
      ...r.mensagem,
      conversationId: r.conversationId,
    });
    this.eventos.emitirParaLoja(tenantId, 'conversation:updated', { conversationId: r.conversationId });
    return true;
  }

  private async aplicarStatus(
    tenantId: string,
    evento: StatusDoWhatsApp,
    rawSha256: string,
  ): Promise<boolean> {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const eventoId = await this.registrarEvento(tx, tenantId, evento, rawSha256);
      if (!eventoId) return null;
      return this.aplicarStatusNaMensagem(tx, tenantId, evento, eventoId);
    });
    if (!r) return false;
    this.eventos.emitir(r.conversationId, 'conversation:message:update', r.mensagem);
    return true;
  }

  private async aplicarStatusNaMensagem(
    tx: ScopedClient,
    tenantId: string,
    evento: StatusDoWhatsApp,
    eventoId: string,
  ): Promise<{ conversationId: string; mensagem: MensagemComRemetente } | null> {
    const msg = await tx.message.findFirst({
      where: { tenantId, externalId: evento.idExterno },
      select: { id: true, conversationId: true, deliveryStatus: true },
    });
    // Ainda sem id gravado (o envio não voltou) — fica pendente, e o
    // `despachar` o reaplica.
    if (!msg) return null;
    if (!statusDeEntregaAvanca(msg.deliveryStatus as StatusDeEntrega | null, evento.status)) {
      await tx.whatsappWebhookEvent.update({ where: { id: eventoId }, data: { applied: true } });
      return null;
    }

    const mensagem = await tx.message.update({
      where: { id: msg.id },
      data: {
        deliveryStatus: evento.status,
        ...(evento.status === 'entregue' || evento.status === 'lida' ? { deliveredAt: evento.em } : {}),
        ...(evento.status === 'lida' ? { readAt: evento.em } : {}),
        ...(evento.status === 'falhou' ? { failureReason: evento.erro ?? 'O WhatsApp não entregou a mensagem.' } : {}),
      },
      include: COM_REMETENTE,
    });
    await tx.whatsappWebhookEvent.update({ where: { id: eventoId }, data: { applied: true } });
    return { conversationId: msg.conversationId, mensagem };
  }

  /** Status que chegaram antes do id externo estar gravado — ver `despachar`. */
  private async reaplicarStatusPendentes(tx: ScopedClient, tenantId: string, idExterno: string): Promise<void> {
    const pendentes = await tx.whatsappWebhookEvent.findMany({
      where: { tenantId, kind: 'status', applied: false, eventKey: { startsWith: `status:${idExterno}:` } },
      orderBy: { receivedAt: 'asc' },
      select: { id: true, normalized: true },
    });
    for (const p of pendentes) {
      const e = p.normalized as unknown as StatusDoWhatsApp;
      await this.aplicarStatusNaMensagem(tx, tenantId, { ...e, em: new Date(e.em) }, p.id);
    }
  }

  /* ── Uso do mês ───────────────────────────────────────────── */

  /**
   * O que a loja usou no mês: conversas com o cliente e modelos enviados, por
   * categoria. É a base da decisão 2 do plano de paridade (o custo do
   * WhatsApp oficial entra no preço ou é adicional) — a Meta cobra por modelo
   * enviado, e a conversa aberta pelo cliente é gratuita.
   */
  async uso(tenantId: string, agora = new Date()): Promise<unknown> {
    const inicio = new Date(agora.getFullYear(), agora.getMonth(), 1);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [conversas, recebidas, modelos] = await Promise.all([
        tx.conversation.count({
          where: { tenantId, channel: 'whatsapp', lastMessageAt: { gte: inicio } },
        }),
        tx.message.count({
          where: {
            tenantId, senderUserId: null, createdAt: { gte: inicio },
            conversation: { channel: 'whatsapp' },
          },
        }),
        // Mensagens de saída do mês; o filtro "é modelo" é feito aqui, e não
        // no JSON pelo banco — o volume de uma loja num mês é pequeno.
        tx.message.findMany({
          where: {
            tenantId, createdAt: { gte: inicio }, senderUserId: { not: null },
            conversation: { channel: 'whatsapp' },
            deliveryStatus: { not: 'falhou' },
          },
          select: { metadata: true },
        }),
      ]);

      const porCategoria: Record<string, number> = {};
      let enviados = 0;
      for (const m of modelos) {
        const meta = (m.metadata ?? {}) as Record<string, unknown>;
        if (typeof meta.modelo !== 'string') continue;
        enviados++;
        const categoria = String(meta.categoria ?? 'outra');
        porCategoria[categoria] = (porCategoria[categoria] ?? 0) + 1;
      }
      return {
        desde: inicio,
        conversas,
        mensagensRecebidas: recebidas,
        modelosEnviados: enviados,
        modelosPorCategoria: porCategoria,
      };
    });
  }

  /* ── Simulação ────────────────────────────────────────────── */

  /**
   * Só com o provedor simulado, fora de produção (404 no resto). Gera o
   * webhook que a Meta mandaria e o entrega pelo caminho real — a mesma
   * assinatura, o mesmo tradutor, a mesma idempotência.
   */
  async simularMensagem(
    tenantId: string,
    dados: { telefone: string; nome: string; texto: string },
  ): Promise<{ recebidos: number; aplicados: number }> {
    const simulado = this.exigirSimulado();
    const conta = await this.prisma.withTenant(tenantId, (tx) => this.contaAtiva(tx, tenantId));
    const contato = normalizarTelefoneBr(dados.telefone);
    if (!contato) throw new BadRequestException('Telefone inválido.');

    const { corpo, cabecalhos } = simulado.entrega([{
      tipo: 'mensagem',
      idExterno: `wamid.SIM.IN.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
      conta: conta.externalId,
      de: enderecoDoWhatsApp(contato),
      nome: dados.nome,
      formato: 'texto',
      texto: dados.texto,
      recebidaEm: new Date(),
    }]);
    return this.receberWebhook(cabecalhos, corpo);
  }

  async simularStatus(
    tenantId: string,
    dados: { mensagemId: string; status: StatusDoWhatsApp['status'] },
  ): Promise<{ recebidos: number; aplicados: number }> {
    const simulado = this.exigirSimulado();
    const alvo = await this.prisma.withTenant(tenantId, async (tx) => {
      const conta = await this.contaAtiva(tx, tenantId);
      const msg = await tx.message.findFirst({
        where: { id: dados.mensagemId, tenantId },
        select: { externalId: true },
      });
      if (!msg?.externalId) throw new NotFoundException('Mensagem enviada pelo WhatsApp não encontrada.');
      return { conta: conta.externalId, idExterno: msg.externalId };
    });

    const { corpo, cabecalhos } = simulado.entrega([{
      tipo: 'status',
      idExterno: alvo.idExterno,
      conta: alvo.conta,
      status: dados.status,
      em: new Date(),
      erro: dados.status === 'falhou' ? '131026 — Mensagem não entregue (simulação)' : null,
    }]);
    return this.receberWebhook(cabecalhos, corpo);
  }

  private exigirSimulado(): ProvedorSimuladoDeWhatsApp {
    if (!this.simulado) throw new NotFoundException();
    return this.provedor as ProvedorSimuladoDeWhatsApp;
  }
}
