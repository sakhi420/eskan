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
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma));
  return prisma;
}

function makeService(prisma = prismaMock()) {
  const svc = new AssignmentsService(prisma as unknown as PrismaService, {} as any, {} as any);
  return { svc, prisma };
}

describe('AssignmentsService.end', () => {
  beforeEach(() => businessTodayForOrgMock.mockReset());

  it('persists an exclusive end date (D+1) with MANUAL_END, allowing same-day end', async () => {
    businessTodayForOrgMock.mockResolvedValue('2026-11-07');
    const { svc, prisma } = makeService();
    prisma.bedAssignment.findFirst
      .mockResolvedValueOnce(assignmentRow())
      .mockResolvedValueOnce(
        assignmentRow({ status: 'ENDED', endDate: new Date('2026-11-08T00:00:00.000Z'), endReason: 'MANUAL_END' }),
      );

    await svc.end('o1', 'a-1');

    expect(prisma.bedAssignment.updateMany).toHaveBeenCalledTimes(1);
    const arg = prisma.bedAssignment.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'a-1', organizationId: 'o1', status: 'ACTIVE' });
    expect(arg.data.endReason).toBe('MANUAL_END');
    expect(arg.data.endDate.toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });

  it('rejects ending before the start date', async () => {
    businessTodayForOrgMock.mockResolvedValue('2026-11-06');
    const { svc, prisma } = makeService();
    prisma.bedAssignment.findFirst.mockResolvedValueOnce(
      assignmentRow({ startDate: new Date('2026-11-07T00:00:00.000Z') }),
    );

    await expect(svc.end('o1', 'a-1')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    expect(prisma.bedAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-ENDED assignment', async () => {
    const { svc, prisma } = makeService();
    prisma.bedAssignment.findFirst.mockResolvedValueOnce(
      assignmentRow({ status: 'ENDED', endDate: new Date('2026-11-08T00:00:00.000Z'), endReason: 'MANUAL_END' }),
    );

    await expect(svc.end('o1', 'a-1')).resolves.toMatchObject({ id: 'a-1', status: 'ENDED' });
    expect(prisma.bedAssignment.updateMany).not.toHaveBeenCalled();
  });
});