import {
  DURACAO_DO_TRIAL_DIAS,
  cnpjValido,
  signupTenantSchema,
  slugDeLoja,
  reenviarVerificacaoSchema,
} from './auth';

/**
 * O cadastro de concessionária depois de 25/09/2026.
 *
 * O que estes casos fixam não é "o Zod funciona" — é a decisão: **cinco campos
 * obrigatórios e nenhum convite**. Cada `it` abaixo falha no schema anterior,
 * que exigia `inviteToken`, razão social, slug, e-mail da loja, CPF e cargo do
 * responsável e sete campos de endereço antes de a pessoa ver qualquer tela.
 */
describe('cadastro de concessionária', () => {
  /** CNPJ com dígitos verificadores corretos, a partir de uma base de 12. */
  function cnpjDeTeste(base12: string): string {
    const dv = (c: string, n: number) => {
      let s = 0, p = n - 7;
      for (let i = 0; i < n; i++) { s += Number(c[i]) * p--; if (p < 2) p = 9; }
      return s % 11 < 2 ? 0 : 11 - (s % 11);
    };
    const d1 = dv(base12, 12);
    const d2 = dv(`${base12}${d1}`, 13);
    return `${base12}${d1}${d2}`;
  }

  const CNPJ = cnpjDeTeste('112223330001');

  /** O corpo mínimo que a tela de cadastro manda hoje. */
  const minimo = {
    tenant: { cnpj: CNPJ, tradeName: 'Garagem Central' },
    admin: { fullName: 'Márcio Tavares', email: 'marcio@exemplo.test', password: 'senha-forte-1' },
  };

  describe('cnpjValido', () => {
    it('aceita CNPJ com dígitos verificadores corretos, formatado ou não', () => {
      expect(cnpjValido(CNPJ)).toBe(true);
      expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    });

    it('recusa dígito verificador errado e sequência repetida', () => {
      expect(cnpjValido('11222333000182')).toBe(false);
      expect(cnpjValido('11111111111111')).toBe(false);
      expect(cnpjValido('112223330001')).toBe(false); // curto
    });
  });

  describe('slugDeLoja', () => {
    it('tira acento, pontuação e espaço', () => {
      expect(slugDeLoja('Garagem Central')).toBe('garagem-central');
      expect(slugDeLoja('Açaí & Cia. Veículos')).toBe('acai-cia-veiculos');
    });

    it('não deixa hífen sobrando nas pontas, nem depois do corte de 50', () => {
      expect(slugDeLoja('  -- Loja --  ')).toBe('loja');
      const longo = slugDeLoja('a'.repeat(48) + ' bcd');
      expect(longo.length).toBeLessThanOrEqual(50);
      expect(longo.endsWith('-')).toBe(false);
    });

    it('devolve vazio quando não sobra nada aproveitável', () => {
      // Quem chama decide o fallback — a API usa "loja".
      expect(slugDeLoja('🚗🚗')).toBe('');
    });
  });

  describe('signupTenantSchema', () => {
    it('aceita o corpo mínimo: CNPJ, nome da loja, nome, e-mail e senha', () => {
      const saida = signupTenantSchema.parse(minimo);
      expect(saida.tenant.cnpj).toBe(CNPJ);
      expect(saida.tenant.tradeName).toBe('Garagem Central');
      expect(saida.inviteToken).toBeUndefined();
      expect(saida.branch).toBeUndefined();
    });

    it('os 17 campos que saíram do formulário não voltam como obrigatórios', () => {
      // Cada um destes era exigido antes de a pessoa ver qualquer tela. O corpo
      // mínimo não tem nenhum deles, e o parse tem que passar — é o teste que
      // falha no dia em que alguém "só acrescentar um campinho".
      const saida = signupTenantSchema.parse(minimo);
      expect(saida.tenant.legalName).toBeUndefined();
      expect(saida.tenant.slug).toBeUndefined();
      expect(saida.tenant.primaryEmail).toBeUndefined();
      expect(saida.tenant.stateRegistration).toBeUndefined();
      expect(saida.admin.cpf).toBeUndefined();
      expect(saida.admin.jobTitle).toBeUndefined();
      expect(saida.admin.phone).toBeUndefined();
    });

    it('continua aceitando o corpo completo — o convite não foi removido', () => {
      const saida = signupTenantSchema.parse({
        ...minimo,
        inviteToken: 'token-de-convite',
        tenant: {
          ...minimo.tenant,
          legalName: 'Garagem Central LTDA',
          slug: 'garagem-central',
          primaryEmail: 'contato@exemplo.test',
          stateRegistration: 'ISENTO',
        },
        admin: { ...minimo.admin, cpf: '111.444.777-35', jobTitle: 'Proprietário', phone: '31988776655' },
        branch: {
          phone: '3132718080', postalCode: '30140-071', addressLine: 'Rua dos Aimorés',
          addressNumber: '981', neighborhood: 'Funcionários', city: 'Belo Horizonte', state: 'MG',
        },
      });
      expect(saida.inviteToken).toBe('token-de-convite');
      expect(saida.admin.cpf).toBe('11144477735');
      expect(saida.branch?.city).toBe('Belo Horizonte');
    });

    it('CNPJ com dígito errado é recusado — a regra dura não depende da Receita', () => {
      const r = signupTenantSchema.safeParse({
        ...minimo,
        tenant: { ...minimo.tenant, cnpj: '11222333000182' },
      });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.path).toEqual(['tenant', 'cnpj']);
    });

    it('é `.strict()`: campo desconhecido vira erro em vez de sumir', () => {
      const r = signupTenantSchema.safeParse({
        ...minimo,
        admin: { ...minimo.admin, role: 'super_admin' },
      });
      expect(r.success).toBe(false);
    });
  });

  describe('reenviarVerificacaoSchema', () => {
    it('exige e-mail válido', () => {
      expect(reenviarVerificacaoSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
      expect(reenviarVerificacaoSchema.safeParse({ email: 'nao-e-email' }).success).toBe(false);
    });
  });

  it('o trial tem uma duração só, e é a que a home anuncia', () => {
    expect(DURACAO_DO_TRIAL_DIAS).toBe(14);
  });
});
