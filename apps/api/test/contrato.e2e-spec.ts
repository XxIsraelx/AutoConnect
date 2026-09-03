import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/** O contrato pela fronteira HTTP: emissão, hash, assinatura e anulação. */
describe('Contrato (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  let jwt: JwtService;
  let comoAdmin: string;
  let comoVendedor: string;

  const http = () => request(app.getHttpServer());
  const post = (rota: string, t: string, corpo: object = {}) =>
    http().post(`/api/v1${rota}`)
      .set('Authorization', `Bearer ${t}`)
      // O supertest não envia User-Agent sozinho, e é justamente ele que a
      // trilha de evidências precisa registrar.
      .set('User-Agent', 'jest-e2e/1.0')
      .send(corpo);
  const get = (rota: string, t: string) =>
    http().get(`/api/v1${rota}`).set('Authorization', `Bearer ${t}`);

  const criarNegocio = async () => {
    const [d] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO deals (tenant_id, vehicle_id, list_price, discount, sale_value, status, updated_at)
      VALUES (${f.a.id}::uuid, ${f.a.veiculoPublicoId}::uuid, 100000, 5000, 95000, 'contract_issued', now())
      RETURNING id`;
    await dono.$executeRaw`
      INSERT INTO deal_payments (tenant_id, deal_id, kind, value, updated_at)
      VALUES (${f.a.id}::uuid, ${d.id}::uuid, 'cash', 95000, now())`;
    await dono.$executeRaw`
      INSERT INTO deal_buyers (deal_id, tenant_id, full_name, cpf, rg, rg_issuer,
                               address_line, address_number, city, state, updated_at)
      VALUES (${d.id}::uuid, ${f.a.id}::uuid, 'Maria Silva', '52998224725', '12.345.678', 'SSP/SP',
              'Rua das Flores', '100', 'São Paulo', 'SP', now())`;
    return d.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    dono = app.get(PrivilegedPrismaService, { strict: false });
    jwt = app.get(JwtService);
    f = await criarDoisTenants(dono);
    await dono.$executeRaw`
      UPDATE tenants
         SET legal_rep_name = 'Carlos Souza', legal_rep_cpf = '52998224725',
             legal_rep_role = 'sócio-administrador'
       WHERE id = ${f.a.id}::uuid`;
    comoAdmin = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
    comoVendedor = jwt.sign({ sub: f.a.usuarioId, role: 'salesperson', tenantId: f.a.id });
  }, 90_000);

  afterEach(async () => {
    await dono.$executeRaw`DELETE FROM contract_signatures WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM deal_contracts WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM deal_warranties WHERE tenant_id = ${f.a.id}::uuid`;
    await dono.$executeRaw`DELETE FROM deals WHERE tenant_id = ${f.a.id}::uuid`;
  });

  afterAll(async () => {
    await dono.$executeRaw`DELETE FROM contract_templates WHERE tenant_id = ${f.a.id}::uuid`;
    await f?.limpar();
    await app?.close();
  });

  describe('emissão', () => {
    it('emite e devolve o contrato com hash', async () => {
      const dealId = await criarNegocio();
      const res = await post(`/deals/${dealId}/contract`, comoVendedor);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'issued' });
      expect(res.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }, 30_000);

    it('o PDF sai conferido contra o hash da emissão', async () => {
      const dealId = await criarNegocio();
      const { body } = await post(`/deals/${dealId}/contract`, comoVendedor);

      const res = await get(`/contracts/${body.id}/pdf`, comoVendedor).buffer();

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    }, 30_000);

    it('negócio cancelado não emite contrato', async () => {
      const dealId = await criarNegocio();
      await dono.$executeRaw`UPDATE deals SET status='canceled' WHERE id=${dealId}::uuid`;

      const res = await post(`/deals/${dealId}/contract`, comoVendedor);

      expect(res.status).toBe(409);
    }, 30_000);

    it('recusa emitir com garantia que disfarça redução da legal', async () => {
      const dealId = await criarNegocio();
      await dono.$executeRaw`
        INSERT INTO deal_warranties (deal_id, tenant_id, contractual_months, contractual_scope, updated_at)
        VALUES (${dealId}::uuid, ${f.a.id}::uuid, 2, 'motor e câmbio', now())`;

      const res = await post(`/deals/${dealId}/contract`, comoVendedor);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/CDC art\. 51, I/);
    }, 30_000);
  });


  describe('qualificação do comprador', () => {
    it('recusa emitir sem comprador identificado', async () => {
      const dealId = await criarNegocio();
      await dono.$executeRaw`DELETE FROM deal_buyers WHERE deal_id = ${dealId}::uuid`;

      const res = await post(`/deals/${dealId}/contract`, comoVendedor);

      // Um contrato que diz "portador(a) do documento ____" parece documento e
      // não identifica a parte.
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/qualificação do comprador/i);
    }, 30_000);

    it('o snapshot traz CPF formatado e a qualificação completa', async () => {
      const dealId = await criarNegocio();
      const { body } = await post(`/deals/${dealId}/contract`, comoVendedor);

      expect(body.snapshot.cliente.documento).toBe('529.982.247-25');
      expect(body.snapshot.cliente.qualificacao).toMatch(/CPF sob o nº 529\.982\.247-25/);
      expect(body.snapshot.cliente.qualificacao).toMatch(/RG nº 12\.345\.678 SSP\/SP/);
      expect(body.snapshot.cliente.qualificacao).toMatch(/Rua das Flores, 100/);
    }, 30_000);

    it('CPF inválido é recusado na borda', async () => {
      const dealId = await criarNegocio();

      const res = await http().put(`/api/v1/deals/${dealId}/buyer`)
        .set('Authorization', `Bearer ${comoVendedor}`)
        .set('User-Agent', 'jest-e2e/1.0')
        .send({ fullName: 'Fulano de Tal', cpf: '111.111.111-11' });

      expect(res.status).toBe(400);
    }, 30_000);

    it('aceita CPF com pontuação e guarda só os dígitos', async () => {
      const dealId = await criarNegocio();

      const res = await http().put(`/api/v1/deals/${dealId}/buyer`)
        .set('Authorization', `Bearer ${comoVendedor}`)
        .set('User-Agent', 'jest-e2e/1.0')
        .send({ fullName: 'Maria Silva', cpf: '529.982.247-25' });

      expect(res.status).toBe(200);
      expect(res.body.cpf).toBe('52998224725');
    }, 30_000);
  });


  describe('qualificação da vendedora', () => {
    it('recusa emitir sem representante legal', async () => {
      const dealId = await criarNegocio();
      await dono.$executeRaw`
        UPDATE tenants SET legal_rep_name = NULL WHERE id = ${f.a.id}::uuid`;

      const res = await post(`/deals/${dealId}/contract`, comoVendedor);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/representante legal/i);

      await dono.$executeRaw`
        UPDATE tenants SET legal_rep_name = 'Carlos Souza' WHERE id = ${f.a.id}::uuid`;
    }, 30_000);

    it('o snapshot nomeia quem assina pela loja, com CNPJ e CPF formatados', async () => {
      const dealId = await criarNegocio();
      const { body } = await post(`/deals/${dealId}/contract`, comoVendedor);
      const q = body.snapshot.loja.qualificacao;

      expect(q).toMatch(/neste ato representada por Carlos Souza/);
      expect(q).toMatch(/sócio-administrador/);
      expect(q).toMatch(/CPF sob o nº 529\.982\.247-25/);
      expect(body.snapshot.loja.representante).toBe('Carlos Souza');
    }, 30_000);
  });

  describe('editar o template não altera contrato já emitido', () => {
    it('o hash e o PDF continuam os da emissão', async () => {
      const dealId = await criarNegocio();
      const { body: contrato } = await post(`/deals/${dealId}/contract`, comoVendedor);
      const antes = await get(`/contracts/${contrato.id}/pdf`, comoVendedor).buffer();

      // Nova versão do template, como faria a tela de edição.
      await dono.$executeRaw`
        UPDATE contract_templates SET is_active = false WHERE tenant_id = ${f.a.id}::uuid`;
      await dono.$executeRaw`
        INSERT INTO contract_templates (tenant_id, name, version, blocks, is_active, updated_at)
        VALUES (${f.a.id}::uuid, 'Compra e venda', 2,
                '[{"tipo":"titulo","texto":"OUTRO CONTRATO"}]'::jsonb, true, now())`;

      const depois = await get(`/contracts/${contrato.id}/pdf`, comoVendedor).buffer();
      const [linha] = await dono.$queryRaw<{ content_hash: string }[]>`
        SELECT content_hash FROM deal_contracts WHERE id = ${contrato.id}::uuid`;

      // O contrato aponta para a versão que usou; a versão nova só vale para
      // emissões futuras.
      expect(linha.content_hash).toBe(contrato.contentHash);
      expect(depois.body.equals(antes.body)).toBe(true);
    }, 45_000);
  });

  describe('assinatura', () => {
    it('duas assinaturas fecham o contrato', async () => {
      const dealId = await criarNegocio();
      const { body: c } = await post(`/deals/${dealId}/contract`, comoVendedor);

      await post(`/contracts/${c.id}/sign`, comoVendedor, { role: 'dealer', signerName: 'Vendedor Um' });
      const res = await post(`/contracts/${c.id}/sign`, comoAdmin, { role: 'customer', signerName: 'Maria Silva' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'signed' });
      expect(res.body.signatures).toHaveLength(2);
    }, 45_000);

    it('a assinatura guarda o hash do documento aceito', async () => {
      const dealId = await criarNegocio();
      const { body: c } = await post(`/deals/${dealId}/contract`, comoVendedor);

      await post(`/contracts/${c.id}/sign`, comoVendedor, { role: 'dealer', signerName: 'Vendedor Um' });

      const [a] = await dono.$queryRaw<{ accepted_hash: string; ip: string | null; user_agent: string | null }[]>`
        SELECT accepted_hash, ip, user_agent FROM contract_signatures WHERE contract_id = ${c.id}::uuid`;
      expect(a.accepted_hash).toBe(c.contentHash);
      expect(a.user_agent).toBe('jest-e2e/1.0');
    }, 30_000);

    it('assinar duas vezes no mesmo papel é 409', async () => {
      const dealId = await criarNegocio();
      const { body: c } = await post(`/deals/${dealId}/contract`, comoVendedor);
      await post(`/contracts/${c.id}/sign`, comoVendedor, { role: 'dealer', signerName: 'Vendedor Um' });

      const res = await post(`/contracts/${c.id}/sign`, comoVendedor, { role: 'dealer', signerName: 'Vendedor Um' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/já tem assinatura/);
    }, 30_000);

    it('contrato anulado não se assina', async () => {
      const dealId = await criarNegocio();
      const { body: c } = await post(`/deals/${dealId}/contract`, comoVendedor);
      await post(`/contracts/${c.id}/void`, comoAdmin, { reason: 'erro de digitação' });

      const res = await post(`/contracts/${c.id}/sign`, comoVendedor, { role: 'dealer', signerName: 'Vendedor Um' });

      expect(res.status).toBe(409);
    }, 30_000);
  });

  describe('anulação', () => {
    it('vendedor não anula contrato', async () => {
      const dealId = await criarNegocio();
      const { body: c } = await post(`/deals/${dealId}/contract`, comoVendedor);

      const res = await post(`/contracts/${c.id}/void`, comoVendedor, { reason: 'qualquer motivo' });

      expect(res.status).toBe(403);
    }, 30_000);

    it('gerência anula com motivo', async () => {
      const dealId = await criarNegocio();
      const { body: c } = await post(`/deals/${dealId}/contract`, comoVendedor);

      const res = await post(`/contracts/${c.id}/void`, comoAdmin, { reason: 'valor incorreto' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'voided', voidReason: 'valor incorreto' });
    }, 30_000);
  });

  it('contrato de outra concessionária é 404', async () => {
    const dealId = await criarNegocio();
    const { body: c } = await post(`/deals/${dealId}/contract`, comoVendedor);
    const daOutra = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });

    const res = await get(`/contracts/${c.id}/pdf`, daOutra);

    expect(res.status).toBe(404);
  }, 30_000);
});
