import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

/**
 * O callback do Google redireciona para uma página do `apps/web`. Durante meses
 * a API mandou para `/auth/callback`, mas a página mora em `app/(auth)/callback`
 * — grupo entre parênteses não entra na URL — e todo login com Google terminava
 * em 404 depois de escolher a conta. Teste da rota da API não pega isso sozinho:
 * aqui se confere também que a página de destino existe.
 */
describe('AuthController.googleCallback', () => {
  const webUrl = 'https://web.exemplo';
  const originalWebUrl = process.env.WEB_URL;

  beforeAll(() => {
    process.env.WEB_URL = webUrl;
  });
  afterAll(() => {
    process.env.WEB_URL = originalWebUrl;
  });

  function redirecionaPara(role: string): URL {
    const auth = {
      buildSession: (u: { role: string }) => ({ accessToken: 'tok', user: { role: u.role } }),
    } as unknown as AuthService;
    const redirect = jest.fn();
    new AuthController(auth).googleCallback(
      { user: { id: 'u', role, tenantId: null, email: 'a@b.c', fullName: 'A' } },
      { redirect } as unknown as Response,
    );
    return new URL(redirect.mock.calls[0][0] as string);
  }

  it('manda para /callback do web, com token e destino', () => {
    const url = redirecionaPara('customer');
    expect(url.origin).toBe(webUrl);
    expect(url.pathname).toBe('/callback');
    expect(url.searchParams.get('token')).toBe('tok');
    expect(url.searchParams.get('redirect')).toBe('/buscar');
    expect(redirecionaPara('tenant_admin').searchParams.get('redirect')).toBe('/dashboard');
  });

  it('a página de destino existe no apps/web', () => {
    const { pathname } = redirecionaPara('customer');
    const app = join(__dirname, '../../../../web/src/app');
    // A página pode estar solta ou dentro de um grupo `(nome)`.
    const candidatos = [join(app, pathname, 'page.tsx'), join(app, '(auth)', pathname, 'page.tsx')];
    expect(candidatos.some((c) => existsSync(c))).toBe(true);
  });
});
