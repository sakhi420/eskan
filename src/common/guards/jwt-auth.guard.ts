import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenService } from '../../auth/token.service';
import { AppError } from '../errors/app-error';
import { RequestWithAuth } from '../../auth/auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const header = request.headers['authorization'];
    if (typeof header !== 'string' || header.length === 0) {
      throw AppError.unauthorized('Missing Authorization header');
    }

    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw AppError.unauthorized('Malformed Authorization header');
    }

    try {
      const payload = await this.tokens.verifyAccessToken(token);
      request.user = {
        id: payload.sub,
        email: payload.email,
        fullName: payload.fullName,
        isPlatformAdmin: payload.isPlatformAdmin,
      };
      return true;
    } catch {
      throw AppError.unauthorized('Invalid or expired access token');
    }
  }
}
