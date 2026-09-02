/**
 * Aponta os testes de integração para o Postgres de teste — e recusa rodar
 * contra qualquer outro banco.
 *
 * Isto roda em `setupFiles`, ou seja, ANTES do arquivo de teste ser importado
 * e portanto antes do `AppModule` e do PrismaClient lerem o ambiente.
 *
 * Por que a trava existe: o `.env` da raiz aponta para o Supabase de produção
 * e o `ConfigModule` da app o carrega. Sem definir a variável aqui, um
 * `migrate deploy` ou um teste que escreve rodaria contra o banco real dos
 * clientes. O `@nestjs/config` não sobrescreve o que já está em `process.env`,
 * então definir aqui basta — e a verificação abaixo garante que ninguém
 * aponte para produção por engano ao exportar a variável no shell.
 */

const PADRAO = 'postgresql://postgres:postgres@localhost:55432/autoconnect_test';

const url = process.env.DATABASE_URL ?? PADRAO;

function exigirBancoDeTeste(bruta: string): URL {
  let alvo: URL;
  try {
    alvo = new URL(bruta);
  } catch {
    throw new Error(`DATABASE_URL inválida para testes: ${bruta}`);
  }

  const local = ['localhost', '127.0.0.1', '::1', 'postgres', 'db'];
  if (!local.includes(alvo.hostname)) {
    throw new Error(
      `Testes de integração recusados: DATABASE_URL aponta para "${alvo.hostname}", ` +
        'que não é um host local. Eles apagam e recriam dados — rode contra o ' +
        'Postgres do docker-compose.test.yml.',
    );
  }

  const banco = alvo.pathname.replace(/^\//, '');
  if (!banco.endsWith('_test')) {
    throw new Error(
      `Testes de integração recusados: o banco "${banco}" não termina em "_test". ` +
        'Use autoconnect_test para não escrever num banco de trabalho.',
    );
  }

  return alvo;
}

const verificada = exigirBancoDeTeste(url);

process.env.DATABASE_URL = verificada.toString();

// DIRECT_URL é a conexão dona das tabelas — a do `PrivilegedPrismaService`, que
// precisa ignorar RLS. Só cai para a DATABASE_URL quando não é informada, que é
// o caso em que ambas apontam para o dono e o RLS fica inerte.
//
// Para exercitar o RLS de verdade, aponte a DATABASE_URL para `autoconnect_app`
// e a DIRECT_URL para o dono: é assim que a aplicação roda em produção depois
// da virada.
process.env.DIRECT_URL = exigirBancoDeTeste(
  process.env.DIRECT_URL ?? verificada.toString(),
).toString();
process.env.NODE_ENV = 'test';
// Segredo fixo para os testes: o JwtModule falha ao subir sem ele.
process.env.JWT_SECRET ??= 'segredo-de-teste-nao-usar-em-producao';

/** Nome do banco de teste, para os testes afirmarem onde estão conectados. */
export const BANCO_DE_TESTE = verificada.pathname.replace(/^\//, '');
