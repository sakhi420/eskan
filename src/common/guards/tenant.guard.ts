import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { TenantService } from '../../auth/tenant.service';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { MembershipContext, RequestWithAuth } from '../../auth/auth.types';

/**
 * Resolves the acting membership from the authenticated user and, optionally,
 * the `X-Organization-Id` selector header. The header is a selector only; the
 * server always verifies that the user actually has an active membership in
 * the selected organization. When a user has more than one active membership,
 * the header is mandatory (so tenants can never be silently mixed).
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
    const organizationId = typeof header === 'string' && header.length > 0 ? header : undefined;

    const memberships = await this.tenants.listActiveMemberships(user.id);
    if (memberships.length === 0) {
      throw AppError.forbidden('No active organization membership');
    }

    let membership: MembershipContext;
    if (organizationId) {
      const match = memberships.find((m) => m.organizationId === organizationId);
      if (!match) {
        throw AppError.notFound('Organization not found');
      }
      membership = match;
    } else if (memberships.length === 1) {
      membership = memberships[0];
    } else {
      throw AppError.badRequest(
        'X-Organization-Id header is required when you belong to more than one organization',
        ErrorCode.ORGANIZATION_CONTEXT_REQUIRED,
      );
    }

    request.membership = membership;
    return true;
  }
}
