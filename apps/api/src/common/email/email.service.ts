import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';
import {
  CONTATO_SUPORTE, ROTULO_CICLO, formatarBRL, type CicloDeCobranca,
} from '@autoconnect/shared';
import { esc, montarEmail, type ConteudoDoEmail } from './layout';

/**
 * Escapa texto para dentro do HTML do e-mail.
 *
 * Nome do cliente, mensagem do lead e observação da loja vêm de formulário.
 * Sem isto, um "cliente" chamado `<a href="...">Clique aqui</a>` punha um link
 * de phishing no e-mail que a concessionária recebe com a nossa marca.
 */
export { esc };

/** Cópia com todo campo de texto escapado — para montar o HTML, nunca o assunto. */
function escaparTexto<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? esc(v) : v]),
  ) as T;
}

@Injectable()
export class EmailService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null = null;
  private readonly smtp: nodemailer.Transporter | null = null;
  private readonly from: string;
  private readonly webUrl: string;

  constructor(config: ConfigService) {
    this.webUrl = config.get<string>('WEB_URL') ?? 'http://localhost:3000';

    const resendKey = config.get<string>('RESEND_API_KEY');
    const gmailUser = config.get<string>('GMAIL_USER');
    const gmailPass = config.get<string>('GMAIL_APP_PASSWORD');

    if (resendKey) {
      this.resend = new Resend(resendKey);
      this.from = config.get<string>('EMAIL_FROM') ?? 'AutoConnect <onboarding@resend.dev>';
      this.logger.log('E-mail via Resend ativado');
    } else if (gmailUser && gmailPass) {
      this.smtp = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
        // O padrão do nodemailer é 2 minutos esperando a conexão: com a porta
        // bloqueada, cada envio segurava um socket esse tempo todo por nada.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
      this.from = `AutoConnect <${gmailUser}>`;
      this.logger.log(`E-mail via Gmail ativado (${gmailUser})`);
    } else {
      this.from = 'AutoConnect <no-reply@autoconnect.app>';
      this.logger.warn('Nenhum provedor de e-mail configurado — links serão logados no console');
    }
  }

  /** Qual provedor está montado — para o painel de sistema. Não testa nada. */
  get provedor(): 'resend' | 'gmail' | null {
    if (this.resend) return 'resend';
    if (this.smtp) return 'gmail';
    return null;
  }

  /**
   * Testa o provedor ao subir, sem segurar a inicialização.
   *
   * O log dizia "E-mail via Gmail ativado" com o Railway bloqueando SMTP (só o
   * plano Pro libera): nenhum e-mail saía, e isso só apareceu no primeiro
   * "esqueci a senha" de um usuário. Agora aparece no deploy.
   */
  onApplicationBootstrap(): void {
    void this.verificarProvedor();
  }

  /** `true` se o provedor aceita envio. Nunca lança: o diagnóstico vai para o log. */
  async verificarProvedor(): Promise<boolean> {
    try {
      if (this.resend) return await this.verificarResend(this.resend);
      if (this.smtp) {
        await this.smtp.verify();
        this.logger.log('SMTP respondeu — e-mail pronto para envio');
        return true;
      }
      return false; // sem provedor: o construtor já avisou
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Provedor de e-mail inacessível — NENHUM e-mail vai sair (${motivo}). ` +
          'No Railway, SMTP só existe no plano Pro; use RESEND_API_KEY.',
      );
      return false;
    }
  }

  private async verificarResend(resend: Resend): Promise<boolean> {
    const dominio = /@([^>\s]+)/.exec(this.from)?.[1];
    if (dominio === 'resend.dev') {
      this.logger.warn(
        'EMAIL_FROM usa o remetente de teste da Resend: só entrega para o dono da conta. ' +
          'Verifique um domínio próprio e troque o EMAIL_FROM.',
      );
      return false;
    }

    const { data, error } = await resend.domains.list();
    if (error) {
      // Chave só de envio não pode listar domínios — e a recusa prova que ela vale.
      if (error.name === 'restricted_api_key') {
        this.logger.log('Resend: chave de envio válida');
        return true;
      }
      this.logger.error(`Resend recusou a chave — NENHUM e-mail vai sair (${error.message})`);
      return false;
    }

    const verificado = data.data.some((d) => d.name === dominio && d.status === 'verified');
    if (!verificado) {
      this.logger.error(
        `O domínio "${dominio}" do EMAIL_FROM não está verificado na Resend — NENHUM e-mail vai sair`,
      );
      return false;
    }
    this.logger.log(`Resend pronta — domínio ${dominio} verificado`);
    return true;
  }

  /* ── Conta ──────────────────────────────────────────────────── */

  async sendPasswordReset(to: string, name: string, token: string): Promise<void> {
    const link = `${this.webUrl}/redefinir-senha?token=${token}`;
    await this.enviar(to, 'Redefinição de senha — AutoConnect', {
      etiqueta: 'Segurança da conta',
      titulo: 'Redefinição de senha',
      preheader: 'Use o link para criar uma nova senha. Ele expira em 1 hora.',
      paragrafos: [
        `Olá, ${esc(name)}.`,
        'Recebemos uma solicitação para redefinir a senha da sua conta no AutoConnect. ' +
          'Para criar uma nova senha, use o botão abaixo.',
      ],
      botao: { texto: 'Redefinir senha', url: link },
      nota: 'O link expira em 1 hora e só pode ser usado uma vez. Se você não pediu a redefinição, ' +
        'ignore este e-mail: sua senha continua a mesma.',
      motivo: 'Você recebeu este e-mail porque alguém pediu a redefinição de senha desta conta.',
    }, link);
  }

  async sendEmailVerification(to: string, name: string, token: string): Promise<void> {
    const link = `${this.webUrl}/verificar-email?token=${token}`;
    await this.enviar(to, 'Confirme seu e-mail — AutoConnect', {
      etiqueta: 'Confirmação de cadastro',
      titulo: 'Confirme seu e-mail',
      preheader: 'Um clique para concluir o cadastro no AutoConnect.',
      paragrafos: [
        `Olá, ${esc(name)}.`,
        'Para concluir o cadastro e liberar todos os recursos da sua conta, confirme que este ' +
          'endereço é seu.',
      ],
      botao: { texto: 'Confirmar e-mail', url: link },
      nota: 'O link expira em 24 horas. Se você não criou uma conta no AutoConnect, ignore este e-mail.',
      motivo: 'Você recebeu este e-mail porque este endereço foi usado num cadastro no AutoConnect.',
    }, link);
  }

  async sendTeamInvite(opts: {
    to: string;
    inviteUrl: string;
    roleLabel: string;
    tenantName: string;
  }): Promise<void> {
    const e = escaparTexto(opts);
    await this.enviar(opts.to, `Convite para a equipe da ${opts.tenantName}`, {
      etiqueta: 'Convite para a equipe',
      titulo: `Você foi convidado para a equipe da ${opts.tenantName}`,
      preheader: `Acesso ao AutoConnect como ${opts.roleLabel}. O convite vale por 7 dias.`,
      paragrafos: [
        `A <strong>${e.tenantName}</strong> convidou você para acessar o AutoConnect como ` +
          `<strong>${e.roleLabel}</strong>.`,
        'Crie sua senha pelo botão abaixo para começar a atender os leads e a agenda da loja.',
      ],
      detalhes: [
        { rotulo: 'Loja', valor: opts.tenantName },
        { rotulo: 'Função', valor: opts.roleLabel },
      ],
      botao: { texto: 'Aceitar convite', url: opts.inviteUrl },
      nota: 'O convite expira em 7 dias. Se você não esperava este convite, ignore este e-mail.',
      motivo: 'Você recebeu este e-mail porque um administrador da loja informou este endereço.',
    }, opts.inviteUrl);
  }

  /* ── Leads e agenda (para a loja) ──────────────────────────── */

  async sendLeadNotification(opts: {
    to: string;
    dealerName: string;
    customerName: string;
    vehicleInfo: string;
    message: string | null;
    leadUrl: string;
  }): Promise<void> {
    const e = escaparTexto(opts);
    await this.enviar(opts.to, `Novo interesse recebido — ${opts.vehicleInfo}`, {
      etiqueta: 'Novo lead',
      titulo: `Novo interesse em ${opts.vehicleInfo}`,
      preheader: `${opts.customerName} quer falar sobre o ${opts.vehicleInfo}.`,
      paragrafos: [
        `<strong>${e.customerName}</strong> demonstrou interesse neste veículo pela vitrine da ` +
          `<strong>${e.dealerName}</strong>.`,
        ...(opts.message ? [this.citacao(e.message!)] : []),
      ],
      detalhes: [
        { rotulo: 'Cliente', valor: opts.customerName },
        { rotulo: 'Veículo', valor: opts.vehicleInfo },
      ],
      botao: { texto: 'Abrir o lead', url: opts.leadUrl },
      nota: 'O primeiro contato rápido é o que mais pesa para o cliente não procurar outra loja.',
      motivo: 'Você recebeu este e-mail porque é responsável pelos leads desta loja no AutoConnect.',
    }, opts.leadUrl);
  }

  /** Cliente solicitou agendamento → avisa a concessionária */
  async sendAppointmentRequested(opts: {
    to: string;
    dealerName: string;
    customerName: string;
    typeLabel: string;       // "Test drive" | "Visita"
    vehicleInfo: string | null;
    when: Date;
  }): Promise<void> {
    const quando = this.formatWhen(opts.when);
    const link = `${this.webUrl}/agendamentos`;
    const e = escaparTexto(opts);
    await this.enviar(opts.to, `Novo agendamento — ${opts.customerName} · ${quando}`, {
      etiqueta: 'Agendamento',
      titulo: `Novo pedido de ${opts.typeLabel.toLowerCase()}`,
      preheader: `${opts.customerName} pediu ${opts.typeLabel.toLowerCase()} para ${quando}.`,
      paragrafos: [
        `<strong>${e.customerName}</strong> pediu ${e.typeLabel.toLowerCase()}` +
          `${e.vehicleInfo ? ` do <strong>${e.vehicleInfo}</strong>` : ''} pela vitrine da loja.`,
        'Confirme o horário no painel para o cliente receber a confirmação.',
      ],
      detalhes: [
        { rotulo: 'Cliente', valor: opts.customerName },
        { rotulo: 'Tipo', valor: opts.typeLabel },
        ...(opts.vehicleInfo ? [{ rotulo: 'Veículo', valor: opts.vehicleInfo }] : []),
        { rotulo: 'Data e horário', valor: quando },
      ],
      botao: { texto: 'Ver agendamentos', url: link },
      motivo: 'Você recebeu este e-mail porque é responsável pela agenda desta loja no AutoConnect.',
    }, link);
  }

  /** Cliente ofereceu um veículo na troca → avisa a concessionária */
  async sendTradeInReceived(opts: {
    to: string;
    dealerName: string;
    customerName: string;
    offeredVehicle: string;
    desiredVehicle: string | null;
    fipeReference: number | null;
    expectedValue: number | null;
  }): Promise<void> {
    const link = `${this.webUrl}/leads`;
    const e = escaparTexto(opts);
    await this.enviar(opts.to, `Proposta de troca — ${opts.customerName}`, {
      etiqueta: 'Proposta de troca',
      titulo: 'Nova proposta de troca',
      preheader: `${opts.customerName} ofereceu um ${opts.offeredVehicle} na troca.`,
      paragrafos: [
        `<strong>${e.customerName}</strong> ofereceu um veículo na troca e aguarda a sua avaliação.`,
      ],
      detalhes: [
        { rotulo: 'Cliente', valor: opts.customerName },
        { rotulo: 'Veículo oferecido', valor: opts.offeredVehicle },
        ...(opts.desiredVehicle ? [{ rotulo: 'Interesse de compra', valor: opts.desiredVehicle }] : []),
        ...(opts.fipeReference != null ? [{ rotulo: 'Referência FIPE', valor: this.brl(opts.fipeReference) }] : []),
        ...(opts.expectedValue != null ? [{ rotulo: 'Valor esperado pelo cliente', valor: this.brl(opts.expectedValue) }] : []),
      ],
      botao: { texto: 'Avaliar no painel', url: link },
      nota: 'Abra o lead para ver os detalhes do veículo e enviar a sua avaliação ao cliente.',
      motivo: 'Você recebeu este e-mail porque é responsável pelos leads desta loja no AutoConnect.',
    }, link);
  }

  /* ── Para o cliente final ──────────────────────────────────── */

  /**
   * A loja abriu uma conversa com quem **não tem conta** → manda o link.
   *
   * O lead da Onda 0 nasce sem conta, então não há login por onde ele entrar: o
   * link é a porta. O e-mail é o caminho automático; quando não há endereço (ou
   * nenhum provedor está configurado), a loja copia o link da própria tela e
   * manda pelo WhatsApp, que é o canal que a revenda usa.
   */
  async sendConviteDeConversa(opts: {
    to: string;
    dealerName: string;
    url: string;
  }): Promise<void> {
    const e = escaparTexto(opts);
    await this.enviar(opts.to, `${opts.dealerName} respondeu você`, {
      etiqueta: 'Mensagem da loja',
      titulo: `${opts.dealerName} respondeu você`,
      preheader: 'A loja abriu uma conversa sobre o veículo que você pediu informação.',
      paragrafos: [
        `A <strong>${e.dealerName}</strong> abriu uma conversa sobre o veículo que você pediu informação.`,
        'Você lê e responde pelo link abaixo, sem precisar criar conta.',
      ],
      botao: { texto: 'Abrir a conversa', url: opts.url },
      nota: 'Este link é pessoal: quem o tiver entra na conversa, então não o encaminhe. ' +
        'Se você não pediu informação a esta loja, ignore este e-mail.',
      motivo: 'Você recebeu este e-mail porque pediu informação a esta loja pelo AutoConnect.',
    }, opts.url);
  }

  /** Concessionária confirmou/cancelou/reagendou → avisa o cliente */
  async sendAppointmentStatusUpdate(opts: {
    to: string;
    customerName: string;
    dealerName: string;
    status: 'confirmed' | 'canceled' | 'rescheduled';
    typeLabel: string;
    vehicleInfo: string | null;
    when: Date;
  }): Promise<void> {
    const quando = this.formatWhen(opts.when);
    const link = `${this.webUrl}/perfil`;
    const e = escaparTexto(opts);
    const tipo = e.typeLabel.toLowerCase();
    const veiculo = e.vehicleInfo ? ` do <strong>${e.vehicleInfo}</strong>` : '';
    const titulos = {
      confirmed: 'Agendamento confirmado',
      canceled: 'Agendamento cancelado',
      rescheduled: 'Agendamento reagendado',
    } as const;
    const textos = {
      confirmed: `A <strong>${e.dealerName}</strong> confirmou o seu ${tipo}${veiculo}. Esperamos você no horário marcado.`,
      canceled: `A <strong>${e.dealerName}</strong> cancelou o seu ${tipo}${veiculo}. Fale com a loja para marcar um novo horário.`,
      rescheduled: `A <strong>${e.dealerName}</strong> reagendou o seu ${tipo}${veiculo} para um novo horário.`,
    } as const;
    await this.enviar(opts.to, `${titulos[opts.status]} — ${opts.dealerName}`, {
      etiqueta: 'Seu agendamento',
      titulo: titulos[opts.status],
      tom: opts.status === 'canceled' ? 'atencao' : opts.status === 'confirmed' ? 'sucesso' : 'info',
      preheader: `${titulos[opts.status]}: ${opts.typeLabel.toLowerCase()} na ${opts.dealerName}, ${quando}.`,
      paragrafos: [`Olá, ${e.customerName}.`, textos[opts.status]],
      detalhes: [
        { rotulo: 'Loja', valor: opts.dealerName },
        { rotulo: 'Tipo', valor: opts.typeLabel },
        ...(opts.vehicleInfo ? [{ rotulo: 'Veículo', valor: opts.vehicleInfo }] : []),
        { rotulo: 'Data e horário', valor: quando },
      ],
      botao: { texto: 'Ver meus agendamentos', url: link },
      motivo: 'Você recebeu este e-mail porque tem um agendamento nesta loja pelo AutoConnect.',
    }, link);
  }

  /** Lembrete ~24h antes do agendamento → avisa o cliente */
  async sendAppointmentReminder(opts: {
    to: string;
    customerName: string;
    dealerName: string;
    typeLabel: string;
    vehicleInfo: string | null;
    when: Date;
  }): Promise<void> {
    const quando = this.formatWhen(opts.when);
    const link = `${this.webUrl}/perfil`;
    const e = escaparTexto(opts);
    await this.enviar(opts.to, `Lembrete — ${opts.typeLabel} em ${opts.dealerName}`, {
      etiqueta: 'Lembrete',
      titulo: `Lembrete do seu ${opts.typeLabel.toLowerCase()}`,
      preheader: `${opts.typeLabel} na ${opts.dealerName}, ${quando}.`,
      paragrafos: [
        `Olá, ${e.customerName}.`,
        `Passando para lembrar do seu ${e.typeLabel.toLowerCase()}` +
          `${e.vehicleInfo ? ` do <strong>${e.vehicleInfo}</strong>` : ''} na <strong>${e.dealerName}</strong>.`,
      ],
      detalhes: [
        { rotulo: 'Loja', valor: opts.dealerName },
        ...(opts.vehicleInfo ? [{ rotulo: 'Veículo', valor: opts.vehicleInfo }] : []),
        { rotulo: 'Data e horário', valor: quando },
      ],
      botao: { texto: 'Ver meus agendamentos', url: link },
      nota: 'Se precisar remarcar ou cancelar, fale com a loja ou use a sua área de cliente.',
      motivo: 'Você recebeu este e-mail porque tem um agendamento nesta loja pelo AutoConnect.',
    }, link);
  }

  /** Veículo monitorado baixou de preço → avisa o cliente */
  async sendPriceDropAlert(opts: {
    to: string;
    name: string;
    vehicleInfo: string;
    price: number;
    target: number;
    link: string;
  }): Promise<void> {
    await this.enviar(opts.to, `Baixou de preço: ${opts.vehicleInfo}`, {
      etiqueta: 'Alerta de preço',
      titulo: `O ${opts.vehicleInfo} baixou de preço`,
      tom: 'sucesso',
      preheader: `Agora por ${this.brl(opts.price)}, dentro do alvo que você definiu.`,
      paragrafos: [
        `Olá, ${esc(opts.name)}.`,
        'O veículo que você acompanha chegou ao preço que você definiu no alerta.',
      ],
      detalhes: [
        { rotulo: 'Veículo', valor: opts.vehicleInfo },
        { rotulo: 'Preço atual', valor: this.brl(opts.price) },
        { rotulo: 'Seu alvo', valor: this.brl(opts.target) },
      ],
      botao: { texto: 'Ver o veículo', url: opts.link },
      nota: 'Este alerta não será reenviado para este veículo.',
      motivo: 'Você recebeu este e-mail porque criou um alerta de preço no AutoConnect.',
    }, opts.link);
  }

  /** Concessionária avaliou o veículo de troca → avisa o cliente */
  async sendTradeInAppraisal(opts: {
    to: string;
    customerName: string;
    dealerName: string;
    offeredVehicle: string;
    value: number;
    desiredVehicle: string | null;
    desiredPrice: number | null;
    note: string | null;
  }): Promise<void> {
    const link = `${this.webUrl}/perfil`;
    const e = escaparTexto(opts);
    await this.enviar(opts.to, `Avaliação da sua troca — ${opts.dealerName}`, {
      etiqueta: 'Avaliação da sua troca',
      titulo: `A ${opts.dealerName} avaliou o seu ${opts.offeredVehicle}`,
      preheader: `Avaliação de ${this.brl(opts.value)} para a troca.`,
      paragrafos: [
        `Olá, ${e.customerName}.`,
        `A <strong>${e.dealerName}</strong> avaliou o seu <strong>${e.offeredVehicle}</strong> em ` +
          `<strong>${this.brl(opts.value)}</strong> para a troca.`,
        ...(opts.note ? [this.citacao(e.note!, 'Observação da loja')] : []),
      ],
      detalhes: [
        { rotulo: 'Seu veículo', valor: opts.offeredVehicle },
        { rotulo: 'Avaliação', valor: this.brl(opts.value) },
        ...(opts.desiredPrice != null
          ? [
              { rotulo: 'Veículo desejado', valor: `${opts.desiredVehicle ?? 'Veículo desejado'} · ${this.brl(opts.desiredPrice)}` },
              { rotulo: 'Diferença a pagar', valor: this.brl(Math.max(0, opts.desiredPrice - opts.value)) },
            ]
          : []),
      ],
      botao: { texto: 'Ver detalhes', url: link },
      nota: 'Esta é uma avaliação inicial e pode mudar após a vistoria presencial do veículo.',
      motivo: 'Você recebeu este e-mail porque ofereceu um veículo na troca nesta loja pelo AutoConnect.',
    }, link);
  }

  /* ── Cobrança da assinatura (para a loja) ──────────────────── */

  private readonly motivoCobranca =
    'Você recebeu este e-mail porque este é o e-mail principal da loja no AutoConnect.';

  private get linkDoPlano(): string {
    return `${this.webUrl}/configuracoes/plano`;
  }

  /**
   * Aviso de assinatura do cron diário — fim de trial próximo, fatura vencida
   * ou loja em somente leitura.
   *
   * Um e-mail só para os casos, porque o que muda entre eles é a frase e não o
   * formato — e porque modelos quase iguais viram lugares para o link da tela
   * de plano ficar desatualizado.
   */
  async sendAvisoDeAssinatura(opts: {
    to: string;
    dealerName: string;
    titulo: string;
    corpo: string;
    urgente: boolean;
  }): Promise<void> {
    await this.enviar(opts.to, `${opts.titulo} — AutoConnect`, {
      etiqueta: 'Cobrança',
      titulo: opts.titulo,
      tom: opts.urgente ? 'urgente' : 'atencao',
      preheader: opts.corpo,
      // O texto vem de `avaliarCobranca`, e o do bloqueio já diz que nada foi
      // apagado — repetir aqui duplicava a frase no e-mail mais importante.
      paragrafos: [`Olá, equipe da <strong>${esc(opts.dealerName)}</strong>.`, esc(opts.corpo)],
      botao: { texto: 'Ver plano e cobrança', url: this.linkDoPlano },
      motivo: this.motivoCobranca,
    }, this.linkDoPlano);
  }

  /** A loja contratou um plano → a primeira fatura está disponível. */
  async sendAssinaturaContratada(opts: {
    to: string;
    dealerName: string;
    plano: string;
    ciclo: CicloDeCobranca;
    /** Valor da cobrança, em string decimal ("197.00"). */
    valor: string | null;
    vencimento: Date | null;
    urlPagamento: string | null;
  }): Promise<void> {
    const url = opts.urlPagamento ?? this.linkDoPlano;
    await this.enviar(opts.to, `Assinatura contratada: plano ${opts.plano} — AutoConnect`, {
      etiqueta: 'Cobrança',
      titulo: 'Assinatura contratada',
      preheader: `Plano ${opts.plano}${opts.valor ? `, ${formatarBRL(opts.valor)}` : ''}. A primeira fatura já está disponível.`,
      paragrafos: [
        `Olá, equipe da <strong>${esc(opts.dealerName)}</strong>.`,
        `Recebemos a contratação do plano <strong>${esc(opts.plano)}</strong>. A primeira fatura já ` +
          'está disponível para pagamento por Pix, boleto ou cartão.',
      ],
      detalhes: [
        { rotulo: 'Plano', valor: opts.plano },
        { rotulo: 'Ciclo', valor: ROTULO_CICLO[opts.ciclo] },
        ...(opts.valor ? [{ rotulo: 'Valor', valor: formatarBRL(opts.valor) }] : []),
        ...(opts.vencimento ? [{ rotulo: 'Vencimento', valor: this.dataCurta(opts.vencimento) }] : []),
      ],
      botao: { texto: opts.urlPagamento ? 'Pagar a fatura' : 'Ver plano e cobrança', url },
      nota: 'Assim que o pagamento for confirmado, você recebe outro e-mail. O acesso continua ' +
        'liberado até o vencimento da fatura.',
      motivo: this.motivoCobranca,
    }, url);
  }

  /** O gateway confirmou um pagamento. */
  async sendPagamentoConfirmado(opts: {
    to: string;
    dealerName: string;
    plano: string;
    valor: string | null;
    pagoEm: Date | null;
    proximaCobranca: Date | null;
  }): Promise<void> {
    await this.enviar(opts.to, 'Pagamento confirmado — AutoConnect', {
      etiqueta: 'Cobrança',
      titulo: 'Pagamento confirmado',
      tom: 'sucesso',
      preheader: `Recebemos o pagamento do plano ${opts.plano}. Obrigado.`,
      paragrafos: [
        `Olá, equipe da <strong>${esc(opts.dealerName)}</strong>.`,
        `Recebemos o pagamento da assinatura do plano <strong>${esc(opts.plano)}</strong>. ` +
          'Obrigado por usar o AutoConnect.',
      ],
      detalhes: [
        { rotulo: 'Plano', valor: opts.plano },
        ...(opts.valor ? [{ rotulo: 'Valor pago', valor: formatarBRL(opts.valor) }] : []),
        ...(opts.pagoEm ? [{ rotulo: 'Pago em', valor: this.dataCurta(opts.pagoEm) }] : []),
        ...(opts.proximaCobranca ? [{ rotulo: 'Próxima cobrança', valor: this.dataCurta(opts.proximaCobranca) }] : []),
      ],
      botao: { texto: 'Ver faturas', url: this.linkDoPlano },
      nota: 'O histórico de faturas fica em Configurações › Plano e cobrança.',
      motivo: this.motivoCobranca,
    }, this.linkDoPlano);
  }

  /** A assinatura foi encerrada — pela loja, pelo gateway ou por estorno. */
  async sendAssinaturaCancelada(opts: {
    to: string;
    dealerName: string;
    plano: string;
    origem: 'loja' | 'gateway' | 'estorno';
  }): Promise<void> {
    const plano = `<strong>${esc(opts.plano)}</strong>`;
    const abertura = {
      loja: `Confirmamos o cancelamento da assinatura do plano ${plano}. Nenhuma nova cobrança será feita.`,
      gateway: `A assinatura do plano ${plano} foi encerrada no sistema de pagamento, e nenhuma nova cobrança será feita.`,
      estorno: `O pagamento da assinatura do plano ${plano} foi estornado, e a assinatura foi encerrada.`,
    }[opts.origem];
    await this.enviar(opts.to, 'Assinatura cancelada — AutoConnect', {
      etiqueta: 'Cobrança',
      titulo: 'Assinatura cancelada',
      tom: 'atencao',
      preheader: `A assinatura do plano ${opts.plano} foi encerrada. Nada foi apagado.`,
      paragrafos: [
        `Olá, equipe da <strong>${esc(opts.dealerName)}</strong>.`,
        abertura,
        'A loja passa a modo somente leitura. Nada foi apagado: veículos, leads, negócios e contratos ' +
          'continuam na conta, e você pode voltar a qualquer momento contratando um plano.',
      ],
      botao: { texto: 'Ver plano e cobrança', url: this.linkDoPlano },
      motivo: this.motivoCobranca,
    }, this.linkDoPlano);
  }

  /** O super admin concedeu cortesia à loja. */
  async sendCortesiaConcedida(opts: {
    to: string;
    dealerName: string;
    /** "Loja fundadora", "Loja interna da AutoConnect". */
    motivo: string;
    plano: string;
  }): Promise<void> {
    await this.enviar(opts.to, 'Sua loja agora é cortesia — AutoConnect', {
      etiqueta: 'Plano',
      titulo: 'Sua loja agora é cortesia',
      tom: 'sucesso',
      preheader: `A ${opts.dealerName} usa o AutoConnect sem pagar assinatura, no plano ${opts.plano}.`,
      paragrafos: [
        `Olá, equipe da <strong>${esc(opts.dealerName)}</strong>.`,
        `A loja foi incluída como <strong>${esc(opts.motivo.toLowerCase())}</strong>: vocês usam o ` +
          `AutoConnect sem pagar assinatura, no plano <strong>${esc(opts.plano)}</strong>.`,
        'Nenhuma cobrança será feita enquanto a cortesia estiver ativa.',
      ],
      detalhes: [
        { rotulo: 'Plano', valor: opts.plano },
        { rotulo: 'Condição', valor: `${opts.motivo} · sem cobrança` },
      ],
      botao: { texto: 'Ver o plano da loja', url: this.linkDoPlano },
      motivo: this.motivoCobranca,
    }, this.linkDoPlano);
  }

  /** A cortesia foi revogada: a loja volta ao trial com prazo para escolher um plano. */
  async sendCortesiaRevogada(opts: {
    to: string;
    dealerName: string;
    prazo: Date;
  }): Promise<void> {
    const prazo = this.dataCurta(opts.prazo);
    await this.enviar(opts.to, 'A cortesia da sua loja foi encerrada — AutoConnect', {
      etiqueta: 'Plano',
      titulo: 'A cortesia da sua loja foi encerrada',
      tom: 'atencao',
      preheader: `A loja tem até ${prazo} para escolher um plano. Nada foi apagado.`,
      paragrafos: [
        `Olá, equipe da <strong>${esc(opts.dealerName)}</strong>.`,
        `A cortesia da loja foi encerrada. A partir de agora ela volta ao período de teste e tem até ` +
          `<strong>${esc(prazo)}</strong> para escolher um plano.`,
        'Sem plano contratado depois dessa data, a loja passa a modo somente leitura. Nada é apagado.',
      ],
      detalhes: [{ rotulo: 'Prazo para escolher o plano', valor: prazo }],
      botao: { texto: 'Escolher um plano', url: this.linkDoPlano },
      motivo: this.motivoCobranca,
    }, this.linkDoPlano);
  }

  /* ── Peças ─────────────────────────────────────────────────── */

  /** Monta no layout único e envia. O assunto é cabeçalho, não HTML: vai cru. */
  private async enviar(to: string, assunto: string, conteudo: ConteudoDoEmail, devLink: string): Promise<void> {
    const html = montarEmail(conteudo, { webUrl: this.webUrl, suporte: CONTATO_SUPORTE });
    await this.send(to, assunto, html, devLink);
  }

  /** Texto do cliente ou da loja, em destaque. Recebe texto JÁ escapado. */
  private citacao(textoSeguro: string, rotulo = 'Mensagem do cliente'): string {
    return (
      `<span style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:6px">${rotulo}</span>` +
      `<span style="display:block;border-left:3px solid #cbd5e1;padding:4px 0 4px 12px;color:#334155;font-style:italic">“${textoSeguro}”</span>`
    );
  }

  private dataCurta(d: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo',
    }).format(d);
  }

  private brl(v: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency: 'BRL',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(v);
  }

  private formatWhen(d: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long', day: '2-digit', month: 'long',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(d);
  }

  private async send(to: string, subject: string, html: string, devLink: string): Promise<void> {
    if (this.resend) {
      // O SDK da Resend não lança: devolve { data, error }. Ler só o resultado
      // registrava "enviado" para e-mail recusado — domínio não verificado,
      // chave inválida — e o convite sumia sem ninguém saber.
      const { data, error } = await this.resend.emails.send({ from: this.from, to, subject, html });
      if (error) throw new Error(`Resend recusou o e-mail para ${to}: ${error.name} — ${error.message}`);
      this.logger.log(`E-mail enviado via Resend para ${to} | id: ${data.id}`);
      return;
    }

    if (this.smtp) {
      const info = await this.smtp.sendMail({ from: this.from, to, subject, html });
      this.logger.log(`E-mail enviado via Gmail para ${to} | messageId: ${info.messageId}`);
      return;
    }

    // Fallback: loga o link no console para testes locais
    this.logger.log(`[DEV] E-mail para ${to} | ${subject}\nLink: ${devLink}`);
  }
}
