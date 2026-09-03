import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsultasController } from './consultas.controller';
import { ConsultasService } from './consultas.service';
import { FORNECEDOR_DE_CONSULTA, fornecedorConfigurado } from './fornecedor';

@Module({
  controllers: [ConsultasController],
  providers: [
    ConsultasService,
    {
      // Camada de anticorrupção: trocar de fornecedor é trocar esta fábrica.
      // Nenhum service conhece o formato de nenhum fornecedor.
      provide: FORNECEDOR_DE_CONSULTA,
      inject: [ConfigService],
      useFactory: fornecedorConfigurado,
    },
  ],
  exports: [ConsultasService],
})
export class ConsultasModule {}
