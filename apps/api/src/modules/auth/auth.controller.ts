import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import {
  loginSchema,
  reenviarVerificacaoSchema,
  signupTenantSchema,
  signupCustomerSchema,
} from '@autoconnect/shared';
import { Public } from '../../common/decorators/public.decorator';
import { LimiteDeCadastro, LimiteDeReenvio } from './limite-de-cadastro';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly limiteDeCadastro: LimiteDeCadastro,
    private readonly limiteDeReenvio: LimiteDeReenvio,
  ) {}

  /**
   * Cadastro de concessionária — público desde 25/09/2026, com ou sem convite.
   *
   * O teto por IP é conferido **antes** do Zod de propósito: um script que
   * despeja corpos inválidos não pode sair de graça só porque o corpo não
   * passaria na validação.
   */
  @Post('signup-tenant')
  async signupTenant(@Body() body: unknown, @Req() req: Request) {
    // `req.ip` respeita o `trust proxy` do `app.setup`: atrás da borda do
    // Railway, sem ele todo visitante teria o mesmo IP e o terceiro cadastro do
    // dia barraria o mundo inteiro.
    this.exigirCota(this.limiteDeCadastro, req.ip, 'cadastros');
    const parsed = signupTenantSchema.parse(body);
    return this.auth.signupTenant(parsed);
  }

  /**
   * 429 com mensagem que diz o que fazer. Não consome cota quando recusa — ver
   * `LimitePorIp.permitir`.
   */
  private exigirCota(limite: LimiteDeCadastro | LimiteDeReenvio, ip: string | undefined, o_que: string) {
    if (limite.permitir(ip ?? 'desconhecido')) return;
    throw new HttpException(
      `Muitos ${o_que} a partir deste endereço. Tente novamente em uma hora, ` +
        'ou fale com a gente em contato@autoconnect.app.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  @Post('signup-customer')
  async signupCustomer(@Body() body: unknown) {
    const parsed = signupCustomerSchema.parse(body);
    return this.auth.signupCustomer(parsed);
  }

  @Get('verify-email')
  verifyEmail(@Query('token') token: string) {
    return this.auth.verifyEmail(token);
  }

  /**
   * Reenvia o link de confirmação. Público e com teto por IP: a rota manda
   * e-mail para um endereço escolhido por quem chama, e sem teto seria um canhão
   * de spam com o nosso remetente.
   */
  @Post('resend-verification')
  resendVerification(@Body() body: unknown, @Req() req: Request) {
    this.exigirCota(this.limiteDeReenvio, req.ip, 'pedidos de reenvio');
    const parsed = reenviarVerificacaoSchema.parse(body);
    return this.auth.resendVerification(parsed.email);
  }

  @Post('forgot-password')
  forgotPassword(@Body() body: { email: string }) {
    return this.auth.forgotPassword(body.email);
  }

  @Post('reset-password')
  resetPassword(@Body() body: { token: string; password: string }) {
    return this.auth.resetPassword(body.token, body.password);
  }

  @Post('login')
  async login(@Body() body: unknown) {
    const parsed = loginSchema.parse(body);
    return this.auth.login(parsed);
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    // Passport redireciona para o Google automaticamente
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  googleCallback(@Req() req: { user: Parameters<AuthService['buildSession']>[0] }, @Res() res: Response) {
    const session = this.auth.buildSession(req.user);
    const webUrl = process.env.WEB_URL ?? 'http://localhost:3000';
    const redirect = session.user.role === 'customer' ? '/buscar' : '/dashboard';
    // `/callback`, não `/auth/callback`: a página mora em `app/(auth)/callback`,
    // e o grupo entre parênteses não entra na URL. O caminho errado dava 404
    // depois de escolher a conta no Google.
    res.redirect(`${webUrl}/callback?token=${session.accessToken}&redirect=${redirect}`);
  }
}
