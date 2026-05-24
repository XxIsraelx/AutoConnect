import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role: string;
    tenantId: string | null;
  };
  tenantId?: string;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService) {}

  use(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const token = auth.slice(7);
      try {
        const payload = this.jwt.verify<{
          sub: string;
          role: string;
          tenantId: string | null;
        }>(token);
        req.user = { id: payload.sub, role: payload.role, tenantId: payload.tenantId };
        if (payload.tenantId) req.tenantId = payload.tenantId;
      } catch { /* token inválido — JwtAuthGuard vai rejeitar na camada de guard */ }
    }
    next();
  }
}
