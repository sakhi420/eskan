import { ConfigService } from '@nestjs/config';
import { LoginThrottleService } from './login-throttle.service';
import { AppError } from '../common/errors/app-error';

function configStub(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  } as unknown as ConfigService;
}

const config = configStub({
  'auth.loginThrottle.ttlMs': 60_000,
  'auth.loginThrottle.limit': 3,
});

describe('LoginThrottleService', () => {
  it('allows attempts below the limit', () => {
    const svc = new LoginThrottleService(config);
    svc.recordFailure('a@b.c');
    svc.recordFailure('a@b.c');
    expect(() => svc.assertAllowed('A@B.C')).not.toThrow();
  });

  it('locks after the configured number of failures (case-insensitive email)', () => {
    const svc = new LoginThrottleService(config);
    svc.recordFailure('a@b.c');
    svc.recordFailure('a@b.c');
    svc.recordFailure('A@B.C');
    expect(() => svc.assertAllowed('a@b.c')).toThrow(AppError);
    expect(() => svc.assertAllowed('a@b.c')).toThrow(/Too many login attempts/);
  });

  it('resets the counter after a successful login', () => {
    const svc = new LoginThrottleService(config);
    svc.recordFailure('a@b.c');
    svc.recordFailure('a@b.c');
    svc.recordSuccess('a@b.c');
    expect(() => svc.assertAllowed('a@b.c')).not.toThrow();
  });
});