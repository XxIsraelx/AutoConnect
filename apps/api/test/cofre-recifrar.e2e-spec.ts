import { randomBytes } from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrivilegedPrismaService } from '../src/common/prisma/privileged-prisma.service';
import { CofreService } from '../src/common/cofre/cofre.service';
import { lerChavesMestras, type ChavesMestras } from '../src/common/cofre/cifra';
import { recifrarCofre } from '../src/scripts/recifrar-cofre';
import { criarDoisTenants, type DoisTenants } from './helpers/tenant-fixture';

/**
 * Troca da chave-mestra do cofre, de ponta a ponta no Postgres: a credencial
 * cifrada com a v1 continua abrindo depois de recifrada com a v2 — e só com a
 * v2 configurada, que é o estado final da troca.
 */
describe('cofre — troca da chave-mestra (e2e)', () => {
  let dono: PrivilegedPrismaService;
  let f: DoisTenants;
  const v1 = randomBytes(32).toString('base64');
  const v2 = randomBytes(32).toString('base64');

  const cofreCom = (chaves: string) =>
    new CofreService({ get: () => chaves } as unknown as ConfigService);

  beforeAll(async () => {
    const m = await Test.createTestingModule({ providers: [PrivilegedPrismaService] }).compile();
    dono = m.get(PrivilegedPrismaService);
    await dono.$connect();
    f = await criarDoisTenants(dono);
  }, 60_000);

  afterAll(async () => {
    await dono.credencialDeIntegracao.deleteMany({ where: { tenantId: { in: [f.a.id, f.b.id] } } });
    await f?.limpar();
    await dono?.$disconnect();
  });

  it('recifra o que está na v1 e a v2 sozinha passa a abrir', async () => {
    // A conexão dona ignora RLS: o cofre recebe ela como transação, como
    // receberia a do `withTenant` na API.
    await cofreCom(`1:${v1}`).guardar(dono as never, f.a.id, 'simulado', 'sim_chave_antiga_123', f.a.usuarioId);

    const chaves = lerChavesMestras(`1:${v1},2:${v2}`) as ChavesMestras;
    expect(await recifrarCofre(dono, chaves)).toEqual({ recifradas: 1, restantes: 0 });

    const linha = await dono.credencialDeIntegracao.findFirstOrThrow({ where: { tenantId: f.a.id } });
    expect(linha.versaoDaChave).toBe(2);
    expect(await cofreCom(`2:${v2}`).abrir(dono as never, f.a.id, 'simulado')).toBe('sim_chave_antiga_123');
    // Com a v1 apenas, a credencial recifrada não abre mais.
    await expect(cofreCom(`1:${v1}`).abrir(dono as never, f.a.id, 'simulado')).rejects.toThrow(/v2/);
  });

  it('a cifra de uma loja não abre como se fosse da outra', async () => {
    const linhaA = await dono.credencialDeIntegracao.findFirstOrThrow({ where: { tenantId: f.a.id } });
    await dono.credencialDeIntegracao.create({
      data: { ...linhaA, id: undefined, tenantId: f.b.id, cadastradaEm: undefined },
    });
    await expect(cofreCom(`2:${v2}`).abrir(dono as never, f.b.id, 'simulado')).rejects.toThrow();
  });
});
