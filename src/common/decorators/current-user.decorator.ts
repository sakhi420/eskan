import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser, RequestWithAuth } from '../../auth/auth.types';

/**
 * Injects the authenticated user. Routes using this decorator must be guarded
 * by `JwtAuthGuard` (global) and must not be marked `@Public()`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<RequestWithAuth>().user as AuthUser,
);
