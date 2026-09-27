import { z } from 'zod';
import { telefoneBrValido } from '../domain/telefone';

/**
 * Só fora de produção: o lead que o portal mandaria, entregue pelo mesmo
 * caminho de uma entrega real — por webhook (formato AutoConnect) ou por
 * e-mail (a notificação com "Nome:", "Telefone:", "Mensagem:").
 */
export const simularLeadDePortalSchema = z
  .object({
    via: z.enum(['webhook', 'email']),
    nome: z.string().trim().min(1).max(120),
    telefone: z.string().trim().refine(telefoneBrValido, 'Telefone inválido.'),
    mensagem: z.string().trim().max(2000).optional(),
    anuncio: z.string().trim().max(200).optional(),
  })
  .strict();
export type SimularLeadDePortalInput = z.infer<typeof simularLeadDePortalSchema>;
