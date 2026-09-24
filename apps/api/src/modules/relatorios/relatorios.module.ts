import { Module } from '@nestjs/common';
import { RelatoriosController } from './relatorios.controller';
import { RelatoriosService } from './relatorios.service';

/**
 * Relatórios que atravessam módulos — desempenho por vendedor junta lead,
 * agendamento e negócio. Módulo próprio, e não um método em `tenants`, porque
 * o número de cada vendedor só faz sentido com os três juntos, e pendurá-lo em
 * qualquer um deles faria o outro parecer opcional.
 *
 * Sem `PrivilegedPrismaModule`: relatório é sempre de uma concessionária. Super
 * admin sem loja selecionada é recusado com uma frase, e não atendido com o
 * consolidado da plataforma — "desempenho do vendedor" não tem sentido fora de
 * uma loja.
 */
@Module({
  controllers: [RelatoriosController],
  providers: [RelatoriosService],
})
export class RelatoriosModule {}
