import { validate } from './configuration';

describe('configuration.validate', () => {
  it('throws when DATABASE_URL is missing', () => {
    expect(() => validate({ JWT_SECRET: 'secret' })).toThrow(/DATABASE_URL/);
  });

  it('throws when JWT_SECRET is missing', () => {
    expect(() => validate({ DATABASE_URL: 'postgresql://localhost:5432/eskan_dev' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('returns the config when required vars are present', () => {
    const config = validate({
      DATABASE_URL: 'postgresql://localhost:5432/eskan_dev',
      JWT_SECRET: 'secret',
    });
    expect(config).toHaveProperty('DATABASE_URL');
    expect(config).toHaveProperty('JWT_SECRET');
  });
});
