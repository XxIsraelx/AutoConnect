import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PROVEDOR_DE_RENAVE } from '../src/modules/renave/provedor';
import {
  CODIGO_RECUSADO_NO_SIMULADO, ProvedorRenaveSimulado,
} from '../src/modules/renave/provedor-simulado';
import { comoApp, criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

const CHAVE_NFE = '35261011222333000181550010000012341123456787';
/** O código de segurança do CRV dos testes — não pode aparecer em lugar nenhum do banco. */
const CODIGO_CRV = '73915264801';
/** RENAVAM e vendedor não vão no corpo: vêm de `vehicle_fiscal_details` e `acquisition_suppliers`. */
const crv = (codigo = CODIGO_CRV) => ({ tipoCrv: 'DIGITAL', codigoSegurancaCrv: codigo });

/**
 * RENAVE pela integradora — R2 do plano fiscal, com a integradora simulada.
 *
 * O que este arquivo fixa:
 *
 *  1. o código de segurança do CRV vai à integradora e **não fica** no banco;
 *  2. o estado de um registro da integradora vem dela — por resposta, webhook
 *     ou consulta — e nunca da anotação manual;
 *  3. o webhook confere a autenticidade sobre o corpo cru, é idempotente e
 *     acha a loja sem expor a de ninguém;
 *  4. envio que ficou no meio do caminho é retomado com a mesma chave;
 *  5. o ATPV-e sai pela API, só para a loja dona.
 */
describe('RENAVE — integradora simulada (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let prisma: PrismaService;
  let simulado: ProvedorRenaveSimulado;
  let f: DoisTenants;
  let comoGerente: string;
  let comoDono: string;
  let comoOutraLoja: string;
  let veiculo: string;
  let entradaId: string;
  let entradaExterna: string;
  let negocioId: string;
  let aquisicaoId: string;
  let saidaId: string;

  const http = () => request(app.getHttpServer());
  const get = (c: string, token = comoGerente) =>
    http().get(`/api/v1/renave${c}`).set('Authorization', `Bearer ${token}`);
  const post = (c: string, body: object, token = comoGerente) =>
    http().post(`/api/v1/renave${c}`).set('Authorization', `Bearer ${token}`).send(body);
  /** Pela rota HTTP de verdade, com o corpo como texto — os bytes do HMAC. */
  const webhook = (cabecalhos: Record<string, string>, corpo: Buffer) =>
    http().post('/api/v1/webhooks/renave').set(cabecalhos).send(corpo.toString('utf8'));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    prisma = app.get(PrismaService);
    simulado = app.get(PROVEDOR_DE_RENAVE, { strict: false });
    const jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);
    veiculo = f.a.veiculoPublicoId;
    await dono.vehicle.update({ where: { id: veiculo }, data: { licensePlate: 'RNV2A26', mileageKm: 41000 } });

    comoGerente = jwt.sign({ sub: f.a.usuarioId, role: 'manager', tenantId: f.a.id });
    comoDono = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
    comoOutraLoja = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });
  }, 90_000);

  afterAll(async () => {
    const lojas = { in: [f.a.id, f.b.id] };
    await dono.renaveRegistro.deleteMany({ where: { tenantId: lojas } });
    await dono.credencialDeIntegracao.deleteMany({ where: { tenantId: lojas } });
    await dono.dealBuyer.deleteMany({ where: { tenantId: lojas } });
    await dono.deal.deleteMany({ where: { tenantId: lojas } });
    await dono.acquisitionSupplier.deleteMany({ where: { tenantId: lojas } });
    await dono.vehicleFiscalDetails.deleteMany({ where: { tenantId: lojas } });
    await dono.vehicleAcquisition.deleteMany({ where: { tenantId: lojas } });
    await f?.limpar();
    await app?.close();
  });

  it('a fábrica montou o simulado, e o cartão diz isso', async () => {
    expect(simulado).toBeInstanceOf(ProvedorRenaveSimulado);
    const res = await get(`/veiculos/${veiculo}`);
    expect(res.body.integradora).toEqual({
      disponivel: true, provedor: 'simulado', sandbox: true, simulado: true,
      exigeCredencialDaLoja: true, credencialCadastrada: false,
    });
  });

  describe('chave da loja na integradora (cofre)', () => {
    const CHAVE = 'sim_chave_da_loja_a_9f3c';
    const OUTRA = 'sim_chave_nova_da_loja_a_77aa';

    it('sem chave cadastrada, o envio é 422 e diz onde cadastrar', async () => {
      await dono.tenant.update({ where: { id: f.a.id }, data: { taxId: '11222333000181' } });
      const res = await post('/envios', { vehicleId: veiculo, tipo: 'entrada_compra', crv: crv() });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/Configurações › Integrações/);
      await dono.tenant.update({ where: { id: f.a.id }, data: { taxId: null } });
    });

    it('o gerente não cadastra — a chave gasta o dinheiro da loja', async () => {
      const res = await post('/credencial', { chave: CHAVE });
      expect(res.status).toBe(403);
    });

    it('chave que a integradora não aceita não entra no cofre', async () => {
      const res = await post('/credencial', { chave: 'chave_de_outro_lugar' }, comoDono);
      expect(res.status).toBe(422);
      expect(await dono.credencialDeIntegracao.count({ where: { tenantId: f.a.id } })).toBe(0);
    });

    it('o dono cadastra; a resposta e o banco nunca têm a chave em texto', async () => {
      const res = await post('/credencial', { chave: CHAVE }, comoDono);
      expect(res.status).toBe(201);
      expect(res.body.credencial.ultimos4).toBe('9f3c');
      expect(JSON.stringify(res.body)).not.toContain(CHAVE);

      const lida = await get('/credencial');
      expect(lida.body.credencial.ultimos4).toBe('9f3c');
      expect(JSON.stringify(lida.body)).not.toContain(CHAVE);

      const linhas = await dono.$queryRawUnsafe<{ t: string }[]>(
        "SELECT row_to_json(c)::text AS t FROM credenciais_de_integracao c WHERE tenant_id = $1::uuid", f.a.id,
      );
      expect(linhas).toHaveLength(1);
      expect(linhas[0]!.t).not.toContain(CHAVE);
      expect(linhas[0]!.t).not.toContain(Buffer.from(CHAVE).toString('hex'));
    });

    it('trocar aposenta a anterior sem guardar a cifra dela; revogar faz o mesmo', async () => {
      expect((await post('/credencial', { chave: OUTRA }, comoDono)).status).toBe(201);
      const todas = await dono.credencialDeIntegracao.findMany({ where: { tenantId: f.a.id }, orderBy: { cadastradaEm: 'asc' } });
      expect(todas).toHaveLength(2);
      expect(todas[0]).toMatchObject({ cifra: null, vetor: null, etiqueta: null });
      expect(todas[0]!.substituidaEm).not.toBeNull();

      expect((await post('/credencial/revogar', {}, comoDono)).status).toBe(201);
      expect((await get('/credencial')).body.credencial).toBeNull();
      expect((await post('/credencial/revogar', {}, comoDono)).status).toBe(404);

      // De volta, para o resto do arquivo.
      expect((await post('/credencial', { chave: CHAVE }, comoDono)).status).toBe(201);
    });

    it('a outra loja não vê a chave da A', async () => {
      const res = await get('/credencial', comoOutraLoja);
      expect(res.body.credencial).toBeNull();
    });
  });

  describe('entrada', () => {
    it('sem CNPJ da loja é 422 — é por ele que a integradora identifica o estabelecimento', async () => {
      const res = await post('/envios', { vehicleId: veiculo, tipo: 'entrada_compra', crv: crv() });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/CNPJ/);
      await dono.tenant.update({ where: { id: f.a.id }, data: { taxId: '11222333000181' } });
    });

    it('sem o RENAVAM nos dados fiscais do veículo é 422, apontando o cartão', async () => {
      aquisicaoId = (await dono.vehicleAcquisition.create({
        data: {
          tenantId: f.a.id, vehicleId: veiculo, origin: 'direct_purchase',
          purchaseValue: '38000.00', enteredAt: new Date('2026-10-05T12:00:00Z'),
        },
      })).id;
      const res = await post('/envios', { vehicleId: veiculo, tipo: 'entrada_compra', crv: crv() });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/Dados fiscais/);
    });

    it('sem quem entregou o veículo é 422, apontando o cartão da nota de entrada', async () => {
      await dono.vehicleFiscalDetails.create({ data: { vehicleId: veiculo, tenantId: f.a.id, renavam: '00123456789' } });
      const res = await post('/envios', { vehicleId: veiculo, tipo: 'entrada_compra', crv: crv() });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/Nota de entrada/);
    });

    it('o cartão mostra de onde vêm o RENAVAM e o vendedor', async () => {
      await dono.acquisitionSupplier.create({
        data: { acquisitionId: aquisicaoId, tenantId: f.a.id, fullName: 'Ciclano da Silva', documento: '52998224725' },
      });
      const res = await get(`/veiculos/${veiculo}`);
      expect(res.body.sugestao.renavam).toBe('00123456789');
      expect(res.body.sugestao.entrada.vendedor).toEqual({ nome: 'Ciclano da Silva' });
    });

    it('enviada, fica pendente com o id da integradora — e o código do CRV não fica em lugar nenhum', async () => {
      const res = await post('/envios', { vehicleId: veiculo, tipo: 'entrada_compra', crv: crv() });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'pendente', origem: 'integradora', provider: 'simulado', valor: '38000.00', sequencia: 1,
      });
      expect(res.body.externalId).toMatch(/^sim_/);
      expect(res.body).not.toHaveProperty('snapshot');
      entradaId = res.body.id;
      entradaExterna = res.body.externalId;

      const linha = await dono.renaveRegistro.findUniqueOrThrow({ where: { id: entradaId }, include: { eventos: true } });
      const tudo = JSON.stringify(linha);
      expect(tudo).not.toContain(CODIGO_CRV);
      // O resto do documento do veículo fica: está impresso no CRLV.
      expect(linha.snapshot).toMatchObject({
        documento: { renavam: '00123456789', tipoCrv: 'DIGITAL' },
        vendedor: { nome: 'Ciclano da Silva', documento: '52998224725' },
        hodometro: { km: 41000 },
      });
    });

    it('anotar o protocolo à mão num registro da integradora é 409 — o estado vem dela', async () => {
      const res = await post(`/registros/${entradaId}/confirmar`, { protocolo: 'INVENTADO' });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/integradora/);
    });

    it('enviar de novo com o carro em estoque é 409, não segundo registro', async () => {
      const res = await post('/envios', { vehicleId: veiculo, tipo: 'entrada_compra', crv: crv() });
      expect(res.status).toBe(409);
    });

    it('a consulta responde pendente enquanto o Detran não age, e nada muda', async () => {
      const res = await post(`/registros/${entradaId}/atualizar`, {});
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pendente');
    });

    it('o Detran consente: o webhook confirma, com protocolo', async () => {
      const res = await post(`/registros/${entradaId}/simular`, { acao: 'confirmar' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('confirmado');
      expect(res.body.protocolo).toMatch(/^SIM-/);
    });

    it('a NF-e de entrada vai à integradora e fica no registro', async () => {
      const res = await post(`/registros/${entradaId}/nfe`, { chaveNfe: CHAVE_NFE });
      expect(res.status).toBe(201);
      expect(res.body.chaveNfe).toBe(CHAVE_NFE);
    });
  });

  describe('webhook', () => {
    it('sem a assinatura certa é 401, antes de qualquer acesso ao banco', async () => {
      const { corpo } = simulado.entrega({ evento: 'estoque.cancelado', operacao: entradaExterna });
      const res = await webhook({ 'content-type': 'application/json', 'content-hmac': 'sha256=' + '0'.repeat(64) }, corpo);
      expect(res.status).toBe(401);
    });

    it('a mesma entrega duas vezes é aplicada uma vez', async () => {
      const e = simulado.entrega({ id: 'evt-repetido', evento: 'estoque.confirmado', operacao: entradaExterna, protocolo: 'X' });
      const primeira = await webhook(e.cabecalhos, e.corpo);
      const segunda = await webhook(e.cabecalhos, e.corpo);
      expect(primeira.status).toBe(200);
      // Confirmado já estava: fica registrado, não aplicado.
      expect(primeira.body).toMatchObject({ aplicado: false, motivo: 'fora-de-ordem' });
      expect(segunda.body).toMatchObject({ aplicado: false, motivo: 'repetido' });

      const eventos = await dono.renaveEvento.count({ where: { registroId: entradaId, eventKey: 'evt-repetido' } });
      expect(eventos).toBe(1);
    });

    it('operação que ninguém conhece é 200 sem efeito — 4xx faria a integradora insistir', async () => {
      const e = simulado.entrega({ evento: 'estoque.confirmado', operacao: 'sim_de_outra_instalacao' });
      const res = await webhook(e.cabecalhos, e.corpo);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ aplicado: false, motivo: 'operacao-desconhecida' });
    });
  });

  describe('saída por venda e ATPV-e', () => {
    it('sem a qualificação do comprador é 422', async () => {
      const negocio = await dono.deal.create({
        data: {
          tenantId: f.a.id, vehicleId: veiculo, status: 'invoiced', closedAt: new Date('2026-10-12T15:00:00Z'),
          listPrice: '45000.00', saleValue: '44000.00', discount: '1000.00',
        },
      });
      negocioId = negocio.id;
      const res = await post('/envios', { vehicleId: veiculo, tipo: 'saida_venda', dealId: negocioId, crv: crv() });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/comprador/);
    });

    it('com comprador, sai pendente; confirmada, traz o ATPV-e — só para a loja dona', async () => {
      await dono.dealBuyer.create({
        data: { dealId: negocioId, tenantId: f.a.id, fullName: 'Beltrana Compradora', cpf: '52998224725' },
      });
      const enviada = await post('/envios', { vehicleId: veiculo, tipo: 'saida_venda', dealId: negocioId, crv: crv() });
      expect(enviada.status).toBe(201);
      expect(enviada.body).toMatchObject({ status: 'pendente', valor: '44000.00', temAtpv: false });
      saidaId = enviada.body.id;

      const semAtpv = await get(`/registros/${saidaId}/atpv`);
      expect(semAtpv.status).toBe(404);

      const confirmada = await post(`/registros/${saidaId}/simular`, { acao: 'confirmar' });
      expect(confirmada.body.status).toBe('confirmado');

      const atpv = await get(`/registros/${saidaId}/atpv`).buffer(true).parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
      expect(atpv.status).toBe(200);
      expect(atpv.headers['content-type']).toBe('application/pdf');
      expect((atpv.body as Buffer).toString()).toContain('ATPV-e SIMULADO');

      expect((await get(`/registros/${saidaId}/atpv`, comoOutraLoja)).status).toBe(404);
    });

    it('cancelar a saída pede à integradora e devolve a obrigação de registrar', async () => {
      const res = await post(`/registros/${saidaId}/cancelar`, { motivo: 'Comprador desistiu antes da transferência' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('cancelado');
      const cartao = await get(`/veiculos/${veiculo}`);
      expect(cartao.body.pendencias.map((p: { codigo: string }) => p.codigo)).toContain('saida_sem_registro');
    });
  });

  describe('envio no meio do caminho e recusa', () => {
    it('envio que a integradora nunca respondeu é retomado na mesma linha, com a mesma chave', async () => {
      const outro = f.a.veiculoPrivadoId;
      await dono.vehicle.update({ where: { id: outro }, data: { licensePlate: 'RNV2B26', status: 'available' } });
      await dono.vehicleFiscalDetails.create({ data: { vehicleId: outro, tenantId: f.a.id, renavam: '00987654321' } });
      await dono.vehicleAcquisition.create({
        data: {
          tenantId: f.a.id, vehicleId: outro, origin: 'dealer_transfer',
          purchaseValue: '30000.00', enteredAt: new Date('2026-10-01T12:00:00Z'), supplierDocument: '11222333000181',
        },
      });
      const preso = await dono.renaveRegistro.create({
        data: {
          tenantId: f.a.id, vehicleId: outro, tipo: 'entrada_transferencia', status: 'pendente',
          origem: 'integradora', provider: 'simulado', sequencia: 1, dataOperacao: new Date('2026-10-01T12:00:00Z'),
          snapshot: { veiculo: { placa: 'RNV2B26' }, vendedor: { documento: '11222333000181' }, hodometro: { km: 0, medidoEm: '2026-10-01T12:00:00Z' } },
        },
      });

      const res = await post('/envios', { vehicleId: outro, tipo: 'entrada_transferencia', crv: crv() });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(preso.id);
      expect(res.body.externalId).toMatch(/^sim_/);
      expect(await dono.renaveRegistro.count({ where: { vehicleId: outro } })).toBe(1);

      const cancelado = await post(`/registros/${preso.id}/cancelar`, { motivo: 'Lançado no carro errado' });
      expect(cancelado.body.status).toBe('cancelado');
    });

    it('veículo inapto é recusado na hora, com o motivo da integradora', async () => {
      const outro = f.a.veiculoPrivadoId;
      const res = await post('/envios', {
        vehicleId: outro, tipo: 'entrada_transferencia', crv: crv(CODIGO_RECUSADO_NO_SIMULADO),
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'recusado', sequencia: 2 });
      expect(res.body.motivoRecusa).toMatch(/não está apto/);
    });
  });

  describe('isolamento', () => {
    it('a outra loja não atualiza, não simula e não cancela registro alheio', async () => {
      expect((await post(`/registros/${entradaId}/atualizar`, {}, comoOutraLoja)).status).toBe(404);
      expect((await post(`/registros/${entradaId}/simular`, { acao: 'recusar' }, comoOutraLoja)).status).toBe(404);
      expect((await post(`/registros/${entradaId}/cancelar`, { motivo: 'invasão' }, comoOutraLoja)).status).toBe(404);
    });

    it('sob RLS, os eventos crus só aparecem para a loja dona', async () => {
      const conta = (ctx: { tenantId?: string }) =>
        comoApp(prisma, ctx, async (tx) => {
          const l = (await tx.$queryRawUnsafe(
            'SELECT count(*)::int AS n FROM renave_eventos WHERE registro_id = $1::uuid', entradaId,
          )) as { n: number }[];
          return l[0]!.n;
        });
      expect(await conta({ tenantId: f.a.id })).toBeGreaterThan(0);
      expect(await conta({ tenantId: f.b.id })).toBe(0);
      expect(await conta({})).toBe(0);
    });
  });
});
