jest.mock('../common/date/business-date', () => ({
  ...jest.requireActual('../common/date/business-date'),
  businessTodayForOrg: jest.fn(),
}));

import { businessTodayForOrg } from '../common/date/business-date';
import { AssignmentsService } from './assignments.service';
import { PrismaService } from '../database/prisma.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const businessTodayForOrgMock = businessTodayForOrg as jest.Mock;

function assignmentRow(overrides: Record<string, any> = {}) {
  return {
    id: 'a-1', version: 1, organizationId: 'o1', bedId: 'b1', residentId: 'r1', contractId: 'c1',
    status: 'ACTIVE', startDate: new Date('2026-11-07T00:00:00.000Z'), endDate: null, endReason: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'), updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  };
}

function prismaMock() {
  const prisma: any = {
    bedAssignment: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    bed: { findFirst: jest.fn().mockResolvedValue({ roomId: 'room-1', room: { hostelId: 'h1' } }) },
    stayContract: { findFirst: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma));
  return prisma;
}

function idempotencyMock(prisma: any) {
  return {
    hash: jest.fn().mockReturnValue('req-hash'),
    getReplay: jest.fn().mockResolvedValue(null),
    runAtomic: jest.fn(async (_args: any, mutate: (tx: any) => Promise<unknown>) => mutate(prisma)),
  };
}

function locksMock() {
  return {
    lockHostel: jest.fn().mockResolvedValue(undefined),
    lockRoom: jest.fn().mockResolvedValue(undefined),
    lockBed: jest.fn().mockResolvedValue(undefined),
    lockResident: jest.fn().mockResolvedValue(undefined),
    lockContract: jest.fn().mockResolvedValue(undefined),
    lockForUpdate: jest.fn(),
    lockOrganization: jest.fn(),
  };
}

function makeService(prisma = prismaMock()) {
  const svc = new AssignmentsService(
    prisma as unknown as PrismaService,
    idempotencyMock(prisma) as any,
    locksMock() as any,
  );
  return { svc, prisma };
}

describe('AssignmentsService.end', () => {
  beforeEach(() => businessTodayForOrgMock.mockReset());

  it('persists an exclusive end date (D+1) with MANUAL_END, allowing same-day end', async () => {
    businessTodayForOrgMock.mockResolvedValue('2026-11-07');
    const { svc, prisma } = makeService();
    prisma.bedAssignment.findFirst
      .mockResolvedValueOnce(assignmentRow())
      .mockResolvedValueOnce(assignmentRow())
      .mockResolvedValueOnce(
        assignmentRow({ status: 'ENDED', endDate: new Date('2026-11-08T00:00:00.000Z'), endReason: 'MANUAL_END' }),
      );

    await svc.end('o1', 'a-1', 'u-1', 'idem-1');

    expect(prisma.bedAssignment.updateMany).toHaveBeenCalledTimes(1);
    const arg = prisma.bedAssignment.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'a-1', organizationId: 'o1', status: 'ACTIVE', version: 1 });
    expect(arg.data.endReason).toBe('MANUAL_END');
    expect(arg.data.endDate.toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });

  it('rejects ending before the start date', async () => {
    businessTodayForOrgMock.mockResolvedValue('2026-11-06');
    const { svc, prisma } = makeService();
    prisma.bedAssignment.findFirst.mockResolvedValue(
      assignmentRow({ startDate: new Date('2026-11-07T00:00:00.000Z') }),
    );

    await expect(svc.end('o1', 'a-1', 'u-1', 'idem-1')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    expect(prisma.bedAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-ENDED assignment', async () => {
    const { svc, prisma } = makeService();
    prisma.bedAssignment.findFirst.mockResolvedValueOnce(
      assignmentRow({ status: 'ENDED', endDate: new Date('2026-11-08T00:00:00.000Z'), endReason: 'MANUAL_END' }),
    );

    await expect(svc.end('o1', 'a-1', 'u-1', 'idem-1')).resolves.toMatchObject({ id: 'a-1', status: 'ENDED' });
    expect(prisma.bedAssignment.updateMany).not.toHaveBeenCalled();
  });
});

describe('AssignmentsService.transfer', () => {
  it('ends the previous assignment exactly at transitionStart with TRANSFER reason (no +1)', async () => {
    const { svc, prisma } = makeService();
    const transition = new Date('2026-11-15T00:00:00.000Z');
    prisma.bedAssignment.findFirst.mockResolvedValueOnce(
      assignmentRow({ startDate: new Date('2026-11-01T00:00:00.000Z') }),
    );
    prisma.bed.findFirst
      .mockResolvedValueOnce({ roomId: 'room-1', room: { hostelId: 'h1' } })
      .mockResolvedValueOnce({
        roomId: 'room-1',
        status: 'ACTIVE',
        maintenanceStatus: 'OPERATIONAL',
        room: { hostelId: 'h1', status: 'ACTIVE', maintenanceStatus: 'OPERATIONAL', hostel: { status: 'ACTIVE' } },
      });
    prisma.stayContract.findFirst.mockResolvedValueOnce({
      hostelId: 'h1', status: 'ACTIVE', startDate: new Date('2026-10-01T00:00:00.000Z'), endDate: null,
    });
    prisma.bedAssignment.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.bedAssignment.findUnique.mockResolvedValueOnce(
      assignmentRow({ status: 'ENDED', endDate: transition, endReason: 'TRANSFER' }),
    );
    prisma.bedAssignment.findMany.mockResolvedValueOnce([]);
    prisma.bedAssignment.create.mockResolvedValueOnce(
      assignmentRow({ id: 'a-2', bedId: 'b2', startDate: transition }),
    );

    await svc.transfer('o1', 'a-1', 'u-1', { bedId: 'b2', startDate: '2026-11-15' } as any, 'idem-1');

    const arg = prisma.bedAssignment.updateMany.mock.calls[0][0];
    expect(arg.data.endReason).toBe('TRANSFER');
    expect(arg.data.endDate.toISOString()).toBe('2026-11-15T00:00:00.000Z');
  });
});