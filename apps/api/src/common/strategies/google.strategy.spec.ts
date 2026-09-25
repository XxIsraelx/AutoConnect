import { ConfigService } from '@nestjs/config';
import { GoogleStrategy } from './google.strategy';
import type { PrivilegedPrismaService } from '../prisma/privileged-prisma.service';

/**
 * O `.env.example` entrega `GOOGLE_CLIENT_ID=""`, e a API caía no boot com ele:
 * o `??` não pega string vazia, o passport recebia `""` e derrubava o processo
 * logo depois de logar "Google OAuth desativado". É o primeiro passo do README.
 */
describe('GoogleStrategy sem credenciais', () => {
  const prisma = {} as PrivilegedPrismaService;
  const config = (valores: Record<string, string>) =>
    ({ get: (chave: string) => valores[chave] }) as unknown as ConfigService;

  it('sobe com as variáveis vazias, como vêm do .env.example', () => {
    expect(
      () =>
        new GoogleStrategy(config({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }), prisma),
    ).not.toThrow();
  });

  it('sobe com as variáveis ausentes', () => {
    expect(() => new GoogleStrategy(config({}), prisma)).not.toThrow();
  });
});
