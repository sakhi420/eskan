import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import { RequestWithAuth } from '../../auth/auth.types';

/**
 * Restricts a route to platform administrators (system-level role, distinct
 * from an organization OWNER). Used by `/admin/**` endpoints.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    if (!request.user?.isPlatformAdmin) {
      throw AppError.forbidden('Platform administrator privileges required');
    }
    return true;
  }
}