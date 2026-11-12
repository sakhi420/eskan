import type { Request } from 'express';

export interface RequestWithTraceId extends Request {
  traceId?: string;
}
