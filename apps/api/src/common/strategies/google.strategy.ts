import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private static readonly logger = new Logger(GoogleStrategy.name);

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const clientID = config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET');

    if (!clientID || !clientSecret) {
      GoogleStrategy.logger.warn(
        'GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET não configurados — Google OAuth desativado',
      );
    }

    super({
      clientID: clientID ?? 'not-configured',
      clientSecret: clientSecret ?? 'not-configured',
      callbackURL:
        config.get<string>('GOOGLE_CALLBACK_URL') ??
        'http://localhost:4000/api/v1/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): Promise<{ id: string; email: string; fullName: string | null; role: string; tenantId: string | null }> {
    const email = profile.emails?.[0]?.value;
    if (!email) throw new Error('Conta Google sem e-mail associado');

    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          fullName: profile.displayName ?? email.split('@')[0],
          avatarUrl: profile.photos?.[0]?.value ?? null,
          role: 'customer',
          status: 'active',
          emailVerifiedAt: new Date(),
          metadata: { googleId: profile.id },
        },
      });
    }

    return user;
  }
}
