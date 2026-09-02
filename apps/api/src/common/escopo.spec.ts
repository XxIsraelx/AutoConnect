import { ForbiddenException } from '@nestjs/common';
import { escopoDa, ehGlobal } from './escopo';

/**
 * O escopo decide se uma consulta vê uma concessionária ou a plataforma
 * inteira. É a fronteira mais sensível do sistema, e por isso mora num tipo
 * com um único construtor verificado.
 */
describe('escopoDa', () => {
  it('usa a concessionária do usuário quando ela existe', () => {
    const e = escopoDa({ role: 'tenant_admin', tenantId: 'abc' });

    expect(e).toEqual({ tipo: 'tenant', tenantId: 'abc' });
    expect(ehGlobal(e)).toBe(false);
  });

  it('super admin sem concessionária selecionada vê o consolidado', () => {
    const e = escopoDa({ role: 'super_admin', tenantId: null });

    expect(ehGlobal(e)).toBe(true);
  });

  it('super admin impersonando vê só a loja impersonada, não tudo', () => {
    // Impersonation é o caminho normal do super admin operar uma loja. Se o
    // escopo global vazasse aqui, ele veria a plataforma inteira dentro da tela
    // de uma concessionária só.
    const e = escopoDa({ role: 'super_admin', tenantId: 'loja-x' });

    expect(e).toEqual({ tipo: 'tenant', tenantId: 'loja-x' });
    expect(ehGlobal(e)).toBe(false);
  });

  it.each(['tenant_admin', 'manager', 'salesperson', 'customer'])(
    '%s sem concessionária é recusado, não promovido a global',
    (role) => {
      // A falha que este teste impede: um tenantId perdido no meio do caminho
      // virar "vê tudo". Precisa ser erro alto, não consulta sem filtro.
      expect(() => escopoDa({ role, tenantId: null })).toThrow(ForbiddenException);
    },
  );

  it('um papel inventado também é recusado', () => {
    expect(() => escopoDa({ role: 'root', tenantId: null })).toThrow(ForbiddenException);
  });
});
