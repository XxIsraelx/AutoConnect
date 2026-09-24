import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Onda 1, itens 10 e 11 — rascunho de anúncio e desempenho por vendedor.
 *
 * Contra Postgres de verdade porque é onde a regra mora de fato: a policy
 * `leitura_publica` que agora exige `published`, o `Decimal(14,2)` do
 * faturamento e o backfill da migration, que é SQL puro e não tem como ser
 * exercitado por um mock.
 *
 * Os dois assuntos dividem um arquivo porque dividem a montagem: as mesmas
 * duas lojas, os mesmos dois vendedores e o mesmo estoque. Separá-los custaria
 * dois `beforeAll` de 90 segundos para provar as mesmas linhas.
 */
describe('Onda 1 — rascunho de anúncio e desempenho (e2e)', () => {
  let app: INestApplication;
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;

  let tokenAdminA: string;
  let tokenAdminB: string;
  let tokenVendedor1: string;

  let vendedor1: string;
  let vendedor2: string;

  const rota = (caminho: string) => `/api/v1${caminho}`;
  const http = () => request(app.getHttpServer());

  /** Usuário de venda com perfil e percentual de comissão. */
  async function criarVendedor(
    tenantId: string,
    nome: string,
    comissaoPct: number | null,
  ): Promise<string> {
    const email = `${nome.toLowerCase().replace(/\W+/g, '-')}-${Math.random()
      .toString(36)
      .slice(2, 8)}@exemplo.test`;
    const [{ id }] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO users (tenant_id, email, full_name, role, updated_at)
      VALUES (${tenantId}::uuid, ${email}, ${nome}, 'salesperson', now())
      RETURNING id`;
    await dono.$executeRaw`
      INSERT INTO salesperson_profiles (user_id, tenant_id, commission_pct, updated_at)
      VALUES (${id}::uuid, ${tenantId}::uuid, ${comissaoPct}, now())`;
    return id;
  }

  /** Veículo cru, com o estado de anúncio que o caso precisa. */
  async function criarVeiculo(
    tenantId: string,
    opts: { status?: string; anuncio?: string; preco?: number } = {},
  ): Promise<string> {
    const [{ id }] = await dono.$queryRaw<{ id: string }[]>`
      INSERT INTO vehicles (tenant_id, brand_id, model_id, year_model, year_make, price,
                            status, listing_status, color, fuel, transmission, updated_at)
      VALUES (${tenantId}::uuid, ${f.marcaId}::uuid, ${f.modeloId}::uuid, 2021, 2021,
              ${opts.preco ?? 70000}, ${opts.status ?? 'available'}::"VehicleStatus",
              ${opts.anuncio ?? 'draft'}::"ListingStatus", 'Prata', 'flex', 'automatic', now())
      RETURNING id`;
    return id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    dono = app.get(PrivilegedPrismaService, { strict: false });
    f = await criarDoisTenants(dono);

    vendedor1 = await criarVendedor(f.a.id, 'Ana Vendedora', 3);
    // Sem percentual: a comissão dela tem que sair `null`, não zero.
    vendedor2 = await criarVendedor(f.a.id, 'Bruno Vendedor', null);

    const jwt = app.get(JwtService);
    tokenAdminA = jwt.sign({ sub: f.a.usuarioId, role: 'tenant_admin', tenantId: f.a.id });
    tokenAdminB = jwt.sign({ sub: f.b.usuarioId, role: 'tenant_admin', tenantId: f.b.id });
    tokenVendedor1 = jwt.sign({ sub: vendedor1, role: 'salesperson', tenantId: f.a.id });
  }, 90_000);

  afterAll(async () => {
    if (f) {
      // Os vendedores e o que pende deles saem antes da fixture: `users` tem
      // referência de negócio, lead e agendamento.
      await dono.$executeRaw`DELETE FROM deals WHERE tenant_id = ${f.a.id}::uuid`;
      await dono.$executeRaw`DELETE FROM vehicle_history WHERE tenant_id = ${f.a.id}::uuid`;
      await dono.$executeRaw`DELETE FROM vehicle_images WHERE tenant_id = ${f.a.id}::uuid`;
      await dono.$executeRaw`DELETE FROM salesperson_profiles WHERE tenant_id = ${f.a.id}::uuid`;
      await f.limpar();
    }
    await app?.close();
  });

  /* ══════════ Item 11 — rascunho de anúncio ══════════ */

  describe('publicação do anúncio', () => {
    it('veículo novo nasce em rascunho e não aparece no catálogo público', async () => {
      const criado = await http()
        .post(rota('/vehicles'))
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          brandId: f.marcaId,
          modelId: f.modeloId,
          yearModel: 2022,
          yearMake: 2022,
          price: 82000,
        });

      expect(criado.status).toBe(201);
      expect(criado.body.listingStatus).toBe('draft');

      // Cadastrar deixou de ser publicar: era exatamente isto que acontecia
      // sozinho antes, com o carro estreando sem foto e sem preço conferido.
      // A rota devolve `null` para o que não está na vitrine: corpo sem `id`.
      const detalhe = await http().get(rota(`/catalog/vehicles/${criado.body.id}`));
      expect(detalhe.body?.id).toBeUndefined();

      const lista = await http().get(rota(`/catalog/vehicles?tenantId=${f.a.id}`));
      expect(lista.status).toBe(200);
      expect(lista.body.items.map((v: { id: string }) => v.id)).not.toContain(criado.body.id);

      // ...e continua no estoque da loja, que é onde ele tem que estar.
      const estoque = await http()
        .get(rota(`/vehicles/${criado.body.id}`))
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(estoque.status).toBe(200);
      expect(estoque.body.status).toBe('available');
    });

    it('publicar sem foto é recusado com 422 dizendo o que falta', async () => {
      const id = await criarVeiculo(f.a.id);

      const res = await http()
        .post(rota(`/vehicles/${id}/publish`))
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('pelo menos uma foto');

      const depois = await dono.vehicle.findUniqueOrThrow({ where: { id } });
      expect(depois.listingStatus).toBe('draft');
    });

    it('publicar sem preço e sem os campos essenciais lista tudo o que falta', async () => {
      const id = await criarVeiculo(f.a.id);
      // O `price` é obrigatório na criação; um preço zerado só chega por
      // importação ou correção manual — e é ausência de preço, não preço.
      await dono.$executeRaw`
        UPDATE vehicles SET price = 0, color = NULL, fuel = NULL WHERE id = ${id}::uuid`;

      const res = await http()
        .post(rota(`/vehicles/${id}/publish`))
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('preço de venda');
      expect(res.body.message).toContain('cor');
      expect(res.body.message).toContain('combustível');
    });

    it('veículo fora de "Disponível" não vai para a vitrine nem com foto', async () => {
      const id = await criarVeiculo(f.a.id, { status: 'sold' });
      await dono.$executeRaw`
        INSERT INTO vehicle_images (tenant_id, vehicle_id, url, is_cover, position)
        VALUES (${f.a.id}::uuid, ${id}::uuid, 'https://exemplo.test/1.jpg', true, 0)`;

      const res = await http()
        .post(rota(`/vehicles/${id}/publish`))
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('Disponível');
    });

    it('com foto e campos essenciais, publicar põe o veículo no catálogo', async () => {
      const id = await criarVeiculo(f.a.id);
      await dono.$executeRaw`
        INSERT INTO vehicle_images (tenant_id, vehicle_id, url, is_cover, position)
        VALUES (${f.a.id}::uuid, ${id}::uuid, 'https://exemplo.test/2.jpg', true, 0)`;

      const res = await http()
        .post(rota(`/vehicles/${id}/publish`))
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(201);
      expect(res.body.listingStatus).toBe('published');
      expect(res.body.publishedAt).toBeTruthy();

      const detalhe = await http().get(rota(`/catalog/vehicles/${id}`));
      expect(detalhe.body?.id).toBe(id);

      // A estreia fica registrada na linha do tempo do veículo.
      const eventos = await dono.vehicleHistory.findMany({ where: { vehicleId: id } });
      expect(eventos.map((e) => e.eventType)).toContain('listing_published');
    });

    it('despublicar tira do catálogo sem mexer no estoque nem perder a estreia', async () => {
      const id = await criarVeiculo(f.a.id, { anuncio: 'published' });
      await dono.$executeRaw`
        UPDATE vehicles SET published_at = now() - interval '40 days' WHERE id = ${id}::uuid`;
      const estreia = (await dono.vehicle.findUniqueOrThrow({ where: { id } })).publishedAt;

      const res = await http()
        .post(rota(`/vehicles/${id}/unpublish`))
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(res.status).toBe(201);
      expect(res.body.listingStatus).toBe('unpublished');

      const detalhe = await http().get(rota(`/catalog/vehicles/${id}`));
      expect(detalhe.body?.id).toBeUndefined();

      const depois = await dono.vehicle.findUniqueOrThrow({ where: { id } });
      expect(depois.status).toBe('available');
      // Despublicar não é "voltou a ser novo": o giro de estoque continua.
      expect(depois.publishedAt?.toISOString()).toBe(estreia?.toISOString());

      // E republicar não zera a data da estreia.
      await dono.$executeRaw`
        INSERT INTO vehicle_images (tenant_id, vehicle_id, url, is_cover, position)
        VALUES (${f.a.id}::uuid, ${id}::uuid, 'https://exemplo.test/3.jpg', true, 0)`;
      await http()
        .post(rota(`/vehicles/${id}/publish`))
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .expect(201);
      const republicado = await dono.vehicle.findUniqueOrThrow({ where: { id } });
      expect(republicado.publishedAt?.toISOString()).toBe(estreia?.toISOString());
    });

    it('o filtro de estado do anúncio responde na lista de estoque', async () => {
      const rascunho = await criarVeiculo(f.a.id);
      const publicado = await criarVeiculo(f.a.id, { anuncio: 'published' });

      const so = async (estado: string) => {
        const res = await http()
          .get(rota(`/vehicles?perPage=100&listingStatus=${estado}`))
          .set('Authorization', `Bearer ${tokenAdminA}`);
        return res.body.items.map((v: { id: string }) => v.id);
      };

      expect(await so('draft')).toContain(rascunho);
      expect(await so('draft')).not.toContain(publicado);
      expect(await so('published')).toContain(publicado);
      expect(await so('published')).not.toContain(rascunho);
    });

    it('a loja vizinha não publica nem despublica o veículo alheio', async () => {
      const id = await criarVeiculo(f.a.id, { anuncio: 'published' });

      await http()
        .post(rota(`/vehicles/${id}/unpublish`))
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .expect(404);

      const intacto = await dono.vehicle.findUniqueOrThrow({ where: { id } });
      expect(intacto.listingStatus).toBe('published');
    });

    /**
     * O backfill da migration, exercitado como SQL — não reescrito aqui.
     *
     * Reescrever a condição no teste provaria que duas cópias concordam entre
     * si, não que a que vai rodar no deploy está certa. O `UPDATE` é lido do
     * próprio arquivo e roda numa transação que volta atrás no fim, para não
     * publicar o estoque dos outros casos.
     */
    it('o backfill mantém público o que já estava à venda antes da migration', async () => {
      const migration = readFileSync(
        join(
          __dirname,
          '../../../packages/db/prisma/migrations/20260923175928_rascunho_de_anuncio/migration.sql',
        ),
        'utf8',
      );
      // Os comentários saem antes do split: o arquivo é quase todo explicação,
      // e `-- …` no meio do UPDATE atrapalharia tanto a busca quanto o envio.
      const backfill = migration
        .replace(/^\s*--.*$/gm, '')
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('UPDATE "vehicles"'));
      expect(backfill).toBeTruthy();

      // Duas linhas como estariam na véspera da migration: tudo em `draft`,
      // porque a coluna acabou de nascer com esse DEFAULT.
      const aVenda = await criarVeiculo(f.a.id, { status: 'available', anuncio: 'draft' });
      const vendido = await criarVeiculo(f.a.id, { status: 'sold', anuncio: 'draft' });

      const depois = await dono
        .$transaction(async (tx) => {
          await tx.$executeRawUnsafe(backfill!);
          const linhas = await tx.vehicle.findMany({
            where: { id: { in: [aVenda, vendido] } },
            select: { id: true, listingStatus: true, publishedAt: true },
          });
          // Volta atrás: o backfill roda na base inteira, e o teste só quer
          // saber o efeito sobre estas duas linhas.
          throw Object.assign(new Error('rollback proposital'), { linhas });
        })
        .catch((e: Error & { linhas?: { id: string; listingStatus: string; publishedAt: Date | null }[] }) => e.linhas);

      const daVenda = depois?.find((v) => v.id === aVenda);
      const doVendido = depois?.find((v) => v.id === vendido);

      // O critério é exatamente o que decidia a visibilidade antes: `available`.
      expect(daVenda?.listingStatus).toBe('published');
      expect(daVenda?.publishedAt).toBeTruthy();
      // O que não estava à venda continua fora da vitrine.
      expect(doVendido?.listingStatus).toBe('draft');
    });
  });

  /* ══════════ Item 10 — desempenho por vendedor ══════════ */

  describe('relatório de desempenho por vendedor', () => {
    beforeAll(async () => {
      const agora = new Date();
      const ontem = new Date(agora.getTime() - 86_400_000);

      // Ana: 3 leads (2 já atendidos), Bruno: 1 lead (nenhum atendido).
      for (const [vendedorId, status] of [
        [vendedor1, 'new'],
        [vendedor1, 'contacted'],
        [vendedor1, 'won'],
        [vendedor2, 'new'],
      ] as const) {
        await dono.$executeRaw`
          INSERT INTO leads (tenant_id, contact_name, status, assigned_to, created_at, updated_at)
          VALUES (${f.a.id}::uuid, 'Interessado', ${status}::"LeadStatus",
                  ${vendedorId}::uuid, ${ontem}, now())`;
      }

      // Ana: 2 agendamentos, 1 comparecimento e 1 falta. Bruno: nenhum.
      for (const status of ['completed', 'no_show'] as const) {
        await dono.$executeRaw`
          INSERT INTO appointments (tenant_id, customer_user_id, salesperson_id, type, status,
                                    scheduled_start, scheduled_end, updated_at)
          VALUES (${f.a.id}::uuid, ${f.a.usuarioId}::uuid, ${vendedor1}::uuid, 'test_drive',
                  ${status}::"AppointmentStatus", ${ontem}, ${ontem}, now())`;
      }

      // Ana: um negócio faturado de R$ 80.000,00 com margem de R$ 9.000,00.
      // Um veículo por negócio: `deals_veiculo_negocio_vivo_idx` não deixa
      // dois negócios vivos no mesmo carro.
      const carro = await criarVeiculo(f.a.id, { anuncio: 'published' });
      await dono.$executeRaw`
        INSERT INTO deals (tenant_id, vehicle_id, salesperson_id, status, list_price, discount,
                           sale_value, vehicle_cost_snapshot, gross_margin, closed_at, updated_at)
        VALUES (${f.a.id}::uuid, ${carro}::uuid, ${vendedor1}::uuid, 'invoiced',
                85000.00, 5000.00, 80000.00, 71000.00, 9000.00, ${ontem}, now())`;
    });

    it('a gerência vê a linha de cada vendedor, com dinheiro como string', async () => {
      const res = await http()
        .get(rota('/tenant/reports/salespeople?days=30'))
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(200);
      expect(res.body.veDinheiro).toBe(true);

      const ana = res.body.vendedores.find((v: { userId: string }) => v.userId === vendedor1);
      const bruno = res.body.vendedores.find((v: { userId: string }) => v.userId === vendedor2);
      expect(ana).toBeTruthy();
      expect(bruno).toBeTruthy();

      expect(ana.leadsRecebidos).toBe(3);
      // "Atendido" é lead que saiu de `new` — dois dos três.
      expect(ana.leadsAtendidos).toBe(2);
      expect(ana.agendamentos).toBe(2);
      expect(ana.comparecimentos).toBe(1);
      expect(ana.faltas).toBe(1);
      expect(ana.taxaComparecimento).toBe(50);
      expect(ana.negociosGanhos).toBe(1);

      // Dinheiro atravessa o JSON como string, com os dois decimais.
      expect(ana.faturamento).toBe('80000.00');
      expect(ana.margem).toBe('9000.00');
      // 3% de 9.000 = 270,00 — calculado em Decimal, não em ponto flutuante.
      expect(ana.comissaoEstimada).toBe('270.00');

      expect(bruno.leadsRecebidos).toBe(1);
      expect(bruno.leadsAtendidos).toBe(0);
      expect(bruno.agendamentos).toBe(0);
      expect(bruno.taxaComparecimento).toBeNull();
      expect(bruno.negociosGanhos).toBe(0);
      // Sem percentual configurado, a comissão é `null` — e não zero, que
      // diria "não ganhou nada" em vez de "ninguém informou quanto ela é".
      expect(bruno.comissaoEstimada).toBeNull();
    });

    it('o vendedor vê a própria linha e nenhum valor em dinheiro', async () => {
      const res = await http()
        .get(rota('/tenant/reports/salespeople?days=30'))
        .set('Authorization', `Bearer ${tokenVendedor1}`);

      expect(res.status).toBe(200);
      expect(res.body.veDinheiro).toBe(false);
      expect(res.body.vendedores).toHaveLength(1);

      const [minha] = res.body.vendedores;
      expect(minha.userId).toBe(vendedor1);
      expect(minha.leadsRecebidos).toBe(3);
      expect(minha.negociosGanhos).toBe(1);

      // O filtro é da consulta, não da serialização: o número do colega não
      // chega nem a sair do banco.
      expect(minha.faturamento).toBeNull();
      expect(minha.margem).toBeNull();
      expect(minha.comissaoEstimada).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('80000');
    });

    it('a loja vizinha não vê os vendedores nem os números da outra', async () => {
      const res = await http()
        .get(rota('/tenant/reports/salespeople?days=30'))
        .set('Authorization', `Bearer ${tokenAdminB}`);

      expect(res.status).toBe(200);
      const ids = res.body.vendedores.map((v: { userId: string }) => v.userId);
      expect(ids).not.toContain(vendedor1);
      expect(ids).not.toContain(vendedor2);
    });

    it('o período recusa valor fora da faixa em vez de varrer a base', async () => {
      await http()
        .get(rota('/tenant/reports/salespeople?days=99999'))
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .expect(400);
    });

    it('exporta desempenho, negócios e estoque em CSV', async () => {
      const desempenho = await http()
        .get(rota('/tenant/reports/salespeople.csv?days=30'))
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(desempenho.status).toBe(200);
      expect(desempenho.headers['content-type']).toContain('text/csv');
      expect(desempenho.headers['content-disposition']).toContain('attachment');
      expect(desempenho.text).toContain('Ana Vendedora');
      expect(desempenho.text).toContain('Faturamento');

      const negocios = await http()
        .get(rota('/tenant/reports/deals.csv?days=30'))
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(negocios.status).toBe(200);
      expect(negocios.text).toContain('80000.00');

      const estoque = await http()
        .get(rota('/tenant/reports/inventory.csv'))
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(estoque.status).toBe(200);
      // O estado do anúncio vai junto: é a coluna que diz por que um carro
      // parado não recebe visita.
      expect(estoque.text).toContain('Estado do anúncio');
    });

    it('o CSV do vendedor não carrega coluna de dinheiro', async () => {
      const res = await http()
        .get(rota('/tenant/reports/salespeople.csv?days=30'))
        .set('Authorization', `Bearer ${tokenVendedor1}`);

      expect(res.status).toBe(200);
      expect(res.text).not.toContain('Faturamento');
      expect(res.text).not.toContain('Comissão');
      expect(res.text).toContain('Ana Vendedora');
    });
  });
});
