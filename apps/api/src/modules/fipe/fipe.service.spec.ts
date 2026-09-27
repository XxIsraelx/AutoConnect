import {
  FipeService, pontuar, bonusDoCadastro, cobreOCadastro, descricaoDoCadastro,
  sufixosDeCombustivel,
} from './fipe.service';

/**
 * # B16 — a FIPE escolhia a variante errada e culpava o cadastro
 *
 * O piloto do primeiro dia cadastrou **Chevrolet Onix 2022, flex, "1.0 Turbo"**
 * e a tela respondeu *"Não encontramos este veículo na tabela FIPE — confira
 * marca, modelo e ano"*. O cadastro estava certo.
 *
 * O caso reproduzido aqui é o real: 38 variantes do Onix empatando em 80 pontos,
 * com a primeira da lista sendo **"ONIX Lollapalooza 1.0 F.Power 5p Mec."**,
 * cujo único ano é **2014**. A escolha ficava com ela por ordem de lista, o ano
 * não casava, e o lojista era mandado conferir o que já estava correto.
 *
 * As respostas da Parallelum são de mentira: é a escolha que está sob teste,
 * não a rede.
 */
describe('FIPE — escolha de variante', () => {
  const MARCAS = [
    { codigo: '21', nome: 'Fiat' },
    { codigo: '23', nome: 'GM - Chevrolet' },
    { codigo: '56', nome: 'Volkswagen' },
  ];

  /**
   * A lista real, encurtada — com a Lollapalooza primeiro, como vem da FIPE, e
   * **sem nenhum nome que contenha a palavra "turbo"**: a FIPE grafa "TB". Era
   * exatamente isso que fazia "Onix 1.0 Turbo" pontuar abaixo do mínimo e a
   * escolha cair no empate de 38 variantes.
   */
  const MODELOS_CHEVROLET = [
    { codigo: '4321', nome: 'ONIX Lollapalooza 1.0 F.Power 5p Mec.' },
    { codigo: '4322', nome: 'ONIX HATCH LT 1.0 8V FlexPower 5p Mec.' },
    { codigo: '4323', nome: 'ONIX HATCH LTZ 1.4 8V FlexPower 5p Aut.' },
    { codigo: '4324', nome: 'ONIX PLUS 1.0 12V TB Flex Aut.' },
    { codigo: '4325', nome: 'ONIX 1.0 12V Flex Mec.' },
    { codigo: '4326', nome: 'ONIX 1.0 12V TB Flex Aut.' },
    { codigo: '4327', nome: 'ONIX Joy 1.0 8V Flex 5p Mec.' },
    { codigo: '9001', nome: 'CRUZE LT 1.8 16V FlexPower Aut.' },
  ];

  /** Só a Lollapalooza é de 2014; o resto tem 2022. */
  const ANOS: Record<string, { codigo: string; nome: string }[]> = {
    '4321': [{ codigo: '2014-1', nome: '2014 Gasolina' }],
    '4322': [{ codigo: '2015-1', nome: '2015 Gasolina' }],
    '4323': [{ codigo: '2016-1', nome: '2016 Gasolina' }],
    '4324': [{ codigo: '2022-5', nome: '2022 Flex' }],
    '4325': [{ codigo: '2022-5', nome: '2022 Flex' }],
    '4326': [{ codigo: '2022-5', nome: '2022 Flex' }, { codigo: '2023-5', nome: '2023 Flex' }],
    '4327': [{ codigo: '2019-1', nome: '2019 Gasolina' }],
    '9001': [{ codigo: '2022-5', nome: '2022 Flex' }],
  };

  const VALORES: Record<string, string> = {
    '4324': 'R$ 89.500,00',   // Plus turbo
    '4325': 'R$ 72.300,00',   // hatch aspirado
    '4326': 'R$ 95.700,00',   // hatch turbo
    '4321': 'R$ 28.100,00',   // Lollapalooza 2014
  };

  const fetchOriginal = global.fetch;
  let chamadas: string[];

  beforeEach(() => {
    chamadas = [];
    global.fetch = jest.fn(async (url: string) => {
      const caminho = String(url).replace('https://parallelum.com.br/fipe/api/v1/carros', '');
      chamadas.push(caminho);

      if (caminho === '/marcas') return ok(MARCAS);

      const modelos = /^\/marcas\/(\d+)\/modelos$/.exec(caminho);
      if (modelos) {
        return ok({ modelos: modelos[1] === '23' ? MODELOS_CHEVROLET : [] });
      }

      const anos = /^\/marcas\/\d+\/modelos\/(\d+)\/anos$/.exec(caminho);
      if (anos) return ok(ANOS[anos[1]] ?? []);

      const valor = /^\/marcas\/\d+\/modelos\/(\d+)\/anos\/(\d{4})-\d$/.exec(caminho);
      if (valor) {
        const modelo = MODELOS_CHEVROLET.find((m) => m.codigo === valor[1])!;
        return ok({
          Valor: VALORES[valor[1]] ?? 'R$ 50.000,00',
          Marca: 'GM - Chevrolet',
          Modelo: modelo.nome,
          AnoModelo: Number(valor[2]),
          Combustivel: 'Gasolina',
          CodigoFipe: `004${valor[1]}-2`,
          MesReferencia: 'setembro de 2026 ',
        });
      }

      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => { global.fetch = fetchOriginal; });

  const ok = (corpo: unknown) => ({ ok: true, status: 200, json: async () => corpo });

  const onix = {
    brandName: 'Chevrolet',
    modelName: 'Onix',
    yearModel: 2022,
    fuel: 'flex',
  };

  it('não escolhe a variante de 2014 para um carro 2022 — o caso do piloto', async () => {
    const svc = new FipeService();

    const r = await svc.estimate({ ...onix, versionName: '1.0 Turbo' });

    expect(r).not.toBeNull();
    // Antes: "ONIX Lollapalooza 1.0 F.Power 5p Mec." (2014) ganhava por ordem
    // de lista, o ano não casava e a resposta era `null`.
    expect(r!.vehicleName).not.toContain('Lollapalooza');
    expect(r!.yearModel).toBe(2022);
  });

  it('"Turbo" do cadastro casa com o "TB" da FIPE', async () => {
    const svc = new FipeService();

    const r = await svc.estimate({ ...onix, versionName: '1.0 Turbo', transmission: 'automatic' });

    // Das duas turbo automáticas de 2022, a hatch é a mais próxima de "Onix"
    // (a Plus carrega uma palavra que ninguém cadastrou).
    expect(r!.vehicleName).toBe('ONIX 1.0 12V TB Flex Aut.');
    expect(r!.price).toBe(95700);
  });

  it('versão que só uma variante cobre inteira é confiança alta', async () => {
    const svc = new FipeService();

    const r = await svc.estimate({ ...onix, versionName: 'Plus 1.0 Turbo' });

    expect(r!.vehicleName).toBe('ONIX PLUS 1.0 12V TB Flex Aut.');
    expect(r!.price).toBe(89500);
    expect(r!.confianca).toBe('alta');
    // Confiança alta não oferece lista: semear dúvida em quem acertou é ruído.
    expect(r!.alternativas).toEqual([]);
  });

  it('ambiguidade real (hatch × Plus) é dita como estimativa, não afirmada', async () => {
    const svc = new FipeService();

    // "1.0 Turbo" existe como hatch e como Plus, com R$ 6.200 de diferença.
    // Escolher uma e afirmar é o erro que o B16 relata, em versão silenciosa.
    const r = await svc.estimate({ ...onix, versionName: '1.0 Turbo', transmission: 'automatic' });

    expect(r!.confianca).toBe('media');
    expect(r!.alternativas.map((a) => a.name)).toContain('ONIX PLUS 1.0 12V TB Flex Aut.');
  });

  it('versão que nenhuma variante menciona vira confiança baixa', async () => {
    const svc = new FipeService();

    const r = await svc.estimate({ ...onix, versionName: 'Premier' });

    expect(r).not.toBeNull();
    expect(r!.confianca).toBe('baixa');
  });

  it('sem versão informada, admite que é estimativa e oferece as variantes', async () => {
    const svc = new FipeService();

    const r = await svc.estimate(onix);

    expect(r).not.toBeNull();
    expect(r!.confianca).not.toBe('alta');
    expect(r!.alternativas.length).toBeGreaterThan(0);
    // Só variantes que **têm** o ano cadastrado entram na lista: oferecer a de
    // 2014 seria repetir o erro em forma de menu.
    for (const alt of r!.alternativas) {
      expect(alt.name).not.toContain('Lollapalooza');
    }
  });

  it('a variante escolhida pelo lojista ganha da heurística', async () => {
    const svc = new FipeService();

    const r = await svc.estimate({ ...onix, modelCode: '4324' });

    expect(r!.vehicleName).toBe('ONIX PLUS 1.0 12V TB Flex Aut.');
    expect(r!.price).toBe(89500);
    expect(r!.confianca).toBe('alta');
  });

  it('`variantes` lista só o que tem o ano — é o que alimenta o `select`', async () => {
    const svc = new FipeService();

    const lista = await svc.variantes(onix);

    expect(lista.map((v) => v.name)).toEqual(
      expect.arrayContaining(['ONIX PLUS 1.0 12V TB Flex Aut.', 'ONIX 1.0 12V Flex Mec.']),
    );
    expect(lista.map((v) => v.name)).not.toContain('ONIX Lollapalooza 1.0 F.Power 5p Mec.');
  });

  it('nenhuma variante com o ano pedido devolve null — sem chutar outro ano', async () => {
    const svc = new FipeService();

    // 1998 não existe em variante nenhuma. Devolver o valor de 2022 seria pior
    // que não mostrar nada: o lojista precificaria pelo carro errado.
    expect(await svc.estimate({ ...onix, yearModel: 1998 })).toBeNull();
  });

  it('marca desconhecida não vira palpite', async () => {
    const svc = new FipeService();
    expect(await svc.estimate({ ...onix, brandName: 'Tucker' })).toBeNull();
  });

  it('a consulta de anos é limitada — a API é gratuita', async () => {
    const svc = new FipeService();

    await svc.estimate(onix);

    const consultasDeAno = chamadas.filter((c) => c.endsWith('/anos'));
    expect(consultasDeAno.length).toBeLessThanOrEqual(6);
  });

  it('serviço fora do ar devolve null, sem lançar', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const svc = new FipeService();

    await expect(svc.estimate(onix)).resolves.toBeNull();
  });
});

describe('FIPE — a pontuação', () => {
  it('nome enxuto ganha de nome cheio de palavra que ninguém pediu', () => {
    // A causa raiz: `startsWith` dava 80 para as duas, e 38 variantes empatavam.
    expect(pontuar('Onix', 'ONIX 1.0 12V Flex Mec.')).toBeGreaterThan(
      pontuar('Onix', 'ONIX Lollapalooza 1.0 F.Power 5p Mec.'),
    );
  });

  it('igualdade exata vale 100 e nada a supera', () => {
    expect(pontuar('Argo', 'ARGO')).toBe(100);
    expect(pontuar('Argo', 'argo')).toBe(100);
  });

  it('"Chevrolet" casa com "GM - Chevrolet" com folga', () => {
    expect(pontuar('Chevrolet', 'GM - Chevrolet')).toBeGreaterThanOrEqual(55);
  });

  it('sem palavra em comum, zero — não há palpite', () => {
    expect(pontuar('Onix', 'CRUZE LT 1.8 16V FlexPower Aut.')).toBe(0);
  });

  it('o ponto final de abreviatura não impede o casamento de câmbio', () => {
    // "Mec." precisava virar "mec" para que o câmbio manual fosse reconhecido.
    expect(bonusDoCadastro('ONIX 1.0 12V Flex Mec.', { transmission: 'manual' })).toBeGreaterThan(0);
    expect(bonusDoCadastro('ONIX 1.0 12V TB Flex Aut.', { transmission: 'manual' })).toBeLessThan(0);
  });

  it('motor e versão do cadastro somam', () => {
    expect(bonusDoCadastro('ONIX 1.0 12V TB Flex Aut.', { versionName: '1.0 Turbo' }))
      .toBeGreaterThan(0);
    expect(bonusDoCadastro('ONIX Joy 1.0 8V Flex 5p Mec.', { versionName: 'Premier' })).toBe(0);
  });

  it('flex é 5 na FIPE, não 1 — conferido contra a API ao vivo', () => {
    // O código antigo mandava flex para `1` (gasolina) e só não errava porque
    // caía no "primeiro código daquele ano". O Onix 2022 flex é `2022-5`.
    expect(sufixosDeCombustivel('flex')[0]).toBe('5');
    expect(sufixosDeCombustivel('gasoline')[0]).toBe('1');
    expect(sufixosDeCombustivel('ethanol')[0]).toBe('2');
    expect(sufixosDeCombustivel('diesel')).toEqual(['3']);
    // Híbrido, elétrico e GNV não têm sufixo próprio: quem decide é o ano.
    expect(sufixosDeCombustivel('electric')).toEqual([]);
    expect(sufixosDeCombustivel(undefined)).toEqual([]);
  });
});

describe('FIPE — a cobertura do cadastro', () => {
  it('"Turbo" do lojista é o "TB" da FIPE', () => {
    const alvo = descricaoDoCadastro({ modelName: 'Onix', versionName: '1.0 Turbo' });
    expect(cobreOCadastro('ONIX 1.0 12V TB Flex Aut.', alvo)).toBe(true);
    expect(cobreOCadastro('ONIX 1.0 12V Flex Mec.', alvo)).toBe(false);
  });

  it('uma palavra a mais no cadastro é uma palavra a mais para cobrir', () => {
    const alvo = descricaoDoCadastro({ modelName: 'Onix', versionName: 'Plus 1.0 Turbo' });
    expect(cobreOCadastro('ONIX PLUS 1.0 12V TB Flex Aut.', alvo)).toBe(true);
    expect(cobreOCadastro('ONIX 1.0 12V TB Flex Aut.', alvo)).toBe(false);
  });

  it('o motor entra na descrição', () => {
    const alvo = descricaoDoCadastro({ modelName: 'Argo', engine: '1.3' });
    expect(cobreOCadastro('ARGO DRIVE 1.3 8V Flex', alvo)).toBe(true);
    expect(cobreOCadastro('ARGO DRIVE 1.0 6V Flex', alvo)).toBe(false);
  });
});
