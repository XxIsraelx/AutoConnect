import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { EmailService } from '../../common/email/email.service';
import { AdminService } from '../admin/admin.service';
import type { LoginInput, SignupTenantInput, SignupCustomerInput } from '@autoconnect/shared';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    /** Privilegiada: o login procura o usuário por e-mail antes de saber a que concessionária ele pertence, e o cadastro cria o próprio tenant. */
    private readonly prisma: PrivilegedPrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly adminSvc: AdminService,
  ) {}

  async signupTenant(input: SignupTenantInput) {
    // 1. Valida o convite antes de qualquer outra coisa
    const invite = await this.prisma.tenantInvite.findUnique({
      where: { token: input.inviteToken },
    });
    if (!invite)                 throw new BadRequestException('Convite inválido');
    if (invite.usedAt)           throw new BadRequestException('Este convite já foi utilizado');
    if (invite.expiresAt < new Date()) throw new BadRequestException('Convite expirado');
    // Se o convite foi restrito a um e-mail específico, valida
    if (invite.email && invite.email.toLowerCase() !== input.admin.email.toLowerCase()) {
      throw new BadRequestException('Este convite é exclusivo para outro e-mail');
    }

    // 2. Verifica duplicidade
    const existsSlug = await this.prisma.tenant.findUnique({ where: { slug: input.tenant.slug } });
    if (existsSlug) throw new ConflictException('slug já em uso');

    const existsCNPJ = await this.prisma.tenant.findUnique({ where: { taxId: input.tenant.cnpj } });
    if (existsCNPJ) throw new ConflictException('CNPJ já cadastrado');

    const existsEmail = await this.prisma.user.findUnique({ where: { email: input.admin.email } });
    if (existsEmail) throw new ConflictException('email já cadastrado');

    // 3. Verifica situação do CNPJ na Receita Federal via BrasilAPI (não bloqueia se API estiver fora)
    try {
      // Sem timeout, uma BrasilAPI lenta segurava a requisição inteira.
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${input.tenant.cnpj}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        // A BrasilAPI devolve DOIS campos: `situacao_cadastral` é numérico
        // (2 = ativa) e `descricao_situacao_cadastral` é o texto ("ATIVA").
        // Comparar o numérico com a string rejeitava todo CNPJ válido.
        const data = await res.json() as {
          situacao_cadastral?: number | string;
          descricao_situacao_cadastral?: string;
        };

        const descricao = data.descricao_situacao_cadastral?.trim().toUpperCase();
        const codigo = Number(data.situacao_cadastral);
        const ativa = descricao ? descricao === 'ATIVA' : codigo === 2;

        // Só bloqueia quando a API respondeu algo conclusivo sobre a situação.
        const conclusivo = Boolean(descricao) || Number.isFinite(codigo);

        if (conclusivo && !ativa) {
          const situacao = descricao ?? `código ${codigo}`;

          // Registra tentativa de cadastro com CNPJ inativo no audit log
          this.prisma.auditLog.create({
            data: {
              action: 'signup_cnpj_rejected',
              entityType: 'tenant',
              diff: {
                cnpj: input.tenant.cnpj,
                situacao,
                email: input.admin.email,
              },
            },
          }).catch(() => null);

          throw new BadRequestException(
            `CNPJ com situação "${situacao}" na Receita Federal. Apenas CNPJs com situação ATIVA podem se cadastrar.`,
          );
        }
      }
    } catch (err) {
      // Lança BadRequestException se vier do check de situação cadastral
      if (err instanceof BadRequestException) throw err;
      this.logger.warn('BrasilAPI indisponível — situação CNPJ não verificada');
    }

    const passwordHash = await bcrypt.hash(input.admin.password, 10);

    // 4. Cria tenant + usuário + filial em transação
    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug:              input.tenant.slug,
          legalName:         input.tenant.legalName,
          tradeName:         input.tenant.tradeName,
          taxId:             input.tenant.cnpj,           // CNPJ (14 dígitos)
          stateRegistration: input.tenant.stateRegistration ?? null,
          primaryEmail:      input.tenant.primaryEmail,
          primaryPhone:      input.branch.phone,
          subscription: { create: { plan: 'trial', status: 'active' } },
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId:       tenant.id,
          email:          input.admin.email,
          fullName:       input.admin.fullName,
          phone:          input.admin.phone,
          cpf:            input.admin.cpf,
          jobTitle:       input.admin.jobTitle,
          passwordHash,
          role:           'tenant_admin',
          status:         'active',
          emailVerifiedAt: new Date(), // verificado via convite — skip email verification
        },
      });

      await tx.dealershipBranch.create({
        data: {
          tenantId:      tenant.id,
          name:          input.tenant.tradeName,
          isHeadquarters: true,
          phone:         input.branch.phone,
          email:         input.tenant.primaryEmail,
          postalCode:    input.branch.postalCode.replace(/\D/g, ''),
          addressLine:   input.branch.addressLine,
          addressNumber: input.branch.addressNumber,
          complement:    input.branch.complement ?? null,
          neighborhood:  input.branch.neighborhood,
          city:          input.branch.city,
          state:         input.branch.state.toUpperCase(),
        },
      });

      return { tenant, user };
    }, {
      // A API roda em outra região do banco (sfo -> sa-east-1), então cada
      // consulta paga a latência da travessia. Com os 5s padrão do Prisma a
      // transação estourava e o cadastro caía em "Internal server error"
      // com "Transaction not found ... old closed transaction".
      maxWait: 15_000,
      timeout: 30_000,
    });

    // 5. Marca convite como usado
    await this.adminSvc.validateAndConsumeInvite(input.inviteToken, result.tenant.id);

    return this.buildSession(result.user);
  }

  async signupCustomer(input: SignupCustomerInput) {
    const exists = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new ConflictException('email já cadastrado');

    const passwordHash = await bcrypt.hash(input.password, 10);

    // Normaliza CPF removendo formatação para armazenar
    const cpfNormalized = input.cpf?.replace(/\D/g, '') ?? null;

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          phone: input.phone ?? null,
          passwordHash,
          role: 'customer',
          status: 'active',
          // emailVerifiedAt permanece null até verificação
          metadata: {
            addressLine: input.addressLine ?? null,
            addressNumber: input.addressNumber ?? null,
            complement: input.complement ?? null,
            neighborhood: input.neighborhood ?? null,
          },
        },
      });

      // Cria CustomerProfile se tiver dados extras
      if (cpfNormalized || input.birthDate || input.city || input.state || input.postalCode) {
        await tx.customerProfile.create({
          data: {
            userId: created.id,
            documentNumber: cpfNormalized,
            birthDate: input.birthDate ? new Date(input.birthDate) : null,
            city: input.city ?? null,
            state: input.state ?? null,
            postalCode: input.postalCode ?? null,
          },
        });
      }

      return created;
    });

    // Gera token de verificação (JWT 24h, sem acesso à app)
    const verificationToken = this.jwt.sign(
      { sub: user.id, purpose: 'email-verification' },
      { expiresIn: '24h' },
    );

    // Envia e-mail de verificação (async, não bloqueia resposta)
    this.email.sendEmailVerification(user.email, user.fullName, verificationToken).catch((err: unknown) => this.logger.error('Falha ao enviar e-mail:', err));

    return { message: 'Cadastro realizado! Verifique seu e-mail para ativar a conta.' };
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Responde sempre com sucesso para não vazar se e-mail existe
    if (!user || user.emailVerifiedAt) return { message: 'Se o e-mail existir, um novo link foi enviado.' };

    const token = this.jwt.sign(
      { sub: user.id, purpose: 'email-verification' },
      { expiresIn: '24h' },
    );
    this.email.sendEmailVerification(user.email, user.fullName, token).catch((err: unknown) => this.logger.error('Falha ao enviar e-mail:', err));
    return { message: 'Se o e-mail existir, um novo link foi enviado.' };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Responde sempre com sucesso para não vazar se e-mail existe
    if (!user || !user.passwordHash) return { message: 'Se o e-mail existir, as instruções foram enviadas.' };

    const token = this.jwt.sign(
      { sub: user.id, purpose: 'password-reset' },
      { expiresIn: '1h' },
    );
    this.email.sendPasswordReset(user.email, user.fullName, token).catch((err: unknown) => this.logger.error('Falha ao enviar e-mail:', err));
    return { message: 'Se o e-mail existir, as instruções foram enviadas.' };
  }

  async resetPassword(token: string, newPassword: string) {
    let payload: { sub: string; purpose: string };
    try {
      payload = this.jwt.verify<{ sub: string; purpose: string }>(token);
    } catch {
      throw new BadRequestException('Link inválido ou expirado');
    }

    if (payload.purpose !== 'password-reset') {
      throw new BadRequestException('Token inválido');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new BadRequestException('Usuário não encontrado');

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return { message: 'Senha redefinida com sucesso.' };
  }

  async verifyEmail(token: string) {
    let payload: { sub: string; purpose: string };
    try {
      payload = this.jwt.verify<{ sub: string; purpose: string }>(token);
    } catch {
      throw new BadRequestException('Link inválido ou expirado');
    }

    if (payload.purpose !== 'email-verification') {
      throw new BadRequestException('Token inválido');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new BadRequestException('Usuário não encontrado');
    if (user.emailVerifiedAt) {
      // Já verificado — retorna sessão normalmente
      return this.buildSession(user);
    }

    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });

    return this.buildSession(verified);
  }

  async login(input: LoginInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('credenciais inválidas');
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('credenciais inválidas');

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Confirme seu e-mail antes de entrar');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.buildSession(user);
  }

  buildSession(user: {
    id: string;
    role: string;
    tenantId: string | null;
    email: string;
    fullName: string;
  }) {
    const accessToken = this.jwt.sign({
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
    });
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }
}
