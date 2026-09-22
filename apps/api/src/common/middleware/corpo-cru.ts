import type { IncomingMessage, ServerResponse } from 'http';

type ComCorpo = IncomingMessage & { body?: unknown; _body?: boolean };

/**
 * Entrega o corpo da requisição **cru**, como `Buffer`, em `req.body`.
 *
 * Existe para o webhook de assinatura: a autenticidade é um HMAC calculado
 * sobre os bytes exatos que o provedor enviou, e o `JSON.parse` + reserialize
 * do parser padrão muda espaços e ordem de chaves — o HMAC deixaria de bater.
 *
 * É montado só na rota do webhook, antes do parser JSON do Nest. O
 * `req._body = true` é a convenção do `body-parser` para "já lido": os parsers
 * seguintes pulam a requisição, e as demais rotas continuam com JSON normal.
 *
 * Escrito à mão, e não `express.raw()`, porque o `express` não é dependência
 * direta da API (vem pelo `@nestjs/platform-express`) e o pnpm não o resolve
 * daqui.
 */
export function corpoCru(limiteBytes: number) {
  return (req: ComCorpo, res: ServerResponse, next: (erro?: unknown) => void): void => {
    const partes: Buffer[] = [];
    let total = 0;
    let excedeu = false;

    req.on('data', (parte: Buffer) => {
      total += parte.length;
      if (total > limiteBytes) {
        // Continua drenando sem guardar: cortar o socket no meio impediria
        // a resposta 413 de chegar.
        excedeu = true;
        return;
      }
      if (!excedeu) partes.push(parte);
    });

    req.on('end', () => {
      if (excedeu) {
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ statusCode: 413, message: 'Corpo da requisição grande demais.' }));
        return;
      }
      req.body = Buffer.concat(partes);
      req._body = true;
      next();
    });

    req.on('error', next);
  };
}
