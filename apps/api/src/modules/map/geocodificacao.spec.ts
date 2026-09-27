import {
  GeocodificacaoService,
  consultasDe,
  JANELA_DE_NOVA_TENTATIVA_MS,
  type FilialLocalizavel,
} from './geocodificacao.service';
import type { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';

/**
 * B8 — o pino caía no centro da cidade.
 *
 * `map.service.ts` geocodificava **só o município**, persistia e nunca mais
 * tentava: a Garagem Central, na Rua dos Aimorés, aparecia na Praça Sete, a
 * 1,5 km, e o "Como chegar" levava o cliente para lá. Duas lojas da mesma
 * cidade caíam no mesmo ponto.
 *
 * Aqui a Nominatim é de mentira. O que se fixa é a **decisão**: o endereço vem
 * primeiro, o município é último recurso, a precisão é classificada pelo que
 * voltou (e não pelo que se pediu), a coordenada do lojista é intocável, e
 * falha nenhuma propaga.
 */
describe('geocodificação da filial', () => {
  const FILIAL: FilialLocalizavel = {
    id: 'b1',
    addressLine: 'Rua dos Aimorés',
    addressNumber: '1200',
    neighborhood: 'Funcionários',
    city: 'Belo Horizonte',
    state: 'MG',
    postalCode: '30140-071',
    latitude: null,
    longitude: null,
    geocodePrecision: null,
    geocodedAt: null,
  };

  /** Coleta os `q` pedidos e devolve o que cada caso combinar. */
  function fetchDeMentira(
    responder: (q: string) => unknown[] | { status: number } | Error,
  ): { chamadas: string[]; fn: jest.Mock } {
    const chamadas: string[] = [];
    const fn = jest.fn(async (url: string) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      chamadas.push(q);
      const r = responder(q);
      if (r instanceof Error) throw r;
      if (!Array.isArray(r)) return { ok: false, status: r.status, json: async () => [] };
      return { ok: true, status: 200, json: async () => r };
    });
    return { chamadas, fn: fn as unknown as jest.Mock };
  }

  /**
   * A fila serializa as chamadas com 1,1 s de espaço para respeitar a política
   * da Nominatim. Aqui o espaço é zero: o que se testa é a decisão, e 1,1 s por
   * chamada faria a suíte dormir por nada.
   */
  class SemEspera extends GeocodificacaoService {
    protected get intervaloMs(): number { return 0; }
  }

  function servico() {
    const update = jest.fn(async () => undefined);
    const privilegiado = {
      dealershipBranch: { update },
    } as unknown as PrivilegedPrismaService;
    return { svc: new SemEspera(privilegiado), update };
  }

  const fetchOriginal = global.fetch;

  beforeEach(() => {
    delete process.env.GEOCODIFICACAO_DESLIGADA;
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  const correr = <T,>(p: Promise<T>): Promise<T> => p;

  describe('as consultas montadas', () => {
    it('o endereço completo vem antes do município', () => {
      const consultas = consultasDe(FILIAL);

      expect(consultas[0]).toEqual({
        q: 'Rua dos Aimorés, 1200, Funcionários, Belo Horizonte, MG, 30140071, Brasil',
        alvo: 'address',
      });
      // Segunda tentativa sem bairro e sem CEP: a cobertura de bairro do OSM
      // brasileiro é irregular, e um bairro desconhecido derruba a busca.
      expect(consultas[1]).toEqual({ q: 'Rua dos Aimorés, 1200, Belo Horizonte, MG, Brasil', alvo: 'address' });
      // O município continua existindo — loja sem rua não pode ficar fora do mapa.
      expect(consultas.at(-1)).toEqual({ q: 'Belo Horizonte, MG, Brasil', alvo: 'city' });
    });

    it('sem rua, o CEP ainda vale mais que o centro da cidade', () => {
      const consultas = consultasDe({ ...FILIAL, addressLine: null, addressNumber: null });
      expect(consultas[0]).toEqual({ q: '30140071, Belo Horizonte, MG, Brasil', alvo: 'address' });
    });

    it('sem endereço nenhum, não há nada para consultar', () => {
      expect(
        consultasDe({
          ...FILIAL, addressLine: null, addressNumber: null, postalCode: null,
          city: null, state: null,
        }),
      ).toEqual([]);
    });
  });

  describe('a decisão', () => {
    it('grava `address` quando o endereço resolve — e não consulta o município', async () => {
      const { chamadas, fn } = fetchDeMentira(() => [
        { lat: '-19.9245', lon: '-43.9352', addresstype: 'house' },
      ]);
      global.fetch = fn;
      const { svc, update } = servico();

      const r = await correr(svc.localizar(FILIAL));

      expect(r).toEqual({ latitude: -19.9245, longitude: -43.9352, precisao: 'address' });
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]).toContain('Rua dos Aimorés');
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            latitude: -19.9245, longitude: -43.9352, geocodePrecision: 'address',
          }),
        }),
      );
    });

    it('o município que responde a uma busca de rua é `city`, não `address`', async () => {
      // A Nominatim devolve o ponto da cidade quando não conhece a rua. Sem
      // esta checagem, o defeito original voltaria com outro nome: um ponto de
      // praça central gravado como se fosse a porta da loja.
      const { fn } = fetchDeMentira(() => [
        { lat: '-19.9227', lon: '-43.9451', addresstype: 'city' },
      ]);
      global.fetch = fn;
      const { svc } = servico();

      const r = await correr(svc.localizar(FILIAL));

      expect(r?.precisao).toBe('city');
    });

    it('cai para o município quando o endereço não é encontrado', async () => {
      const { chamadas, fn } = fetchDeMentira((q) =>
        q.includes('Aimorés') ? [] : [{ lat: '-19.9227', lon: '-43.9451', addresstype: 'city' }],
      );
      global.fetch = fn;
      const { svc } = servico();

      const r = await correr(svc.localizar(FILIAL));

      expect(r).toEqual({ latitude: -19.9227, longitude: -43.9451, precisao: 'city' });
      expect(chamadas).toHaveLength(3);
    });

    it('a coordenada do lojista é intocável — e nada é consultado', async () => {
      const { fn } = fetchDeMentira(() => [{ lat: '-1', lon: '-45', addresstype: 'house' }]);
      global.fetch = fn;
      const { svc, update } = servico();

      const r = await svc.localizar({
        ...FILIAL, latitude: -19.93, longitude: -43.94, geocodePrecision: 'manual',
      });

      expect(r).toEqual({ latitude: -19.93, longitude: -43.94, precisao: 'manual' });
      expect(fn).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('um ponto de município é provisório: ganha o endereço quando ele existe', async () => {
      const { fn } = fetchDeMentira(() => [
        { lat: '-19.9245', lon: '-43.9352', addresstype: 'house' },
      ]);
      global.fetch = fn;
      const { svc } = servico();

      const r = await correr(
        svc.localizar({
          ...FILIAL,
          latitude: -19.9227, longitude: -43.9451,
          geocodePrecision: 'city',
          geocodedAt: new Date(Date.now() - JANELA_DE_NOVA_TENTATIVA_MS - 1000),
        }),
      );

      expect(r).toEqual({ latitude: -19.9245, longitude: -43.9352, precisao: 'address' });
    });

    it('não insiste antes da janela — a cota da Nominatim não é infinita', async () => {
      const { fn } = fetchDeMentira(() => []);
      global.fetch = fn;
      const { svc } = servico();

      const r = await svc.localizar({
        ...FILIAL,
        latitude: -19.9227, longitude: -43.9451,
        geocodePrecision: 'city',
        geocodedAt: new Date(Date.now() - 60_000),
      });

      expect(fn).not.toHaveBeenCalled();
      expect(r).toEqual({ latitude: -19.9227, longitude: -43.9451, precisao: 'city' });
    });

    it('filial só com município resolvido e sem rua não gasta chamada', async () => {
      const { fn } = fetchDeMentira(() => []);
      global.fetch = fn;
      const { svc } = servico();

      await svc.localizar({
        ...FILIAL,
        addressLine: null, addressNumber: null, postalCode: null,
        latitude: -19.9227, longitude: -43.9451, geocodePrecision: 'city',
      });

      expect(fn).not.toHaveBeenCalled();
    });

    it('rede caída devolve o que já havia, sem lançar', async () => {
      const { fn } = fetchDeMentira(() => new Error('getaddrinfo ENOTFOUND'));
      global.fetch = fn;
      const { svc, update } = servico();

      const r = await correr(
        svc.localizar({ ...FILIAL, latitude: -19.92, longitude: -43.94, geocodePrecision: 'city' }),
      );

      expect(r).toEqual({ latitude: -19.92, longitude: -43.94, precisao: 'city' });
      // A tentativa é registrada mesmo sem resultado: senão o mapa tentaria de
      // novo em toda requisição enquanto o serviço estivesse fora.
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ geocodedAt: expect.any(Date) }) }),
      );
    });

    it('429 e 5xx não viram coordenada', async () => {
      const { fn } = fetchDeMentira(() => ({ status: 429 }));
      global.fetch = fn;
      const { svc } = servico();

      expect(await correr(svc.localizar(FILIAL))).toBeNull();
    });

    it('ponto fora do Brasil é descartado', async () => {
      // 0,0 no Golfo da Guiné é o retorno clássico de geocodificador confuso.
      const { fn } = fetchDeMentira(() => [{ lat: '0', lon: '0', addresstype: 'house' }]);
      global.fetch = fn;
      const { svc } = servico();

      expect(await correr(svc.localizar(FILIAL))).toBeNull();
    });

    it('desligada, não sai requisição nenhuma', async () => {
      process.env.GEOCODIFICACAO_DESLIGADA = '1';
      const { fn } = fetchDeMentira(() => [{ lat: '-19', lon: '-43', addresstype: 'house' }]);
      global.fetch = fn;
      const { svc } = servico();

      expect(await svc.localizar(FILIAL)).toBeNull();
      expect(fn).not.toHaveBeenCalled();
    });

    it('`agendar` não propaga falha — o salvamento da filial não pode cair com ela', async () => {
      const { fn } = fetchDeMentira(() => new Error('explodiu'));
      global.fetch = fn;
      const { svc } = servico();

      expect(() => svc.agendar(FILIAL)).not.toThrow();
      await correr(Promise.resolve());
    });
  });
});
