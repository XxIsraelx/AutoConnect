import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import type { LoginInput, SignupTenantInput, SignupCustomerInput } from '@autoconnect/shared';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  async signupTenant(input: SignupTenantInput) {
    const existsSlug = await this.prisma.tenant.findUnique({
      where: { slug: input.tenant.slug },
    });
    if (existsSlug) throw new ConflictException('slug já em uso');

    const existsEmail = await this.prisma.user.findUnique({
      where: { email: input.admin.email },
    });
    if (existsEmail) throw new ConflictException('email já cadastrado');

    const passwordHash = await bcrypt.hash(input.admin.password, 10);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug: input.tenant.slug,
          legalName: input.tenant.legalName,
          tradeName: input.tenant.tradeName,
          taxId: input.tenant.taxId,
          primaryEmail: input.tenant.primaryEmail,
          primaryPhone: input.tenant.primaryPhone,
          subscription: { create: { plan: 'trial', status: 'active' } },
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.admin.email,
          fullName: input.admin.fullName,
          passwordHash,
          role: 'tenant_admin',
          status: 'active',
        },
      });

      return { tenant, user };
    });

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
    this.email.sendEmailVerification(user.email, user.fullName, verificationToken).catch(() => {});

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
    this.email.sendEmailVerification(user.email, user.fullName, token).catch(() => {});
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
    this.email.sendPasswordReset(user.email, user.fullName, token).catch(() => {});
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
