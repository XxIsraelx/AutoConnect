import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TIPOS_CONSULTA,
  type EntradaConsulta,
  type FornecedorDeConsulta,
  type ResultadoConsulta,
  type TipoConsulta,
} from '@autoconnect/shared';

export const FORNECEDOR_DE_CONSULTA = Symbol('FornecedorDeConsulta');

/**
 * Fornecedor ausente.
 *
 * Consulta veicular depende de contrato comercial, e até haver um o sistema
 * precisa dizer isso em voz alta. A alternativa — devolver "nada encontrado" —
 * seria pior: viraria selo de procedência afirmando que o carro está limpo com
 * base em consulta que nunca aconteceu.
 */
@Injectable()
export class FornecedorIndisponivel implements FornecedorDeConsulta {
  readonly nome = 'nenhum';
  readonly custoCentavos = 0;
  readonly tiposSuportados = TIPOS_CONSULTA;

  consultar(): Promise<{ cru: unknown; resultado: ResultadoConsulta }> {
    return Promise.reject(
      new ServiceUnavailableException(
        'Nenhum fornecedor de consulta veicular está configurado. ' +
          'A consulta depende de contrato com fornecedor.',
      ),
    );
  }
}

/**
 * Fornecedor de desenvolvimento.
 *
 * Existe para exercer o caminho completo — cache, idempotência, custo, selo —
 * sem contrato e sem gastar. Só é montado quando `CONSULTA_FORNECEDOR=simulado`,
 * e **nunca** deve responder em produção: o resultado é derivado da placa, não
 * de dado real.
 */
@Injectable()
export class FornecedorSimulado implements FornecedorDeConsulta {
  readonly nome = 'simulado';
  readonly custoCentavos = 0;
  readonly tiposSuportados = TIPOS_CONSULTA;

  consultar(
    entrada: EntradaConsulta,
    tipo: TipoConsulta,
  ): Promise<{ cru: unknown; resultado: ResultadoConsulta }> {
    const alvo = (entrada.placa ?? entrada.chassi ?? '').toUpperCase();
    // Determinístico: a mesma placa devolve sempre o mesmo resultado, senão o
    // teste de cache não distinguiria acerto de cache de nova chamada.
    const soma = [...alvo].reduce((a, c) => a + c.charCodeAt(0), 0);
    const alerta = soma % 5 === 0;

    const resultado: ResultadoConsulta = {
      tipo,
      alerta,
      resumo: alerta
        ? 'Simulação: ocorrência encontrada'
        : 'Simulação: nada encontrado',
      ...(alerta ? { itens: [{ descricao: 'Ocorrência simulada' }] } : {}),
    };

    return Promise.resolve({
      cru: { simulado: true, alvo, tipo, soma },
      resultado,
    });
  }
}

/** Escolhe o fornecedor pela configuração. */
export function fornecedorConfigurado(config: ConfigService): FornecedorDeConsulta {
  const escolhido = config.get<string>('CONSULTA_FORNECEDOR');

  if (escolhido === 'simulado') {
    if (config.get<string>('NODE_ENV') === 'production') {
      // Selo de procedência com dado inventado é informação falsa na vitrine.
      new Logger('ConsultaVeicular').error(
        'CONSULTA_FORNECEDOR=simulado ignorado em produção.',
      );
      return new FornecedorIndisponivel();
    }
    return new FornecedorSimulado();
  }

  return new FornecedorIndisponivel();
}
