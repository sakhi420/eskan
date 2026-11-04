import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/errors/app-error';

interface Attempt {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

/**
 * Simple in-memory login throttler keyed by normalized email. Records failed
 * attempts and locks the key after the configured threshold within the
 * configured window.
 */
@Injectable()
export class LoginThrottleService {
  private readonly attempts = new Map<string, Attempt>();

  constructor(private readonly config: ConfigService) {}

  assertAllowed(email: string): void {
    const entry = this.attempts.get(this.key(email));
    if (entry && entry.lockedUntil > Date.now()) {
      throw AppError.rateLimited('Too many login attempts; try again later');
    }
  }

  recordFailure(email: string): void {
    const now = Date.now();
    const ttl = this.int('auth.loginThrottle.ttlMs', 60_000);
    const limit = this.int('auth.loginThrottle.limit', 5);
    const key = this.key(email);

    let entry = this.attempts.get(key);
    if (!entry || entry.windowStart <= now - ttl) {
      entry = { count: 0, windowStart: now, lockedUntil: 0 };
    }
    entry.count += 1;
    if (entry.count >= limit) {
      entry.lockedUntil = now + ttl;
    }
    this.attempts.set(key, entry);
  }

  recordSuccess(email: string): void {
    this.attempts.delete(this.key(email));
  }

  private key(email: string): string {
    return email.trim().toLowerCase();
  }

  private int(path: string, fallback: number): number {
    const value = this.config.get<number>(path);
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  }
}