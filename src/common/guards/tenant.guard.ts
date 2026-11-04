import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { TenantService } from '../../auth/tenant.service';
import { AppError } from '../errors/app-error';
import { RequestWithAuth } from '../../auth/auth.types';

/**
 * Resolves the acting membership from the authenticated user and, optionally,
 * the `X-Organization-Id` selector header. The header is a selector only; the
 * server always verifies that the user actually has an active membership in
 * the selected organization.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly tenants: TenantService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = request.user;
    if (!user) {
      throw AppError.unauthorized();
    }

    const header = request.headers['x-organization-id'];
    const organizationId =
      typeof header === 'string' && header.length > 0 ? header : undefined;

    const membership = await this.tenants.resolveActiveMembership(user.id, organizationId);
    if (!membership) {
      throw organizationId
        ? AppError.forbidden(`No active membership in organization ${organizationId}`)
        : AppError.forbidden('No active organization membership');
    }

    request.membership = membership;
    return true;
  }
}