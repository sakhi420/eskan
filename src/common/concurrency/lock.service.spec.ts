import { LockService } from './lock.service';

describe('LockService', () => {
  let svc: LockService;
  let q: jest.Mock;

  const tx = { $queryRawUnsafe: (...args: unknown[]) => {} } as never;

  beforeEach(() => {
    svc = new LockService();
    q = jest.fn();
    (tx as { $queryRawUnsafe: unknown }).$queryRawUnsafe = q;
  });

  it('lockForUpdate scopes the lock to the organization (id + organization_id)', async () => {
    await svc.lockForUpdate(tx as never, 'resident', 'res-1', 'org-1');
    expect(q).toHaveBeenCalledTimes(1);
    expect(q).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 AND organization_id = $2 FOR UPDATE'),
      'res-1',
      'org-1',
    );
  });

  it('lockForUpdate rejects a missing organizationId', async () => {
    await expect(svc.lockForUpdate(tx as never, 'resident', 'res-1', '')).rejects.toThrow(/organizationId/);
    await expect(svc.lockForUpdate(tx as never, 'hostel', 'h-1', undefined as unknown as string)).rejects.toThrow(/organizationId/);
    expect(q).not.toHaveBeenCalled();
  });

  it('lockGlobal locks by id only (no organization filter)', async () => {
    await svc.lockGlobal(tx as never, 'organization', 'org-1');
    expect(q).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1 FOR UPDATE'), 'org-1');
  });

  it('lockGlobal never injects organization_id for global entities', async () => {
    await svc.lockGlobal(tx as never, 'user', 'u-1');
    const sql = String(q.mock.calls[0]?.[0] ?? '');
    expect(sql).not.toContain('organization_id');
  });

  it('lockOrganization serializes via an advisory lock (no row lock)', async () => {
    await svc.lockOrganization(tx as never, 'org-1');
    expect(q).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), 'org-1');
  });

  it('org-scoped helpers forward organizationId', async () => {
    await svc.lockHostel(tx as never, 'h-1', 'org-9');
    expect(q).toHaveBeenCalledWith(expect.stringContaining('FROM "hostels" WHERE id = $1 AND organization_id = $2'), 'h-1', 'org-9');
  });
});