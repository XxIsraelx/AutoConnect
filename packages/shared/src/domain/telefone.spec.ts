import {
  normalizarTelefoneBr,
  telefoneBrValido,
  formatarTelefoneBr,
  paraWhatsApp,
  mascararTelefoneBr,
  ehCelularBr,
  escolherWhatsApp,
} from './telefone';

describe('normalizarTelefoneBr', () => {
  it('reduz as grafias do mesmo celular a uma forma só', () => {
    const esperado = '11987654321';

    for (const grafia of [
      '11987654321',
      '(11) 98765-4321',
      '11 98765 4321',
      '+55 11 98765-4321',
      '5511987654321',
      '  (11)98765.4321  ',
    ]) {
      expect(normalizarTelefoneBr(grafia)).toBe(esperado);
    }
  });

  it('completa o nono dígito do celular antigo — é o caso que duplicava lead', () => {
    // O cliente cadastrou `1187654321` em 2015 e digita `11987654321` hoje.
    // Sem esta regra, a loja vê duas pessoas.
    expect(normalizarTelefoneBr('1187654321')).toBe('11987654321');
    expect(normalizarTelefoneBr('5511987654321')).toBe('11987654321');
  });

  it('não mexe em telefone fixo', () => {
    expect(normalizarTelefoneBr('1132654321')).toBe('1132654321');
    expect(normalizarTelefoneBr('(11) 3265-4321')).toBe('1132654321');
  });

  it('recusa o que não é telefone brasileiro', () => {
    for (const lixo of [
      '',
      null,
      undefined,
      '123',
      '9999',
      '00987654321',      // DDD 00
      '01987654321',      // DDD 01
      '113265432',        // 9 dígitos
      '119876543210',     // 12 dígitos sem DDI
      '11187654321',      // 11 dígitos, mas o nono dígito não é 9
      '1112345678',       // fixo começando por 1
      'não é telefone',
    ]) {
      expect(normalizarTelefoneBr(lixo)).toBeNull();
    }
  });

  it('não confunde DDD 55 com o DDI 55', () => {
    // `55 99999-9999` é um número do Rio Grande do Sul, não um DDI solto.
    expect(normalizarTelefoneBr('55999999999')).toBe('55999999999');
    // Com DDI de verdade, sobra o DDD 55.
    expect(normalizarTelefoneBr('5555999999999')).toBe('55999999999');
  });

  it('é idempotente — normalizar duas vezes dá o mesmo valor', () => {
    const uma = normalizarTelefoneBr('(11) 98765-4321')!;
    expect(normalizarTelefoneBr(uma)).toBe(uma);
  });
});

describe('telefoneBrValido', () => {
  it('aceita celular e fixo, recusa o resto', () => {
    expect(telefoneBrValido('(21) 99999-8888')).toBe(true);
    expect(telefoneBrValido('2133334444')).toBe(true);
    expect(telefoneBrValido('12345')).toBe(false);
  });
});

describe('formatarTelefoneBr', () => {
  it('formata celular e fixo', () => {
    expect(formatarTelefoneBr('11987654321')).toBe('(11) 98765-4321');
    expect(formatarTelefoneBr('1132654321')).toBe('(11) 3265-4321');
  });

  it('devolve o original quando não sabe formatar, em vez de esconder o dado', () => {
    expect(formatarTelefoneBr('ramal 402')).toBe('ramal 402');
    expect(formatarTelefoneBr(null)).toBe('');
  });
});

describe('paraWhatsApp', () => {
  it('monta o número com DDI para o link wa.me', () => {
    expect(paraWhatsApp('(11) 98765-4321')).toBe('5511987654321');
  });

  it('devolve null quando o número não é válido — link quebrado é pior que link ausente', () => {
    expect(paraWhatsApp('123')).toBeNull();
  });
});


describe('mascararTelefoneBr', () => {
  it('não estraga o fixo — o defeito que o dono viu no próprio número', () => {
    // A máscara antiga agrupava sempre 5+4 e produzia "(31) 32718-080", que ia
    // assim para o banco e para a página pública da loja.
    expect(mascararTelefoneBr('3132718080')).toBe('(31) 3271-8080');
    expect(mascararTelefoneBr('(31) 3271-8080')).toBe('(31) 3271-8080');
  });

  it('o décimo primeiro dígito é o que move o corte para 5+4', () => {
    expect(mascararTelefoneBr('31988776655')).toBe('(31) 98877-6655');
  });

  it('acompanha a digitação sem exigir número completo', () => {
    expect(mascararTelefoneBr('')).toBe('');
    expect(mascararTelefoneBr('3')).toBe('(3');
    expect(mascararTelefoneBr('31')).toBe('(31');
    expect(mascararTelefoneBr('319')).toBe('(31) 9');
    expect(mascararTelefoneBr('3198877')).toBe('(31) 9887-7');
  });

  it('descarta o que passa de onze dígitos em vez de embaralhar', () => {
    expect(mascararTelefoneBr('319887766559999')).toBe('(31) 98877-6655');
  });
});

describe('escolha do número do WhatsApp', () => {
  it('fixo não é celular — o botão não pode apontar para ele', () => {
    expect(ehCelularBr('(31) 3271-8080')).toBe(false);
    expect(ehCelularBr('(31) 98877-6655')).toBe(true);
    // Dez dígitos começando por 9 é celular antigo: a normalização completa o
    // nono dígito, e o WhatsApp funciona.
    expect(ehCelularBr('3198877665')).toBe(true);
  });

  it('pega o primeiro celular da lista, na ordem em que a tela prefere', () => {
    expect(escolherWhatsApp('(31) 3271-8080', '(31) 98877-6655')).toBe('5531988776655');
    expect(escolherWhatsApp('(31) 98877-6655', '(31) 3271-8080')).toBe('5531988776655');
  });

  it('só fixo: devolve null e a tela esconde o botão', () => {
    expect(escolherWhatsApp('(31) 3271-8080', null, undefined)).toBeNull();
    expect(escolherWhatsApp()).toBeNull();
  });
});
