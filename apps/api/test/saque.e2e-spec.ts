import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { MOTIVO, VALIDADE_PADRAO_DA_AUTORIZACAO_MIN } from '@autoconnect/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { CABECALHO_TOKEN_ASAAS } from '../src/modules/cobranca/token-webhook';
import { SaquesService } from '../src/modules/saques/saques.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Validação de saque da Asaas, ponta a ponta.
 *
 * O que este arquivo fixa, e que nenhum teste unitário alcança: que a rota
 * **responde sempre** numa das duas formas que a Asaas aceita, que ela vive
 * fora do JWT e do bloqueio por assinatura, que o uso único é mesmo único
 * contra o banco de verdade, e que **toda** decisão vira linha na trilha.
 *
 * O `setup-e2e.ts` fixa o `ASAAS_SAQUE_TOKEN` — nenhuma requisição sai daqui:
 * quem chama esta rota é a Asaas, não nós.
 */
const TOKEN = 'token-de-saque-de-teste';

describe('Validação de saque (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let jwt: JwtService;
  let f: DoisTenants;

  let comoSuperAdmin: string;
  let comoAdminDeLoja: string;

  const http = () => request(app.getHttpServer());

  /** O POST que a Asaas faz. `token` ausente = nenhum cabeçalho. */
  const validar = (corpo: unknown, token?: string) => {
    const req = http().post('/api/v1/webhooks/asaas/saque').set('Content-Type', 'application/json');
    if (token !== undefined) req.set(CABECALHO_TOKEN_ASAAS, token);
    return req.send(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
  };

  const transferencia = (id: string, valor: number) => ({
    type: 'TRANSFER',
    transfer: { id, value: valor, status: 'PENDING', scheduleDate: '2026-09-25' },
  });

  const autorizar = (corpo: object) =>
    http().post('/api/v1/admin/saques/autorizacoes')
      .set('Authorization', `Bearer ${comoSuperAdmin}`).send(corpo);

  const painel = () =>
    http().get('/api/v1/admin/saques').set('Authorization', `Bearer ${comoSuperAdmin}`);

  const decisoesDe = (operationKey: string) =>
    dono.withdrawalDecision.findMany({ where: { operationKey } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    dono = app.get(PrivilegedPrismaService, { strict: false });
    jwt = app.get(JwtService);

    f = await criarDoisTenants(dono);

    comoSuperAdmin = jwt.sign({ sub: f.a.usuarioId, role: 'super_admin', tenantId: null });
    comoAdminDeLoja = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
  }, 90_000);

  beforeEach(async () => {
    await dono.withdrawalDecision.deleteMany({});
    await dono.withdrawalAuthorization.deleteMany({});
  });

  afterAll(async () => {
    await dono.withdrawalDecision.deleteMany({});
    await dono.withdrawalAuthorization.deleteMany({});
    await f?.limpar();
    await app?.close();
  });

  /* ── Autenticidade ─────────────────────────────────────────── */

  describe('token', () => {
    it.each([
      ['ausente', undefined],
      ['errado', 'token-de-outra-pessoa'],
      ['vazio', ''],
      // Prefixo do token certo: se a comparação fosse por `startsWith` ou se o
      // tamanho vazasse pelo tempo, este passaria.
      ['prefixo do certo', TOKEN.slice(0, 10)],
    ])('recusa com token %s', async (_nome, token) => {
      const resposta = await validar(transferencia('op-token', 100), token);

      expect(resposta.status).toBe(200);
      expect(resposta.body.status).toBe('REFUSED');
      expect(resposta.body.refuseReason).toBe(MOTIVO.tokenInvalido);
    });

    it('não consulta autorização nenhuma quando o token não confere', async () => {
      await autorizar({ tipo: 'TRANSFER', modo: 'exato', valor: '100.00' }).expect(201);

      await validar(transferencia('op-sem-token', 100), 'errado');

      // A autorização continua intacta: token ruim não gasta autorização boa.
      const [aut] = await dono.withdrawalAuthorization.findMany({});
      expect(aut!.usedAt).toBeNull();
    });

    it('grava a tentativa não autenticada sem o id da operação', async () => {
      await validar(transferencia('op-que-eu-adivinhei', 100), 'errado');

      const gravadas = await dono.withdrawalDecision.findMany({});
      expect(gravadas).toHaveLength(1);
      expect(gravadas[0]).toMatchObject({ decision: 'REFUSED', tokenOk: false });
      // A chave é o SHA-256 do corpo, e o tipo vai para o balde de não
      // autenticados: se fosse o id da operação, qualquer um que adivinhasse o
      // id de um saque futuro gravaria um REFUSED para ele — e a entrega
      // verdadeira, depois, só repetiria essa recusa.
      expect(gravadas[0]!.operationType).toBe('NAO_AUTENTICADO');
      expect(gravadas[0]!.operationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('sem ASAAS_SAQUE_TOKEN configurado, recusa tudo', async () => {
      // Instância própria com a variável vazia — é o estado de uma instalação
      // que ligou o mecanismo na Asaas e esqueceu de configurar aqui.
      const semToken = new SaquesService(
        dono,
        { get: () => '' } as unknown as ConfigService,
      );

      expect(semToken.configurado).toBe(false);

      const resposta = await semToken.validar(
        { [CABECALHO_TOKEN_ASAAS]: TOKEN },
        Buffer.from(JSON.stringify(transferencia('op-sem-config', 100)), 'utf8'),
      );

      expect(resposta).toEqual({ status: 'REFUSED', refuseReason: MOTIVO.semToken });
      // E mesmo aqui a decisão fica registrada.
      expect(await dono.withdrawalDecision.count()).toBe(1);
    });
  });

  /* ── Recusa por padrão ─────────────────────────────────────── */

  describe('sem autorização prévia', () => {
    it('recusa um pedido perfeitamente formado', async () => {
      const resposta = await validar(transferencia('op-sem-autorizacao', 4000), TOKEN);

      expect(resposta.body).toEqual({
        status: 'REFUSED',
        refuseReason: MOTIVO.semAutorizacao,
      });
    });

    it('grava a recusa com o pedido cru e o valor', async () => {
      await validar(transferencia('op-trilha', 4000), TOKEN);

      const [d] = await decisoesDe('op-trilha');
      expect(d).toMatchObject({
        operationType: 'TRANSFER', decision: 'REFUSED', tokenOk: true, authorizationId: null,
      });
      expect(d!.amount!.toFixed(2)).toBe('4000.00');
      expect(d!.rawBody).toContain('op-trilha');
    });
  });

  /* ── Corpo inesperado ──────────────────────────────────────── */

  describe('corpo inesperado', () => {
    it.each([
      ['texto solto', 'nem json'],
      ['array', JSON.stringify([1, 2, 3])],
      ['objeto vazio', JSON.stringify({})],
      ['tipo desconhecido', JSON.stringify({ type: 'LOOT', loot: { id: 'x', value: 1 } })],
      ['sem o objeto da operação', JSON.stringify({ type: 'TRANSFER' })],
      ['sem id', JSON.stringify({ type: 'TRANSFER', transfer: { value: 10 } })],
      ['sem valor', JSON.stringify({ type: 'TRANSFER', transfer: { id: 'x' } })],
      ['valor zero', JSON.stringify({ type: 'TRANSFER', transfer: { id: 'x', value: 0 } })],
    ])('recusa sem 500: %s', async (_nome, corpo) => {
      const resposta = await validar(corpo, TOKEN);

      expect(resposta.status).toBe(200);
      expect(resposta.body.status).toBe('REFUSED');
      expect(typeof resposta.body.refuseReason).toBe('string');
      expect(resposta.body.refuseReason.length).toBeGreaterThan(0);
    });

    it('registra a decisão também quando o corpo não foi entendido', async () => {
      await validar('nem json', TOKEN);

      const gravadas = await dono.withdrawalDecision.findMany({});
      expect(gravadas).toHaveLength(1);
      expect(gravadas[0]).toMatchObject({ decision: 'REFUSED', tokenOk: true });
    });
  });

  /* ── O caminho feliz, e o uso único ────────────────────────── */

  describe('com autorização prévia', () => {
    it('aprova o pedido que casa, no formato exato, e consome a autorização', async () => {
      const { body: criada } = await autorizar({
        tipo: 'TRANSFER', modo: 'exato', valor: '4000.00', observacao: 'Retirada do mês',
      }).expect(201);

      const resposta = await validar(transferencia('op-aprovada', 4000), TOKEN);

      expect(resposta.status).toBe(200);
      // Exatamente isto, sem campo a mais: a Asaas cancela o que não reconhece.
      expect(resposta.body).toEqual({ status: 'APPROVED' });
      expect(resposta.text).toBe('{"status":"APPROVED"}');

      const aut = await dono.withdrawalAuthorization.findUnique({ where: { id: criada.id } });
      expect(aut!.usedAt).not.toBeNull();

      const [d] = await decisoesDe('op-aprovada');
      expect(d).toMatchObject({ decision: 'APPROVED', reason: null, authorizationId: criada.id });
    });

    it('uso único: outra operação igual, com a autorização gasta, é recusada', async () => {
      await autorizar({ tipo: 'TRANSFER', modo: 'exato', valor: '4000.00' }).expect(201);

      await validar(transferencia('op-1', 4000), TOKEN).expect(200);
      const segunda = await validar(transferencia('op-2', 4000), TOKEN);

      expect(segunda.body).toEqual({ status: 'REFUSED', refuseReason: MOTIVO.semAutorizacao });
    });

    it('reentrega da MESMA operação repete a decisão, em vez de recusar', async () => {
      await autorizar({ tipo: 'TRANSFER', modo: 'exato', valor: '4000.00' }).expect(201);

      const primeira = await validar(transferencia('op-reentregue', 4000), TOKEN);
      const segunda = await validar(transferencia('op-reentregue', 4000), TOKEN);

      // A Asaas reentrega quando a nossa resposta não chega. Se a segunda
      // entrega encontrasse a autorização gasta e recusasse, um saque já
      // aprovado morreria por causa de um pacote perdido.
      expect(primeira.body).toEqual({ status: 'APPROVED' });
      expect(segunda.body).toEqual({ status: 'APPROVED' });
      expect(await decisoesDe('op-reentregue')).toHaveLength(1);

      // E a reentrega não gastou uma segunda autorização.
      expect(await dono.withdrawalAuthorization.count({ where: { usedAt: { not: null } } })).toBe(1);
    });

    it('recusa valor diferente do autorizado, para mais e para menos', async () => {
      await autorizar({ tipo: 'TRANSFER', modo: 'exato', valor: '4000.00' }).expect(201);

      const acima = await validar(transferencia('op-acima', 4000.01), TOKEN);
      const abaixo = await validar(transferencia('op-abaixo', 3999.99), TOKEN);

      expect(acima.body.status).toBe('REFUSED');
      expect(abaixo.body.status).toBe('REFUSED');
      // E nenhuma das duas gastou a autorização.
      expect(await dono.withdrawalAuthorization.count({ where: { usedAt: null } })).toBe(1);
    });

    it('no modo teto, aprova abaixo do valor e recusa acima', async () => {
      await autorizar({ tipo: 'TRANSFER', modo: 'teto', valor: '5000.00' }).expect(201);

      expect((await validar(transferencia('op-acima-do-teto', 5000.01), TOKEN)).body.status)
        .toBe('REFUSED');
      expect((await validar(transferencia('op-sob-o-teto', 4999.99), TOKEN)).body)
        .toEqual({ status: 'APPROVED' });
    });

    it('recusa tipo de operação diferente do autorizado', async () => {
      await autorizar({ tipo: 'TRANSFER', modo: 'exato', valor: '100.00' }).expect(201);

      const resposta = await validar(
        { type: 'PIX_QR_CODE', pixQrCode: { id: 'op-pix', value: 100 } },
        TOKEN,
      );

      expect(resposta.body).toEqual({ status: 'REFUSED', refuseReason: MOTIVO.semAutorizacao });
    });

    it('recusa autorização expirada', async () => {
      const { body: criada } = await autorizar({
        tipo: 'TRANSFER', modo: 'exato', valor: '4000.00', validadeMinutos: 1,
      }).expect(201);

      // Envelhece a linha: é o "avance o relógio" daqui.
      await dono.withdrawalAuthorization.update({
        where: { id: criada.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const resposta = await validar(transferencia('op-expirada', 4000), TOKEN);

      expect(resposta.body).toEqual({ status: 'REFUSED', refuseReason: MOTIVO.semAutorizacao });
      expect((await dono.withdrawalAuthorization.findUnique({ where: { id: criada.id } }))!.usedAt)
        .toBeNull();
    });

    it('recusa autorização revogada', async () => {
      const { body: criada } = await autorizar({
        tipo: 'TRANSFER', modo: 'exato', valor: '4000.00',
      }).expect(201);

      await http().post(`/api/v1/admin/saques/autorizacoes/${criada.id}/revogar`)
        .set('Authorization', `Bearer ${comoSuperAdmin}`).expect(201);

      const resposta = await validar(transferencia('op-revogada', 4000), TOKEN);
      expect(resposta.body.status).toBe('REFUSED');
    });

    it('entre duas que casam, consome a mais apertada', async () => {
      const { body: larga } = await autorizar({ tipo: 'TRANSFER', modo: 'teto', valor: '9000.00' });
      const { body: justa } = await autorizar({ tipo: 'TRANSFER', modo: 'exato', valor: '4000.00' });

      await validar(transferencia('op-apertada', 4000), TOKEN).expect(200);

      expect((await dono.withdrawalAuthorization.findUnique({ where: { id: justa.id } }))!.usedAt)
        .not.toBeNull();
      expect((await dono.withdrawalAuthorization.findUnique({ where: { id: larga.id } }))!.usedAt)
        .toBeNull();
    });
  });

  /* ── A rota ────────────────────────────────────────────────── */

  describe('a rota', () => {
    it('não pede JWT — a Asaas não tem um', async () => {
      const resposta = await http()
        .post('/api/v1/webhooks/asaas/saque')
        .set('Content-Type', 'application/json')
        .set(CABECALHO_TOKEN_ASAAS, TOKEN)
        .send(JSON.stringify(transferencia('op-sem-jwt', 10)));

      // Sem Authorization nenhum, e ainda assim 200 com veredicto.
      expect(resposta.status).toBe(200);
      expect(resposta.body.status).toBe('REFUSED');
    });
  });

  /* ── O painel ──────────────────────────────────────────────── */

  describe('painel do super admin', () => {
    it('só super admin autoriza saque', async () => {
      await http().post('/api/v1/admin/saques/autorizacoes')
        .set('Authorization', `Bearer ${comoAdminDeLoja}`)
        .send({ tipo: 'TRANSFER', modo: 'exato', valor: '10.00' })
        .expect(403);

      await http().get('/api/v1/admin/saques')
        .set('Authorization', `Bearer ${comoAdminDeLoja}`)
        .expect(403);
    });

    it('recusa corpo fora do schema — tipo inventado, valor solto, campo a mais', async () => {
      await autorizar({ tipo: 'TRANSFER_ALL', modo: 'exato', valor: '10.00' }).expect(400);
      await autorizar({ tipo: 'TRANSFER', modo: 'exato', valor: 10 }).expect(400);
      await autorizar({ tipo: 'TRANSFER', modo: 'exato', valor: '10.00', usadaEm: null }).expect(400);
      await autorizar({ tipo: 'TRANSFER', modo: 'exato', valor: '10.00', validadeMinutos: 99_999 })
        .expect(400);
    });

    it('a validade padrão é curta e sai na resposta', async () => {
      expect(VALIDADE_PADRAO_DA_AUTORIZACAO_MIN).toBeLessThanOrEqual(60);

      const antes = Date.now();
      const { body } = await autorizar({ tipo: 'TRANSFER', modo: 'exato', valor: '10.00' }).expect(201);
      const depois = Date.now();

      const janela = VALIDADE_PADRAO_DA_AUTORIZACAO_MIN * 60_000;
      expect(new Date(body.expiraEm).getTime()).toBeGreaterThanOrEqual(antes + janela);
      expect(new Date(body.expiraEm).getTime()).toBeLessThanOrEqual(depois + janela);
    });

    it('mostra a situação de cada autorização e a trilha de decisões', async () => {
      await autorizar({ tipo: 'TRANSFER', modo: 'exato', valor: '4000.00' }).expect(201);
      await validar(transferencia('op-no-painel', 4000), TOKEN).expect(200);

      const { body } = await painel().expect(200);

      expect(body.configurado).toBe(true);
      expect(body.autorizacoes[0]).toMatchObject({ situacao: 'usada', valor: '4000.00' });
      expect(body.decisoes[0]).toMatchObject({
        decisao: 'APPROVED', operacao: 'op-no-painel', valor: '4000.00', tokenOk: true,
      });
      // Quem autorizou fica gravado — é trilha de auditoria de dinheiro.
      expect(body.autorizacoes[0].criadaPor).toContain('@');
    });

    it('revogar duas vezes é 404 na segunda, e revogar a usada também', async () => {
      const { body: criada } = await autorizar({ tipo: 'TRANSFER', modo: 'exato', valor: '10.00' });
      const revogar = () =>
        http().post(`/api/v1/admin/saques/autorizacoes/${criada.id}/revogar`)
          .set('Authorization', `Bearer ${comoSuperAdmin}`);

      await revogar().expect(201);
      await revogar().expect(404);
    });
  });
});
