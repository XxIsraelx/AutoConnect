import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { LoginInput, SignupTenantInput } from '@autoconnect/shared';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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

  async login(input: LoginInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('credenciais inválidas');
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('credenciais inválidas');

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
