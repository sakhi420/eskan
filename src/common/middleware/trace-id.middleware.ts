import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response, NextFunction } from 'express';
import { RequestWithTraceId } from '../http/request.types';

@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: RequestWithTraceId, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-trace-id'];
    const traceId =
      typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
        ? incoming
        : randomUUID();
    req.traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);
    next();
  }
}