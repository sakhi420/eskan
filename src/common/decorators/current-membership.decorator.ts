import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { MembershipContext, RequestWithAuth } from '../../auth/auth.types';

export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): MembershipContext | undefined =>
    ctx.switchToHttp().getRequest<RequestWithAuth>().membership,
);
