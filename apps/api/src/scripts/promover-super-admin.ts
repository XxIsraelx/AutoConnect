/* eslint-disable no-console */
import { PrismaClient } from '@autoconnect/db';

/**
 * # Primeiro super admin de um banco novo
 *
 * ## O problema que isto resolve
 *
 * O piloto do primeiro dia encontrou um beco: num banco recém-migrado **não
 * havia caminho nenhum** para criar um `super_admin`. Sem super admin não se
 * emite convite de loja; sem convite não se criava a primeira concessionária.
 * Quem instalasse o AutoConnect do zero ficava preso, e o próprio piloto teve
 * de inserir a linha por SQL para começar.
 *
 * O cadastro em autosserviço tirou o convite do caminho da **loja**, mas o
 * painel da plataforma (`/admin`) continua precisando de alguém. Este comando é
 * esse alguém.
 *
 * ## Por que um comando, e não uma rota
 *
 * Rota de bootstrap é porta aberta: ela existe para sempre, responde na
 * internet e alguém acaba esquecendo de fechá-la. Um comando roda na máquina
 * (ou no shell do Railway) de quem já tem as credenciais do banco, não abre
 * porta nenhuma e não existe em tempo de execução da API.
 *
 * ## Três travas
 *
 * 1. **Variável de ambiente explícita.** `PROMOVER_SUPER_ADMIN_EMAIL` tem que
 *    estar definida. Não há argumento de linha de comando nem valor padrão:
 *    rodar o comando sem querer não faz nada.
 * 2. **Recusa se já houver super admin.** É um comando de *bootstrap*, não de
 *    gestão — promover o segundo é trabalho do painel, com trilha de auditoria
 *    e um humano responsável do outro lado. Isto impede que o comando vire um
 *    jeito de escalar privilégio num ambiente que já está de pé.
 * 3. **Promove quem já existe.** Não cria conta nem senha: a pessoa se cadastra
 *    normalmente e depois é promovida. Assim nenhuma senha passa por variável
 *    de ambiente, log de deploy ou histórico de shell.
 *
 * ## Como usar
 *
 * ```bash
 * # 1. A pessoa cria a conta dela pelo /signup (ou já tem uma)
 * # 2. Com o build feito (`turbo run build --filter=@autoconnect/api`):
 * DIRECT_URL="postgresql://..." \
 *   PROMOVER_SUPER_ADMIN_EMAIL="voce@exemplo.com" \
 *   node apps/api/dist/scripts/promover-super-admin.js
 * ```
 *
 * O script lê `process.env` cru — ele **não** carrega `.env`, de propósito:
 * quem roda um comando que promove privilégio deve dizer contra qual banco, em
 * vez de descobrir depois. Em produção, no shell do serviço da API no Railway,
 * as variáveis já estão no ambiente e basta a primeira linha.
 *
 * ⚠ **Promova uma conta dedicada, não o dono de uma loja.** O super admin sai
 * do `tenantId` (ver abaixo), então promover o único `tenant_admin` de uma
 * concessionária deixa aquela loja sem administrador.
 */

/** O que o comando fez, em vez de um `boolean` que não explica nada. */
export type ResultadoDaPromocao =
  | { ok: true; usuarioId: string; email: string; tenantAnterior: string | null }
  | { ok: false; motivo: 'ja-existe-super-admin'; quantos: number }
  | { ok: false; motivo: 'usuario-nao-encontrado'; email: string };

/**
 * Só o que a promoção toca. Aceita tanto o `PrismaClient` quanto um cliente de
 * transação — é o que deixa o teste rodar dentro de um `$transaction` que
 * desfaz tudo no fim, sem precisar apagar super admins de um banco
 * compartilhado com outras suítes.
 */
export type ClienteDaPromocao = Pick<PrismaClient, 'user' | 'auditLog'>;

export async function promoverSuperAdmin(
  db: ClienteDaPromocao,
  emailBruto: string,
): Promise<ResultadoDaPromocao> {
  const email = emailBruto.trim().toLowerCase();

  // A trava que importa: este comando é de bootstrap. Com um super admin vivo,
  // promover outro é decisão do painel — lá há ator, auditoria e alguém a quem
  // perguntar. Aqui não haveria.
  const quantos = await db.user.count({ where: { role: 'super_admin' } });
  if (quantos > 0) return { ok: false, motivo: 'ja-existe-super-admin', quantos };

  const usuario = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, tenantId: true },
  });
  if (!usuario) return { ok: false, motivo: 'usuario-nao-encontrado', email };

  await db.user.update({
    where: { id: usuario.id },
    data: {
      role: 'super_admin',
      // Super admin não pertence a loja nenhuma: `escopoDa` só devolve o escopo
      // global para quem está sem `tenantId`. Deixar o vínculo antigo faria a
      // conta continuar vendo só a própria loja, com o papel novo — o pior dos
      // dois mundos, porque parece que funcionou.
      tenantId: null,
      status: 'active',
      // Quem roda este comando tem as credenciais do banco; exigir dele o
      // clique no e-mail para depois entrar no painel seria cerimônia sem
      // ganho, e num ambiente novo o e-mail costuma nem estar configurado.
      emailVerifiedAt: new Date(),
    },
  });

  await db.auditLog.create({
    data: {
      action: 'super_admin_bootstrapped',
      entityType: 'user',
      entityId: usuario.id,
      diff: { email: usuario.email, tenantAnterior: usuario.tenantId },
    },
  });

  return { ok: true, usuarioId: usuario.id, email: usuario.email, tenantAnterior: usuario.tenantId };
}

/** Frase para o operador, por resultado. */
export function mensagemDaPromocao(r: ResultadoDaPromocao): string {
  if (r.ok) {
    return `OK: ${r.email} agora é super_admin. Entre em /admin com essa conta.`;
  }
  if (r.motivo === 'ja-existe-super-admin') {
    return (
      `Recusado: já existe ${r.quantos} super admin neste banco. Este comando só ` +
      'cria o primeiro — promova os demais pelo painel /admin, que registra quem promoveu quem.'
    );
  }
  return (
    `Recusado: não há usuário com o e-mail "${r.email}". Peça para a pessoa se ` +
    'cadastrar primeiro (a conta dela pode ser de qualquer papel) e rode de novo.'
  );
}

async function main(): Promise<number> {
  const email = process.env.PROMOVER_SUPER_ADMIN_EMAIL?.trim();
  if (!email) {
    console.error(
      'Defina PROMOVER_SUPER_ADMIN_EMAIL com o e-mail de um usuário que JÁ existe.\n' +
        'Exemplo: PROMOVER_SUPER_ADMIN_EMAIL="voce@exemplo.com" node apps/api/dist/scripts/promover-super-admin.js',
    );
    return 2;
  }

  // DIRECT_URL é a conexão dona das tabelas, que ignora RLS — a mesma do
  // `PrivilegedPrismaService`. Pela DATABASE_URL (papel `autoconnect_app`) a
  // consulta não enxergaria o usuário e o comando falharia dizendo que ele não
  // existe, que é a pior mensagem possível.
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DIRECT_URL (ou DATABASE_URL) não está definida.');
    return 2;
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const resultado = await promoverSuperAdmin(prisma, email);
    const texto = mensagemDaPromocao(resultado);
    if (resultado.ok) { console.log(texto); return 0; }
    console.error(texto);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Só roda quando chamado direto — importar o módulo (o teste faz isso) não
// pode disparar uma promoção.
if (require.main === module) {
  main().then(
    (codigo) => { process.exitCode = codigo; },
    (err: unknown) => { console.error(err); process.exitCode = 1; },
  );
}
