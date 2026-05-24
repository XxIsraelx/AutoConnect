import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly webUrl: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = config.get<string>('EMAIL_FROM') ?? 'AutoConnect <no-reply@autoconnect.app>';
    this.webUrl = config.get<string>('WEB_URL') ?? 'http://localhost:3000';

    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY não configurado — e-mails serão logados no console');
    }
  }

  async sendPasswordReset(to: string, name: string, token: string): Promise<void> {
    const link = `${this.webUrl}/redefinir-senha?token=${token}`;

    if (!this.resend) {
      this.logger.log(`[DEV] Link de redefinição de senha para ${to}: ${link}`);
      return;
    }

    await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Redefinir senha — AutoConnect',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
          <h2 style="font-size:22px;font-weight:700;margin-bottom:8px">Olá, ${name}!</h2>
          <p style="color:#64748b;margin-bottom:24px">
            Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha.
          </p>
          <a href="${link}"
             style="display:inline-block;background:#3B82F6;color:#fff;font-weight:600;
                    padding:12px 28px;border-radius:10px;text-decoration:none;font-size:14px">
            Redefinir senha
          </a>
          <p style="margin-top:24px;color:#94a3b8;font-size:12px">
            Este link expira em 1 hora. Se você não solicitou a redefinição, ignore este e-mail — sua senha permanece a mesma.
          </p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
          <p style="color:#94a3b8;font-size:12px">AutoConnect · Plataforma para concessionárias</p>
        </div>
      `,
    });
  }

  async sendEmailVerification(to: string, name: string, token: string): Promise<void> {
    const link = `${this.webUrl}/verificar-email?token=${token}`;

    if (!this.resend) {
      this.logger.log(`[DEV] Link de verificação para ${to}: ${link}`);
      return;
    }

    await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Confirme seu e-mail — AutoConnect',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
          <h2 style="font-size:22px;font-weight:700;margin-bottom:8px">Olá, ${name}!</h2>
          <p style="color:#64748b;margin-bottom:24px">
            Clique no botão abaixo para confirmar seu e-mail e ativar sua conta no AutoConnect.
          </p>
          <a href="${link}"
             style="display:inline-block;background:#3B82F6;color:#fff;font-weight:600;
                    padding:12px 28px;border-radius:10px;text-decoration:none;font-size:14px">
            Confirmar e-mail
          </a>
          <p style="margin-top:24px;color:#94a3b8;font-size:12px">
            Este link expira em 24 horas. Se você não criou uma conta, ignore este e-mail.
          </p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
          <p style="color:#94a3b8;font-size:12px">AutoConnect · Plataforma para concessionárias</p>
        </div>
      `,
    });
  }
}
