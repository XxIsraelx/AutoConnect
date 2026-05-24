import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { loginSchema, signupTenantSchema, signupCustomerSchema } from '@autoconnect/shared';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup-tenant')
  async signupTenant(@Body() body: unknown) {
    const parsed = signupTenantSchema.parse(body);
    return this.auth.signupTenant(parsed);
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
    res.redirect(`${webUrl}/auth/callback?token=${session.accessToken}&redirect=${redirect}`);
  }
}
