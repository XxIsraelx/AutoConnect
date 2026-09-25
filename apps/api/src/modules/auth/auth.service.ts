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
import {
  DURACAO_DO_TRIAL_DIAS,
  slugDeLoja,
  type LoginInput,
  type SignupTenantInput,
  type SignupCustomerInput,
} from '@autoconnect/shared';

const DIA_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    /** Privilegiada: o login procura o usuário por e-mail antes de saber a que concessionária ele pertence, e o cadastro cria o próprio tenant. */
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly adminSvc: AdminService,
  ) {}

  /**
   * Cadastro de concessionária — **em autosserviço desde 25/09/2026**.
   *
   * O convite de super admin continua funcionando e continua sendo consumido,
   * mas deixou de ser a porta: sem ele a loja nasce do mesmo jeito, com
   * assinatura em `trial` e `trialEndsAt` gravado. A diferença que sobra é o
   * e-mail: com convite a conta nasce **verificada** (o convite provou o
   * endereço); sem convite ela nasce por verificar, entra no painel na hora e
   * recebe o link por e-mail.
   */
  async signupTenant(input: SignupTenantInput) {
    // 1. Convite, quando vier. Sem ele o cadastro segue — é o autosserviço.
    const porConvite = Boolean(input.inviteToken);
    if (input.inviteToken) {
      const invite = await this.privilegiado.tenantInvite.findUnique({
        where: { token: input.inviteToken },
      });
      if (!invite)                 throw new BadRequestException('Convite inválido');
      if (invite.usedAt)           throw new BadRequestException('Este convite já foi utilizado');
      if (invite.expiresAt < new Date()) throw new BadRequestException('Convite expirado');
      // Se o convite foi restrito a um e-mail específico, valida
      if (invite.email && invite.email.toLowerCase() !== input.admin.email.toLowerCase()) {
        throw new BadRequestException('Este convite é exclusivo para outro e-mail');
      }
    }

    // 2. Verifica duplicidade
    const existsCNPJ = await this.privilegiado.tenant.findUnique({ where: { taxId: input.tenant.cnpj } });
    if (existsCNPJ) throw new ConflictException('CNPJ já cadastrado');

    const existsEmail = await this.privilegiado.user.findUnique({ where: { email: input.admin.email } });
    if (existsEmail) throw new ConflictException('email já cadastrado');

    const slug = await this.slugLivre(input.tenant.slug, input.tenant.tradeName);

    // 3. Verifica situação do CNPJ na Receita Federal via BrasilAPI.
    //
    // A regra dura é o dígito verificador, conferido pelo Zod. Esta consulta é
    // **enriquecimento**: só recusa quando a Receita responde algo conclusivo e
    // negativo (baixada, suspensa, inapta). Fora do ar, 404 de empresa nova,
    // 429 de limite de uso ou 5xx **não** impedem o cadastro — um serviço
    // gratuito de terceiro não pode ser ponto único de falha da porta de
    // entrada.
    /** Razão social que a Receita conhece — vazia quando ela não respondeu. */
    let razaoSocialDaReceita: string | null = null;
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
          razao_social?: string;
        };

        const descricao = data.descricao_situacao_cadastral?.trim().toUpperCase();
        const codigo = Number(data.situacao_cadastral);
        const ativa = descricao ? descricao === 'ATIVA' : codigo === 2;

        // Só bloqueia quando a API respondeu algo conclusivo sobre a situação.
        const conclusivo = Boolean(descricao) || Number.isFinite(codigo);

        if (conclusivo && !ativa) {
          const situacao = descricao ?? `código ${codigo}`;

          // Registra tentativa de cadastro com CNPJ inativo no audit log
          this.privilegiado.auditLog.create({
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

        // A razão social sai daqui, e não do formulário: ela deixou de ser
        // perguntada quando o cadastro caiu para cinco campos. A tela também a
        // manda quando consegue consultar — mas a API não pode depender disso,
        // porque é ela que responde por um corpo vindo de qualquer cliente.
        razaoSocialDaReceita = data.razao_social?.trim() || null;
      }
    } catch (err) {
      // Lança BadRequestException se vier do check de situação cadastral
      if (err instanceof BadRequestException) throw err;
      this.logger.warn('BrasilAPI indisponível — situação CNPJ não verificada');
    }

    const passwordHash = await bcrypt.hash(input.admin.password, 10);
    const primaryEmail = input.tenant.primaryEmail ?? input.admin.email;
    const telefone     = input.branch?.phone ?? input.tenant.primaryPhone ?? null;

    // 4. Cria tenant + usuário + filial em transação
    const result = await this.privilegiado.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug,
          // Sem convite a razão social costuma vir da Receita; quando ela não
          // responde, nasce igual ao nome fantasia e é confirmada em
          // `/configuracoes` — a mesma tela e o mesmo momento em que o contrato
          // já exige o representante legal antes de ser emitido.
          legalName:         input.tenant.legalName ?? razaoSocialDaReceita ?? input.tenant.tradeName,
          tradeName:         input.tenant.tradeName,
          taxId:             input.tenant.cnpj,           // CNPJ (14 dígitos)
          stateRegistration: input.tenant.stateRegistration ?? null,
          primaryEmail,
          primaryPhone:      telefone,
          subscription: {
            create: {
              plan: 'trial',
              status: 'active',
              // Antes nascia nulo: o "14 dias grátis" existia no HTML da home e
              // em lugar nenhum no banco, então nada sabia quando o teste acaba.
              trialEndsAt: new Date(Date.now() + DURACAO_DO_TRIAL_DIAS * DIA_MS),
            },
          },
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId:       tenant.id,
          email:          input.admin.email,
          fullName:       input.admin.fullName,
          phone:          input.admin.phone ?? null,
          cpf:            input.admin.cpf ?? null,
          jobTitle:       input.admin.jobTitle ?? null,
          passwordHash,
          role:           'tenant_admin',
          status:         'active',
          // Com convite, o e-mail já foi provado por quem emitiu o link. Sem
          // convite ele ainda não foi: a conta entra no painel do mesmo jeito e
          // o que exige verificação é nomeado em `EmailVerificadoGuard`.
          emailVerifiedAt: porConvite ? new Date() : null,
        },
      });

      await tx.dealershipBranch.create({
        data: {
          tenantId:      tenant.id,
          name:          input.tenant.tradeName,
          isHeadquarters: true,
          phone:         telefone,
          email:         primaryEmail,
          postalCode:    input.branch?.postalCode?.replace(/\D/g, '') ?? null,
          addressLine:   input.branch?.addressLine ?? null,
          addressNumber: input.branch?.addressNumber ?? null,
          complement:    input.branch?.complement ?? null,
          neighborhood:  input.branch?.neighborhood ?? null,
          city:          input.branch?.city ?? null,
          state:         input.branch?.state?.toUpperCase() ?? null,
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

    // 5. Marca convite como usado — só quando houve convite.
    if (input.inviteToken) {
      await this.adminSvc.validateAndConsumeInvite(input.inviteToken, result.tenant.id);
    } else {
      // Sem convite ninguém provou o e-mail. O link sai agora e **não** bloqueia
      // a resposta: um ambiente sem provedor de e-mail (o log do console é o
      // fallback) não pode impedir o primeiro acesso ao painel.
      this.enviarVerificacao(result.user).catch((err: unknown) =>
        this.logger.error('Falha ao enviar verificação de e-mail:', err),
      );
    }

    return this.buildSession(result.user);
  }

  /**
   * Um slug livre para a loja nova.
   *
   * O formulário deixou de pedir "slug (URL pública)" — não é palavra de
   * revendedor e era obrigatório antes de a pessoa ver qualquer tela. Quando
   * vem no corpo (convite, importação), é respeitado e a colisão é 409, como
   * sempre; quando é derivado do nome, a colisão vira sufixo, porque recusar o
   * cadastro por causa de um campo que o usuário nem preencheu seria pior.
   */
  private async slugLivre(pedido: string | undefined, tradeName: string): Promise<string> {
    if (pedido) {
      const existe = await this.privilegiado.tenant.findUnique({ where: { slug: pedido } });
      if (existe) throw new ConflictException('slug já em uso');
      return pedido;
    }

    // Nome sem nenhuma letra ou número aproveitável (só símbolos): cai numa
    // base genérica em vez de gerar slug vazio, que o banco recusaria.
    const base = slugDeLoja(tradeName) || 'loja';

    for (let tentativa = 0; tentativa < 25; tentativa++) {
      const candidato = tentativa === 0 ? base : `${base}-${tentativa + 1}`;
      const existe = await this.privilegiado.tenant.findUnique({ where: { slug: candidato } });
      if (!existe) return candidato;
    }

    // 25 lojas com o mesmo nome: desempata por sorteio em vez de recusar.
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Manda (ou remanda) o link de confirmação de e-mail. */
  private async enviarVerificacao(user: { id: string; email: string; fullName: string }) {
    const token = this.jwt.sign(
      { sub: user.id, purpose: 'email-verification' },
      { expiresIn: '24h' },
    );
    await this.email.sendEmailVerification(user.email, user.fullName, token);
  }

  async signupCustomer(input: SignupCustomerInput) {
    const exists = await this.privilegiado.user.findUnique({ where: { email: input.email } });
    if (exists) throw new ConflictException('email já cadastrado');

    const passwordHash = await bcrypt.hash(input.password, 10);

    // Normaliza CPF removendo formatação para armazenar
    const cpfNormalized = input.cpf?.replace(/\D/g, '') ?? null;

    const user = await this.privilegiado.$transaction(async (tx) => {
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
    const user = await this.privilegiado.user.findUnique({ where: { email } });
    // Responde sempre com sucesso para não vazar se e-mail existe
    if (!user || user.emailVerifiedAt) return { message: 'Se o e-mail existir, um novo link foi enviado.' };

    this.enviarVerificacao(user).catch((err: unknown) => this.logger.error('Falha ao enviar e-mail:', err));
    return { message: 'Se o e-mail existir, um novo link foi enviado.' };
  }

  async forgotPassword(email: string) {
    const user = await this.privilegiado.user.findUnique({ where: { email } });
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

    const user = await this.privilegiado.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new BadRequestException('Usuário não encontrado');

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.privilegiado.user.update({
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

    const user = await this.privilegiado.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new BadRequestException('Usuário não encontrado');
    if (user.emailVerifiedAt) {
      // Já verificado — retorna sessão normalmente
      return this.buildSession(user);
    }

    const verified = await this.privilegiado.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });

    return this.buildSession(verified);
  }

  async login(input: LoginInput) {
    const user = await this.privilegiado.user.findUnique({
      where: { email: input.email },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('credenciais inválidas');
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('credenciais inválidas');

    // Consumidor final continua tendo que confirmar o e-mail para entrar: a
    // conta dele só serve para favoritar, alertar e conversar com a loja, e
    // nada disso tem valor com um endereço que não é dele.
    //
    // A loja, não. Desde que o cadastro passou a ser em autosserviço, barrar o
    // segundo login do dono num e-mail que pode nunca chegar (ambiente sem
    // provedor configurado, spam, domínio corporativo) tornaria o produto
    // inacessível logo depois de ele ter acabado de criá-lo. Quem cobra a
    // verificação é o `EmailVerificadoGuard`, nas ações que saem da loja —
    // convidar equipe e publicar anúncio.
    if (!user.emailVerifiedAt && user.role === 'customer') {
      throw new UnauthorizedException('Confirme seu e-mail antes de entrar');
    }

    await this.privilegiado.user.update({
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
    emailVerifiedAt?: Date | null;
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
        // A tela usa isto para a faixa "confirme seu e-mail". Fora do JWT de
        // propósito: um token de 15 minutos guardaria um "não verificado" que
        // já não é verdade, e quem decide de fato é o guard, que lê o banco.
        emailVerified: user.emailVerifiedAt === undefined ? undefined : Boolean(user.emailVerifiedAt),
      },
    };
  }
}
