function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? fallback : parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanFrom(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL,
  trialDays: positiveInt(process.env.TRIAL_DAYS, 30),
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    accessTtlSeconds: positiveInt(process.env.JWT_ACCESS_TTL_SECONDS, 900),
    issuer: process.env.JWT_ISSUER ?? 'eskan-api',
    audience: process.env.JWT_AUDIENCE ?? 'eskan-mobile',
    refreshTtlDays: positiveInt(process.env.REFRESH_TTL_DAYS, 30),
    registrationEnabled: booleanFrom(process.env.REGISTRATION_ENABLED, true),
    argon2: {
      memoryCostKiB: positiveInt(process.env.ARGON2_MEMORY_KIB, 19456),
      timeCost: positiveInt(process.env.ARGON2_ITERATIONS, 2),
      parallelism: positiveInt(process.env.ARGON2_PARALLELISM, 1),
    },
    loginThrottle: {
      ttlMs: positiveInt(process.env.LOGIN_THROTTLE_TTL_MS, 60000),
      limit: positiveInt(process.env.LOGIN_THROTTLE_LIMIT, 5),
    },
  },
});

export function validate(config: Record<string, unknown>): Record<string, unknown> {
  const required = ['DATABASE_URL', 'JWT_SECRET'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return config;
}