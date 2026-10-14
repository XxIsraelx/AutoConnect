import {
  BadGatewayException, ConflictException, Inject, Injectable, Logger, NotFoundException,
  ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@autoconnect/db';
import { PrismaService, type ScopedClient } from '../../common/prisma/prisma.service';
import { PrivilegedPrismaService } from '../../common/prisma/privileged-prisma.service';
import { DocumentosStorage } from '../../common/armazenamento/documentos.storage';
import type { Escopo } from '../../common/escopo';
import {
  ehEntrada, normalizarCnpj, statusDepoisDoEvento, tipoDoDocumento,
  type CancelarRenaveInput, type EnviarRenaveInput, type EventoDoRenave,
  type PedidoDeEntradaRenave, type PedidoDeSaidaRenave, type ProvedorDeRenave,
  type RespostaDoRenave, type TipoDeEventoRenave,
} from '@autoconnect/shared';
import { sha256Hex } from '../contracts/assinatura/hmac';
import { PROVEDOR_DE_RENAVE } from './provedor';
import { ProvedorRenaveSimulado } from './provedor-simulado';
import {
  RenaveService, SELECAO_DO_REGISTRO, traduzirUnicidade, type LinhaDoRegistro,
} from './renave.service';

type Cabecalhos = Record<string, string | string[] | undefined>;

export interface ResultadoDoWebhookRenave {
  recebido: true;
  aplicado: boolean;
  motivo?: 'ignorado' | 'operacao-desconhecida' | 'repetido' | 'fora-de-ordem';
}

/**
 * RENAVE pela integradora (R2 do plano fiscal).
 *
 * O caminho de um envio, na ordem, e por que cada passo está onde está:
 *
 *  1. **Reservar** (transação): as mesmas checagens do registro manual
 *     (`prepararRegistro`), e a linha nasce `pendente` com a sequência — antes
 *     de falar com a integradora. Se a rede cair depois, o reenvio acha a linha
 *     e manda a **mesma chave de idempotência**: a integradora devolve a mesma
 *     operação em vez de criar outra.
 *  2. **Enviar** (fora de transação): rede não segura conexão de banco aberta,
 *     e a ~0,6 s do banco uma transação que espera a integradora estoura.
 *  3. **Aplicar** (transação): a resposta vira estado pela máquina da R1, e o
 *     retorno cru vira linha em `renave_eventos`.
 *
 * O **código de segurança do CRV** passa por aqui e não fica: vai no pedido à
 * integradora e não entra em coluna, snapshot nem evento (decisão de
 * 14/10/2026). Reenviar pede de novo.
 *
 * O webhook é o único caminho sem loja: acha o registro pela conexão
 * privilegiada (uma leitura, por chave única) e aplica sob `withTenant`.
 */
@Injectable()
export class RenaveIntegracaoService {
  private readonly logger = new Logger(RenaveIntegracaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly privilegiado: PrivilegedPrismaService,
    private readonly storage: DocumentosStorage,
    private readonly config: ConfigService,
    private readonly renave: RenaveService,
    @Inject(PROVEDOR_DE_RENAVE) private readonly provedor: ProvedorDeRenave,
  ) {}

  get simulado(): boolean {
    return this.provedor instanceof ProvedorRenaveSimulado &&
      this.config.get<string>('NODE_ENV') !== 'production';
  }

  /** O que a tela precisa para mostrar (ou esconder) o envio. */
  capacidade() {
    return {
      disponivel: this.provedor.disponivel,
      provedor: this.provedor.disponivel ? this.provedor.nome : null,
      sandbox: Boolean(this.provedor.sandbox),
      simulado: this.simulado,
    };
  }

  private exigirProvedor(): void {
    if (!this.provedor.disponivel) {
      // O indisponível já recusa em cada método; checar antes evita reservar
      // uma linha que nunca vai sair daqui.
      throw new ServiceUnavailableException(
        'Nenhuma integradora RENAVE está configurada. Registre pela sua integradora e anote o protocolo.',
      );
    }
  }

  /* ── Envio ──────────────────────────────────────────────── */

  async enviar(escopo: Escopo, dados: EnviarRenaveInput, autor: { id: string }) {
    const tenantId = this.renave.tenantDe(escopo);
    this.exigirProvedor();

    // ── 1. Reservar ──────────────────────────────────────────
    const { linha, cnpj } = await this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { taxId: true } });
      if (!tenant?.taxId) {
        throw new UnprocessableEntityException(
          'Cadastre o CNPJ da loja em Configurações: é por ele que a integradora identifica o estabelecimento.',
        );
      }

      // Envio que ficou no meio do caminho (a integradora não respondeu): o
      // mesmo pedido, com a mesma chave. Não é registro novo.
      const retomavel = await tx.renaveRegistro.findFirst({
        where: {
          tenantId, vehicleId: dados.vehicleId, tipo: dados.tipo, dealId: dados.dealId ?? null,
          provider: this.provedor.nome, externalId: null, status: 'pendente',
        },
        select: SELECAO_DO_REGISTRO,
      });
      if (retomavel) return { linha: retomavel, cnpj: tenant.taxId };

      const p = await this.renave.prepararRegistro(tx, tenantId, dados);
      if (!p.veiculo.placa) {
        throw new UnprocessableEntityException('O veículo não tem placa cadastrada: o RENAVE identifica o carro por ela.');
      }

      const snapshot: Record<string, unknown> = {
        ...p.snapshot,
        // RENAVAM, tipo e número do CRV e o hodômetro estão impressos no CRLV
        // que circula com o carro. O código de segurança, não — e não entra.
        documento: {
          renavam: dados.crv.renavam, tipoCrv: dados.crv.tipoCrv, numeroCrv: dados.crv.numeroCrv ?? null,
        },
      };

      if (ehEntrada(dados.tipo)) {
        // `normalizarCnpj` e não `replace(/\D/g, '')`: o CNPJ alfanumérico
        // perderia as letras. Serve para o CPF também.
        const bruto = p.veiculo.documentoDoFornecedor ?? dados.documentoDoProprietario ?? null;
        const documento = bruto ? normalizarCnpj(bruto) : null;
        if (dados.tipo === 'entrada_compra' && !tipoDoDocumento(documento)) {
          throw new UnprocessableEntityException(
            'Informe o CPF ou CNPJ de quem consta no CRV: o RENAVE confere o vendedor pelo documento.',
          );
        }
        const vendedor = (p.snapshot.vendedor as { nome?: string | null } | undefined) ?? {};
        snapshot.vendedor = { nome: vendedor.nome ?? null, documento };
        snapshot.hodometro = {
          km: dados.quilometragem ?? p.veiculo.km,
          medidoEm: (dados.dataOperacao ?? p.dataOperacao).toISOString(),
        };
      }

      if (dados.tipo === 'saida_venda' && !p.comprador) {
        throw new UnprocessableEntityException(
          'Preencha a qualificação do comprador no negócio: a saída no RENAVE exige o documento dele.',
        );
      }

      try {
        const criada = await tx.renaveRegistro.create({
          data: {
            tenantId,
            vehicleId: p.veiculo.id,
            dealId: dados.dealId ?? null,
            tipo: dados.tipo,
            status: 'pendente',
            origem: 'integradora',
            provider: this.provedor.nome,
            enviadoEm: new Date(),
            dataOperacao: p.dataOperacao,
            valor: p.valor,
            snapshot: snapshot as Prisma.InputJsonValue,
            sequencia: p.sequencia,
            observacao: dados.observacao ?? null,
            createdBy: autor.id,
          },
          select: SELECAO_DO_REGISTRO,
        });
        return { linha: criada, cnpj: tenant.taxId };
      } catch (e) {
        throw traduzirUnicidade(e);
      }
    });

    // ── 2. Enviar ────────────────────────────────────────────
    let resposta: RespostaDoRenave;
    try {
      resposta = await this.chamar(linha, dados, cnpj);
    } catch (e) {
      this.logger.warn(`Envio RENAVE ${linha.id} sem resposta da integradora: ${(e as Error).message}`);
      throw new BadGatewayException(
        'A integradora não respondeu. O envio ficou guardado como pendente: envie de novo ' +
          '(o código de segurança do CRV é pedido outra vez, porque não é guardado).',
      );
    }

    // ── 3. Aplicar ───────────────────────────────────────────
    return this.aplicarResposta(tenantId, linha.id, resposta);
  }

  /** O pedido à integradora, montado da linha reservada — é o que torna o reenvio igual. */
  private chamar(linha: LinhaDoRegistro, dados: EnviarRenaveInput, cnpj: string): Promise<RespostaDoRenave> {
    const snap = linha.snapshot as {
      veiculo?: { placa?: string | null; chassi?: string | null };
      vendedor?: { documento?: string | null };
      comprador?: { nome: string; cpf: string; email: string | null } | null;
      hodometro?: { km: number; medidoEm: string };
    };
    const base = {
      chaveDeIdempotencia: `${linha.vehicleId}:${linha.tipo}:${linha.sequencia}`,
      cnpjDaLoja: cnpj,
      veiculo: {
        placa: snap.veiculo?.placa ?? '',
        chassi: snap.veiculo?.chassi ?? null,
        renavam: dados.crv.renavam,
        tipoCrv: dados.crv.tipoCrv,
        numeroCrv: dados.crv.numeroCrv ?? null,
        codigoSegurancaCrv: dados.crv.codigoSegurancaCrv,
      },
      dataOperacao: linha.dataOperacao,
      valor: linha.valor?.toFixed(2) ?? null,
    };

    if (ehEntrada(linha.tipo)) {
      const documento = snap.vendedor?.documento ?? null;
      const tipoDoc = tipoDoDocumento(documento);
      return this.provedor.registrarEntrada({
        ...base,
        tipo: linha.tipo as PedidoDeEntradaRenave['tipo'],
        quilometragem: snap.hodometro?.km ?? 0,
        medidoEm: new Date(snap.hodometro?.medidoEm ?? linha.dataOperacao),
        proprietario: documento && tipoDoc ? { tipoDocumento: tipoDoc, documento } : null,
      });
    }

    const c = snap.comprador ?? null;
    return this.provedor.registrarSaida({
      ...base,
      tipo: linha.tipo as PedidoDeSaidaRenave['tipo'],
      comprador: c ? { tipoDocumento: 'CPF', documento: c.cpf, nome: c.nome, email: c.email } : null,
    });
  }

  /**
   * A resposta síncrona (envio, consulta, cancelamento) vira estado pela
   * mesma regra do webhook, e fica registrada em `renave_eventos`.
   */
  private async aplicarResposta(tenantId: string, id: string, r: RespostaDoRenave) {
    const tipo: TipoDeEventoRenave = r.status === 'pendente' ? 'ignorado' : r.status;
    const corpo = JSON.stringify(r);
    await this.prisma.withTenant(tenantId, async (tx: ScopedClient) => {
      await tx.renaveRegistro.updateMany({
        where: { id, tenantId, externalId: null },
        data: { externalId: r.idExterno },
      });
      return this.aplicarEvento(tx, tenantId, id, {
        idExterno: r.idExterno,
        idEvento: `resposta:${sha256Hex(Buffer.from(corpo))}`,
        tipo,
        protocolo: r.protocolo ?? null,
        motivo: r.motivo ?? null,
        ocorridoEm: r.ocorridoEm ?? new Date(),
      }, corpo);
    });

    if (tipo === 'confirmado') await this.guardarAtpv(tenantId, id);
    return this.ler(tenantId, id);
  }

  /**
   * Grava o evento (idempotente por `(registro, event_key)`) e aplica a
   * transição, se a máquina de estados a aceitar. Repetido ou fora de ordem
   * fica registrado com `aplicado = false` — a trilha mostra que chegou.
   */
  private async aplicarEvento(
    tx: ScopedClient, tenantId: string, registroId: string, evento: EventoDoRenave, corpoCru: string,
  ): Promise<ResultadoDoWebhookRenave> {
    const atual = await tx.renaveRegistro.findFirst({
      where: { id: registroId, tenantId }, select: { status: true },
    });
    if (!atual) throw new NotFoundException('Registro RENAVE não encontrado.');

    const novo = statusDepoisDoEvento(atual.status, evento.tipo);
    const chave = evento.idEvento ?? sha256Hex(Buffer.from(corpoCru));

    try {
      await tx.renaveEvento.create({
        data: {
          tenantId, registroId, provider: this.provedor.nome, eventKey: chave,
          tipo: evento.tipo, aplicado: novo !== null,
          normalizado: { ...evento, ocorridoEm: evento.ocorridoEm.toISOString() } as Prisma.InputJsonValue,
          corpoCru,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { recebido: true, aplicado: false, motivo: 'repetido' };
      }
      throw e;
    }

    if (!novo) {
      return { recebido: true, aplicado: false, motivo: evento.tipo === 'ignorado' ? 'ignorado' : 'fora-de-ordem' };
    }

    await tx.renaveRegistro.update({
      where: { id: registroId },
      data:
        novo === 'confirmado'
          ? { status: 'confirmado', protocolo: evento.protocolo ?? evento.idExterno, registradoEm: evento.ocorridoEm }
          : novo === 'recusado'
            ? { status: 'recusado', motivoRecusa: evento.motivo ?? 'Recusado pela integradora, sem motivo informado.' }
            : {
                status: 'cancelado', canceladoEm: evento.ocorridoEm,
                motivoCancelamento: evento.motivo ?? 'Cancelado na integradora.',
                protocoloCancelamento: evento.protocolo ?? null,
              },
    });
    return { recebido: true, aplicado: true };
  }

  private async ler(tenantId: string, id: string) {
    const r = await this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
      tx.renaveRegistro.findFirst({ where: { id, tenantId }, select: SELECAO_DO_REGISTRO }));
    if (!r) throw new NotFoundException('Registro RENAVE não encontrado.');
    return this.renave.serializar(r);
  }

  private async exigirDaIntegradora(tenantId: string, id: string): Promise<LinhaDoRegistro> {
    const r = await this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
      tx.renaveRegistro.findFirst({ where: { id, tenantId }, select: SELECAO_DO_REGISTRO }));
    if (!r) throw new NotFoundException('Registro RENAVE não encontrado.');
    return r;
  }

  /* ── Consulta, cancelamento, NF-e ──────────────────────── */

  /** Para a integradora que não manda webhook: perguntar. */
  async atualizar(escopo: Escopo, id: string) {
    const tenantId = this.renave.tenantDe(escopo);
    const r = await this.exigirDaIntegradora(tenantId, id);
    if (!r.provider) throw new ConflictException('Registro manual: não há o que perguntar à integradora.');
    if (!r.externalId) {
      throw new ConflictException('O envio não chegou à integradora. Envie de novo.');
    }
    this.exigirProvedor();
    return this.aplicarResposta(tenantId, id, await this.provedor.consultar(r.externalId));
  }

  /**
   * Manual: só anota (R1). Da integradora: pede o cancelamento a ela primeiro
   * — se ela recusar, nada muda aqui. Envio que nunca chegou é cancelado só
   * deste lado, porque do outro não existe.
   */
  async cancelar(escopo: Escopo, id: string, dados: CancelarRenaveInput) {
    const tenantId = this.renave.tenantDe(escopo);
    const r = await this.exigirDaIntegradora(tenantId, id);
    if (!r.provider || !r.externalId) return this.renave.cancelar(escopo, id, dados, true);

    this.exigirProvedor();
    const resposta = await this.provedor.cancelar(r.externalId, dados.motivo);
    if (resposta.status !== 'cancelado') {
      // Assíncrono na integradora: o cancelamento chega pelo webhook ou pela
      // consulta, com o mesmo caminho de qualquer outro evento.
      return this.aplicarResposta(tenantId, id, resposta);
    }
    return this.renave.cancelar(escopo, id, {
      motivo: dados.motivo,
      protocoloCancelamento: dados.protocoloCancelamento ?? resposta.protocolo ?? undefined,
    }, true);
  }

  async informarNfe(escopo: Escopo, id: string, chaveNfe: string) {
    const tenantId = this.renave.tenantDe(escopo);
    const r = await this.exigirDaIntegradora(tenantId, id);
    if (r.provider) {
      if (!r.externalId || r.status !== 'confirmado') {
        throw new ConflictException('A NF-e vai à integradora depois que o registro é confirmado.');
      }
      this.exigirProvedor();
      await this.provedor.informarNotaFiscal(r.externalId, chaveNfe);
    }
    return this.renave.informarNfe(escopo, id, chaveNfe, true);
  }

  /* ── ATPV-e ─────────────────────────────────────────────── */

  /**
   * Arquiva o ATPV-e no bucket privado, quando houver. Nunca derruba quem
   * chamou: sem o arquivo guardado, o download busca na integradora.
   */
  private async guardarAtpv(tenantId: string, id: string): Promise<void> {
    try {
      const r = await this.exigirDaIntegradora(tenantId, id);
      if (!r.externalId || r.atpvKey) return;
      const pdf = await this.provedor.baixarAtpv(r.externalId);
      if (!pdf) return;
      const guardado = await this.storage.guardar(tenantId, `renave/${id}/atpv.pdf`, Buffer.from(pdf));
      if (!guardado) return;
      await this.prisma.withTenant(tenantId, (tx: ScopedClient) =>
        tx.renaveRegistro.update({ where: { id }, data: { atpvKey: guardado.chave } }));
    } catch (e) {
      this.logger.warn(`ATPV-e do registro ${id} não arquivado: ${(e as Error).message}`);
    }
  }

  /** O PDF do ATPV-e: do bucket se arquivado, senão da integradora. */
  async atpv(escopo: Escopo, id: string): Promise<Buffer> {
    const tenantId = this.renave.tenantDe(escopo);
    const r = await this.exigirDaIntegradora(tenantId, id);

    if (r.atpvKey) {
      const guardado = await this.storage.baixar(r.atpvKey);
      if (guardado) return guardado;
    }
    if (!r.externalId) throw new NotFoundException('Este registro não tem ATPV-e.');
    this.exigirProvedor();
    const pdf = await this.provedor.baixarAtpv(r.externalId);
    if (!pdf) throw new NotFoundException('O ATPV-e ainda não está disponível na integradora.');
    return Buffer.from(pdf);
  }

  /* ── Webhook ────────────────────────────────────────────── */

  async receberWebhook(cabecalhos: Cabecalhos, corpo: Buffer): Promise<ResultadoDoWebhookRenave> {
    // Lança 401 se a autenticidade não conferir — antes de qualquer acesso ao banco.
    const evento = this.provedor.interpretarWebhook(cabecalhos, corpo);
    if (evento.tipo === 'ignorado') return { recebido: true, aplicado: false, motivo: 'ignorado' };

    // ── A única leitura sem contexto de loja ──────────────────
    // O webhook chega sem usuário: tudo o que traz é o id da operação, cuja
    // autenticidade acabou de ser provada. A travessia é mínima — `id` e
    // `tenantId`, por chave única — e o resto roda sob `withTenant`.
    const alvo = await this.privilegiado.renaveRegistro.findUnique({
      where: { provider_externalId: { provider: this.provedor.nome, externalId: evento.idExterno } },
      select: { id: true, tenantId: true },
    });
    if (!alvo) {
      // 2xx: a entrega é autêntica, então a operação foi criada por outra
      // instalação com o mesmo segredo (homologação na mesma conta). 4xx faria
      // a integradora insistir para sempre.
      this.logger.warn(`Webhook RENAVE para operação desconhecida: ${evento.idExterno}`);
      return { recebido: true, aplicado: false, motivo: 'operacao-desconhecida' };
    }

    const resultado = await this.prisma.withTenant(alvo.tenantId, (tx: ScopedClient) =>
      this.aplicarEvento(tx, alvo.tenantId, alvo.id, evento, corpo.toString('utf8')));

    if (evento.tipo === 'confirmado' || evento.tipo === 'atpv_disponivel') {
      await this.guardarAtpv(alvo.tenantId, alvo.id);
    }
    return resultado;
  }

  /**
   * Só com a integradora simulada, fora de produção (404 no resto): o que o
   * Detran faria, entregue pelo caminho real do webhook.
   */
  async simular(escopo: Escopo, id: string, acao: 'confirmar' | 'recusar') {
    if (!this.simulado) throw new NotFoundException();
    const tenantId = this.renave.tenantDe(escopo);
    const r = await this.exigirDaIntegradora(tenantId, id);
    if (!r.externalId) throw new ConflictException('O envio não chegou à integradora simulada.');

    const entregas = (this.provedor as ProvedorRenaveSimulado).simular(r.externalId, acao);
    for (const e of entregas) await this.receberWebhook(e.cabecalhos, e.corpo);
    return this.ler(tenantId, id);
  }
}
