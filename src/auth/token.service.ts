import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { JwtPayload } from './auth.types';

@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly accessTtlSeconds: number;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {
    this.secret = this.require(config.get<string>('auth.jwtSecret'), 'auth.jwtSecret');
    this.accessTtlSeconds = config.get<number>('auth.accessTtlSeconds') ?? 900;
    this.issuer = config.get<string>('auth.issuer') ?? 'eskan-api';
    this.audience = config.get<string>('auth.audience') ?? 'eskan-mobile';
    this.refreshTtlSeconds = (config.get<number>('auth.refreshTtlDays') ?? 30) * 24 * 60 * 60;
  }

  async signAccessToken(payload: JwtPayload): Promise<{ token: string; expiresIn: number }> {
    const token = await this.jwt.signAsync(payload, {
      secret: this.secret,
      expiresIn: this.accessTtlSeconds,
      issuer: this.issuer,
      audience: this.audience,
    });
    return { token, expiresIn: this.accessTtlSeconds };
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    return this.jwt.verifyAsync<JwtPayload>(token, {
      secret: this.secret,
      issuer: this.issuer,
      audience: this.audience,
    });
  }

  /** Opaque refresh token; only its SHA-256 hash is persisted. */
  generateRefreshToken(): { raw: string; hash: string } {
    const raw = randomBytes(48).toString('base64url');
    return { raw, hash: this.hashToken(raw) };
  }

  hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  refreshExpiresAt(): Date {
    return new Date(Date.now() + this.refreshTtlSeconds * 1000);
  }

  private require(value: string | undefined, key: string): string {
    if (!value) {
      throw new Error(`Missing required configuration value: ${key}`);
    }
    return value;
  }
}
