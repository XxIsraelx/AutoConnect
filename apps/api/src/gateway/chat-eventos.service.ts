import { Injectable, Logger, Module } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * O caminho de saída do chat, separado do gateway.
 *
 * Existe porque a mensagem do **visitante sem conta** não chega por socket: ele
 * não tem JWT, então escreve por uma rota REST pública e a página dele pergunta
 * de novo a cada poucos segundos. Sem isto, o vendedor só veria a resposta ao
 * recarregar a tela — o chat em tempo real valeria para um lado só.
 *
 * O gateway registra o servidor aqui ao subir; quem só precisa emitir depende
 * deste serviço e não do gateway (que depende do Prisma e dos negócios, e cuja
 * importação de volta fecharia um ciclo).
 */
@Injectable()
export class ChatEventosService {
  private readonly logger = new Logger(ChatEventosService.name);
  private servidor: Server | null = null;

  registrar(servidor: Server): void {
    this.servidor = servidor;
  }

  /** Emite para a sala da conversa. Sem servidor registrado, não faz nada. */
  emitir(conversationId: string, evento: string, payload: unknown): void {
    if (!this.servidor) return;
    try {
      this.servidor.to(`conversation:${conversationId}`).emit(evento, payload);
    } catch (err) {
      // Avisar o outro lado é melhor-esforço: a mensagem já está gravada, e a
      // página do visitante a busca por conta própria.
      this.logger.warn(`Falha ao emitir ${evento}: ${err}`);
    }
  }
}

@Module({
  providers: [ChatEventosService],
  exports: [ChatEventosService],
})
export class ChatEventosModule {}
