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

// Mesma lógica do banco, para e-mail: com o Gmail preenchido no `.env` da raiz,
// a suíte mandava convite, agendamento e troca de verdade para endereços de
// teste, e cada boot do Nest abria conexão SMTP. Vazio aqui vence o `.env`
// (o @nestjs/config não sobrescreve process.env) e cai no log do console.
process.env.RESEND_API_KEY = '';
process.env.GMAIL_USER = '';
process.env.GMAIL_APP_PASSWORD = '';

// E para o Storage: com a chave do Supabase no `.env`, cada rodada gravava ~10
// PDFs de contrato fictício no bucket `documentos` de PRODUÇÃO — 272 arquivos
// em pastas de lojas que os testes criam e apagam. Sem as duas, o contrato é
// emitido e regerado sob demanda, só não é arquivado.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

// E para a assinatura eletrônica: sobrescreve, não `??=`. No dia em que o
// `.env` tiver a Clicksign configurada, a suíte criaria envelopes de verdade e
// mandaria convite de assinatura para os e-mails fictícios dos testes. O
// simulado roda em memória e não sai do processo.
process.env.ASSINATURA_FORNECEDOR = 'simulado';
process.env.ASSINATURA_WEBHOOK_SECRET = 'segredo-de-webhook-de-teste';
// E a credencial da Clicksign zerada: mesmo que alguém troque o fornecedor
// acima por engano, sem token a fábrica cai no indisponível e nenhuma
// requisição sai para a Clicksign.
process.env.CLICKSIGN_ACCESS_TOKEN = '';
process.env.CLICKSIGN_API_URL = '';

// E para a cobrança: mesma regra. No dia em que o `.env` tiver a Asaas
// configurada, a suíte criaria clientes e assinaturas de verdade na conta e
// mandaria cobrança para lojas fictícias. O simulado roda em memória e não sai
// do processo. Sobrescreve, não `??=`.
process.env.COBRANCA_FORNECEDOR = 'simulado';
process.env.COBRANCA_WEBHOOK_TOKEN = 'token-de-cobranca-de-teste';
// E a credencial da Asaas zerada: mesmo que alguém troque o fornecedor acima
// por engano, sem chave a fábrica cai no indisponível e nenhuma requisição sai.
process.env.ASAAS_API_KEY = '';
process.env.ASAAS_API_URL = '';

/** Nome do banco de teste, para os testes afirmarem onde estão conectados. */
export const BANCO_DE_TESTE = verificada.pathname.replace(/^\//, '');
