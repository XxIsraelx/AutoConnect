import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
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
      });
      this.from = `AutoConnect <${gmailUser}>`;
      this.logger.log(`E-mail via Gmail ativado (${gmailUser})`);
    } else {
      this.from = 'AutoConnect <no-reply@autoconnect.app>';
      this.logger.warn('Nenhum provedor de e-mail configurado — links serão logados no console');
    }
  }

  async sendPasswordReset(to: string, name: string, token: string): Promise<void> {
    const link = `${this.webUrl}/redefinir-senha?token=${token}`;
    const subject = 'Redefinir senha — AutoConnect';
    const html = this.buildHtml(
      `Olá, ${name}!`,
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
      `Olá, ${name}!`,
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
    const { to, dealerName, customerName, vehicleInfo, message, leadUrl } = opts;
    const subject = `Novo interesse recebido — ${vehicleInfo}`;
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
      `A <b>${opts.tenantName}</b> convidou você para fazer parte da equipe como <b>${opts.roleLabel}</b> no AutoConnect. Clique abaixo para criar sua conta e começar.`,
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
        `<strong>${opts.customerName}</strong> solicitou <strong>${opts.typeLabel.toLowerCase()}</strong>`,
        opts.vehicleInfo ? ` do veículo <strong>${opts.vehicleInfo}</strong>` : '',
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
    const titles = {
      confirmed:   'Agendamento confirmado ✅',
      canceled:    'Agendamento cancelado',
      rescheduled: 'Agendamento reagendado 🔄',
    };
    const bodies = {
      confirmed:   `Sua solicitação de <strong>${opts.typeLabel.toLowerCase()}</strong>${opts.vehicleInfo ? ` do <strong>${opts.vehicleInfo}</strong>` : ''} na <strong>${opts.dealerName}</strong> foi confirmada para <strong>${whenStr}</strong>. Te esperamos lá!`,
      canceled:    `Seu <strong>${opts.typeLabel.toLowerCase()}</strong>${opts.vehicleInfo ? ` do <strong>${opts.vehicleInfo}</strong>` : ''} na <strong>${opts.dealerName}</strong>, marcado para <strong>${whenStr}</strong>, foi cancelado. Entre em contato com a loja para remarcar.`,
      rescheduled: `Seu <strong>${opts.typeLabel.toLowerCase()}</strong>${opts.vehicleInfo ? ` do <strong>${opts.vehicleInfo}</strong>` : ''} na <strong>${opts.dealerName}</strong> foi reagendado para <strong>${whenStr}</strong>.`,
    };
    const html = this.buildHtml(
      `Olá, ${opts.customerName}!`,
      `${titles[opts.status]}<br/><br/>${bodies[opts.status]}`,
      link,
      'Ver meus agendamentos',
      'Você pode acompanhar seus agendamentos na sua área de cliente.',
    );
    await this.send(opts.to, `${titles[opts.status].replace(/ [✅🔄]$/u, '')} — ${opts.dealerName}`, html, link);
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
      const result = await this.resend.emails.send({ from: this.from, to, subject, html });
      this.logger.log(`E-mail enviado via Resend para ${to} | id: ${(result as { id?: string }).id ?? 'n/a'}`);
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
        <a href="${link}"
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
