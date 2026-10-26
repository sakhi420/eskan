import { validate } from './configuration';

describe('configuration.validate', () => {
  it('throws when DATABASE_URL is missing', () => {
    expect(() => validate({})).toThrow(/DATABASE_URL/);
  });

  it('returns the config when DATABASE_URL is present', () => {
    const config = validate({ DATABASE_URL: 'postgresql://localhost:5432/eskan_dev' });
    expect(config).toHaveProperty('DATABASE_URL');
  });
});