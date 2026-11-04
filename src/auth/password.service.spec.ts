import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with Argon2id and verifies the correct password', async () => {
    const hash = await service.hash('S3cret!pass');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(service.verify(hash, 'S3cret!pass')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hash('correct-horse');
    await expect(service.verify(hash, 'wrong-horse')).resolves.toBe(false);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    await expect(service.verify('not-a-valid-hash', 'anything')).resolves.toBe(false);
  });
});