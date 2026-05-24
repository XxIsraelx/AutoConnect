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

  private async send(to: string, subject: string, html: string, devLink: string): Promise<void> {
    if (this.resend) {
      await this.resend.emails.send({ from: this.from, to, subject, html });
      return;
    }

    if (this.smtp) {
      await this.smtp.sendMail({ from: this.from, to, subject, html });
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
