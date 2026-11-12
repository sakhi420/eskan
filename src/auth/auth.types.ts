import { Role } from '../generated/prisma/enums';
import { RequestWithTraceId } from '../common/http/request.types';

export interface JwtPayload {
  /** User id (subject). */
  sub: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
}

export interface MembershipContext {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  active: boolean;
}

export interface RequestWithAuth extends RequestWithTraceId {
  user?: AuthUser;
  membership?: MembershipContext;
}
