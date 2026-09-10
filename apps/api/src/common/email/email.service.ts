import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';

/**
 * Escapa texto para dentro do HTML do e-mail.
 *
 * Nome do cliente, mensagem do lead e observação da loja vêm de formulário.
 * Sem isto, um "cliente" chamado `<a href="...">Clique aqui</a>` punha um link
 * de phishing no e-mail que a concessionária recebe com a nossa marca.
 */
export function esc(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

  async sendPasswordReset(to: string, name: string, token: string): Promise<void> {
    const link = `${this.webUrl}/redefinir-senha?token=${token}`;
    const subject = 'Redefinir senha — AutoConnect';
    const html = this.buildHtml(
      `Olá, ${esc(name)}!`,
      'Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha.',
      link,
      'Redefinir senha',
      'Este link expira em 1 hora. Se você não solicitou a redefinição, ignore este e-mail — sua senha permanece a mesma.',
    );
    await this.send(to, subject, html, link);
  }

  async sendEmailVerification(to: string, name: string, token: string): Promise<void> {
    const link = `${this.webUrl}/verificar-email?token=${token}`;
    const subject = 'Confirme seu e-mail — AutoConnect';
    const html = this.buildHtml(
      `Olá, ${esc(name)}!`,
      'Clique no botão abaixo para confirmar seu e-mail e ativar sua conta no AutoConnect.',
      link,
      'Confirmar e-mail',
      'Este link expira em 24 horas. Se você não criou uma conta, ignore este e-mail.',
    );
    await this.send(to, subject, html, link);
  }

  async sendLeadNotification(opts: {
    to: string;
    dealerName: string;
    customerName: string;
    vehicleInfo: string;
    message: string | null;
    leadUrl: string;
  }): Promise<void> {
    const { to, leadUrl } = opts;
    const { dealerName, customerName, vehicleInfo, message } = escaparTexto(opts);
    const subject = `Novo interesse recebido — ${opts.vehicleInfo}`;
    const bodyText = [
      `<strong>${customerName}</strong> demonstrou interesse em <strong>${vehicleInfo}</strong>.`,
      message
        ? `<br/><br/><em>Mensagem do cliente:</em><br/>"${message}"`
        : '',
    ].join('');

    const html = this.buildHtml(
      `Novo lead para ${dealerName}!`,
      bodyText,
      leadUrl,
      'Ver lead no dashboard',
      'Acesse o painel para entrar em contato com o cliente e atualizar o status do lead.',
    );
    await this.send(to, subject, html, leadUrl);
  }

  async sendTeamInvite(opts: {
    to: string;
    inviteUrl: string;
    roleLabel: string;
    tenantName: string;
  }): Promise<void> {
    const subject = `Convite para a equipe da ${opts.tenantName}`;
    const html = this.buildHtml(
      `Você foi convidado! 🎉`,
      `A <b>${esc(opts.tenantName)}</b> convidou você para fazer parte da equipe como <b>${esc(opts.roleLabel)}</b> no AutoConnect. Clique abaixo para criar sua conta e começar.`,
      opts.inviteUrl,
      'Aceitar convite',
      'Este convite expira em 7 dias. Se você não esperava este e-mail, pode ignorá-lo.',
    );
    await this.send(opts.to, subject, html, opts.inviteUrl);
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
    const whenStr = this.formatWhen(opts.when);
    const link = `${this.webUrl}/agendamentos`;
    const html = this.buildHtml(
      `Novo agendamento solicitado 📅`,
      [
        `<strong>${esc(opts.customerName)}</strong> solicitou <strong>${esc(opts.typeLabel.toLowerCase())}</strong>`,
        opts.vehicleInfo ? ` do veículo <strong>${esc(opts.vehicleInfo)}</strong>` : '',
        ` para <strong>${whenStr}</strong>.`,
      ].join(''),
      link,
      'Ver agendamentos',
      'Confirme o horário no painel para o cliente receber a confirmação.',
    );
    await this.send(opts.to, `Novo agendamento — ${opts.customerName} · ${whenStr}`, html, link);
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
    const whenStr = this.formatWhen(opts.when);
    const link = `${this.webUrl}/perfil`;
    const e = escaparTexto(opts);
    const titles = {
      confirmed:   'Agendamento confirmado ✅',
      canceled:    'Agendamento cancelado',
      rescheduled: 'Agendamento reagendado 🔄',
    };
    const bodies = {
      confirmed:   `Sua solicitação de <strong>${e.typeLabel.toLowerCase()}</strong>${e.vehicleInfo ? ` do <strong>${e.vehicleInfo}</strong>` : ''} na <strong>${e.dealerName}</strong> foi confirmada para <strong>${whenStr}</strong>. Te esperamos lá!`,
      canceled:    `Seu <strong>${e.typeLabel.toLowerCase()}</strong>${e.vehicleInfo ? ` do <strong>${e.vehicleInfo}</strong>` : ''} na <strong>${e.dealerName}</strong>, marcado para <strong>${whenStr}</strong>, foi cancelado. Entre em contato com a loja para remarcar.`,
      rescheduled: `Seu <strong>${e.typeLabel.toLowerCase()}</strong>${e.vehicleInfo ? ` do <strong>${e.vehicleInfo}</strong>` : ''} na <strong>${e.dealerName}</strong> foi reagendado para <strong>${whenStr}</strong>.`,
    };
    const html = this.buildHtml(
      `Olá, ${e.customerName}!`,
      `${titles[opts.status]}<br/><br/>${bodies[opts.status]}`,
      link,
      'Ver meus agendamentos',
      'Você pode acompanhar seus agendamentos na sua área de cliente.',
    );
    await this.send(opts.to, `${titles[opts.status].replace(/ [✅🔄]$/u, '')} — ${opts.dealerName}`, html, link);
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
    const whenStr = this.formatWhen(opts.when);
    const link = `${this.webUrl}/perfil`;
    const e = escaparTexto(opts);
    const html = this.buildHtml(
      `Lembrete: seu ${e.typeLabel.toLowerCase()} está chegando ⏰`,
      `Olá, ${e.customerName}! Passando para lembrar do seu <strong>${e.typeLabel.toLowerCase()}</strong>${e.vehicleInfo ? ` do <strong>${e.vehicleInfo}</strong>` : ''} na <strong>${e.dealerName}</strong>, marcado para <strong>${whenStr}</strong>. Te esperamos lá!`,
      link,
      'Ver meus agendamentos',
      'Se precisar remarcar ou cancelar, acesse sua área de cliente ou entre em contato com a loja.',
    );
    await this.send(opts.to, `Lembrete — ${opts.typeLabel} em ${opts.dealerName}`, html, link);
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
    const subject = `📉 Baixou de preço: ${opts.vehicleInfo}`;
    const html = this.buildHtml(
      `Boa notícia, ${esc(opts.name)}! 🎉`,
      `O <strong>${esc(opts.vehicleInfo)}</strong> que você está monitorando agora está por <strong>${this.brl(opts.price)}</strong> — dentro do alvo de ${this.brl(opts.target)} que você definiu. Corra antes que acabe!`,
      opts.link,
      'Ver veículo',
      'Você recebeu este e-mail porque criou um alerta de preço no AutoConnect. O alerta deste veículo não será reenviado.',
    );
    await this.send(opts.to, subject, html, opts.link);
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
    const body = [
      `<strong>${esc(opts.customerName)}</strong> ofereceu um veículo na troca: <strong>${esc(opts.offeredVehicle)}</strong>.`,
      opts.desiredVehicle ? `<br/><br/>Interesse de compra: <strong>${esc(opts.desiredVehicle)}</strong>.` : '',
      opts.fipeReference != null ? `<br/>Referência FIPE do usado: <strong>${this.brl(opts.fipeReference)}</strong>.` : '',
      opts.expectedValue != null ? `<br/>Valor esperado pelo cliente: <strong>${this.brl(opts.expectedValue)}</strong>.` : '',
    ].join('');
    const html = this.buildHtml(
      `Nova proposta de troca 🔁`,
      body,
      link,
      'Avaliar no dashboard',
      'Abra o lead para ver os detalhes do veículo e enviar sua avaliação ao cliente.',
    );
    await this.send(opts.to, `Proposta de troca — ${opts.customerName}`, html, link);
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
    const abatement =
      opts.desiredPrice != null
        ? `<br/><br/>Aplicando na compra do <strong>${esc(opts.desiredVehicle ?? 'veículo desejado')}</strong> (${this.brl(opts.desiredPrice)}), você pagaria <strong>${this.brl(Math.max(0, opts.desiredPrice - opts.value))}</strong> de diferença.`
        : '';
    const html = this.buildHtml(
      `Olá, ${esc(opts.customerName)}! Avaliamos seu carro 🔁`,
      `A <strong>${esc(opts.dealerName)}</strong> avaliou seu <strong>${esc(opts.offeredVehicle)}</strong> em <strong>${this.brl(opts.value)}</strong> para a troca.${abatement}${opts.note ? `<br/><br/><em>Observação da loja:</em> "${esc(opts.note)}"` : ''}`,
      link,
      'Ver detalhes',
      'Esta é uma avaliação inicial e pode mudar após a vistoria presencial do veículo.',
    );
    await this.send(opts.to, `Avaliação da sua troca — ${opts.dealerName}`, html, link);
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

  private buildHtml(
    title: string,
    body: string,
    link: string,
    btnText: string,
    footer: string,
  ): string {
    return `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="font-size:22px;font-weight:700;margin-bottom:8px">${title}</h2>
        <p style="color:#64748b;margin-bottom:24px">${body}</p>
        <a href="${esc(link)}"
           style="display:inline-block;background:#3B82F6;color:#fff;font-weight:600;
                  padding:12px 28px;border-radius:10px;text-decoration:none;font-size:14px">
          ${btnText}
        </a>
        <p style="margin-top:24px;color:#94a3b8;font-size:12px">${footer}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
        <p style="color:#94a3b8;font-size:12px">AutoConnect · Plataforma para concessionárias</p>
      </div>
    `;
  }
}
