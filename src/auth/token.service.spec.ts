import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';

function configStub(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  } as unknown as ConfigService;
}

describe('TokenService', () => {
  let tokens: TokenService;

  beforeEach(() => {
    tokens = new TokenService(
      configStub({
        'auth.jwtSecret': 'test-secret',
        'auth.accessTtlSeconds': 900,
        'auth.issuer': 'eskan-api',
        'auth.audience': 'eskan-mobile',
        'auth.refreshTtlDays': 30,
      }),
      new JwtService({ secret: 'test-secret' }),
    );
  });

  it('signs then verifies an access token', async () => {
    const payload = { sub: 'u-1', email: 'a@b.c', fullName: 'Alice', isPlatformAdmin: false };
    const { token, expiresIn } = await tokens.signAccessToken(payload);
    expect(typeof token).toBe('string');
    expect(expiresIn).toBeGreaterThan(0);

    const decoded = await tokens.verifyAccessToken(token);
    expect(decoded).toMatchObject(payload);
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = new JwtService({ secret: 'other-secret' }).sign({ sub: 'u-1' });
    await expect(tokens.verifyAccessToken(forged)).rejects.toBeTruthy();
  });

  it('generates distinct opaque refresh tokens whose hash is SHA-256 hex', () => {
    const first = tokens.generateRefreshToken();
    const second = tokens.generateRefreshToken();
    expect(first.raw).not.toEqual(second.raw);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.hashToken(first.raw)).toBe(first.hash);
  });
});