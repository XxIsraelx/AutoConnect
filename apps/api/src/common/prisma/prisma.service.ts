import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@autoconnect/db';

/**
 * Cliente dentro de uma transação com o contexto de isolamento já definido.
 * Não expõe `$transaction` nem `$connect` — quem está aqui dentro já está numa.
 */
export type ScopedClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Cliente Prisma compartilhado.
 *
 * Todo acesso a tabela com `tenant_id` passa por `withTenant`, e todo acesso a
 * tabela do consumidor final (favoritos, alertas, buscas salvas) passa por
 * `withUser`. As policies de RLS leem exatamente as variáveis que estes dois
 * métodos definem; uma consulta feita fora deles roda sem contexto e, quando a
 * aplicação conectar como `autoconnect_app`, não enxerga linha nenhuma.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Executa `fn` numa transação com `app.tenant_id` definido.
   *
   * Usa `set_config` e não `SET LOCAL` porque só a primeira aceita parâmetro:
   * a versão anterior interpolava o id direto na string SQL. O valor vinha do
   * JWT, mas era uma injeção esperando um bug na emissão do token.
   *
   * O terceiro argumento `true` limita o efeito à transação — a conexão volta
   * limpa ao pool, sem vazar o tenant para a próxima requisição.
   */
  async withTenant<T>(tenantId: string, fn: (tx: ScopedClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Executa `fn` numa transação com `app.user_id` definido, para as tabelas do
   * consumidor final — que não pertencem a uma concessionária e por isso se
   * isolam por usuário, não por tenant.
   */
  async withUser<T>(userId: string, fn: (tx: ScopedClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Consulta pública: roda **sem** contexto nenhum, de propósito.
   *
   * É o catálogo, o mapa e a página da concessionária — o que já está na
   * internet. Sem `app.tenant_id`, as policies de isolamento não casam e o que
   * sobra é exatamente `leitura_publica`: veículo anunciado, filial ativa,
   * loja ativa e o catálogo global de marcas e modelos.
   *
   * Existe para que "esta consulta é pública" seja uma decisão escrita no
   * código, e não a ausência de uma decisão.
   */
  async withPublic<T>(fn: (tx: ScopedClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => fn(tx));
  }

  /**
   * Os dois contextos ao mesmo tempo.
   *
   * Necessário quando a operação é de um cliente identificado *dentro* de uma
   * concessionária: a captura de lead, por exemplo, grava na tabela da loja
   * (precisa de `app.tenant_id`) e lê o cadastro do próprio cliente, que não
   * pertence a loja nenhuma (precisa de `app.user_id`).
   */
  async withTenantAndUser<T>(
    tenantId: string,
    userId: string,
    fn: (tx: ScopedClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return fn(tx);
    });
  }
}
