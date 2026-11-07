jest.mock('../common/date/business-date', () => ({
  ...jest.requireActual('../common/date/business-date'),
  businessTodayForOrg: jest.fn(),
}));

import { businessTodayForOrg } from '../common/date/business-date';
import { ContractsService } from './contracts.service';
import { PrismaService } from '../database/prisma.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const businessTodayForOrgMock = businessTodayForOrg as jest.Mock;

function contractRow(overrides: Record<string, any> = {}) {
  return {
    id: 'c1', version: 1, organizationId: 'o1', hostelId: 'h1', residentId: 'r1',
    contractNumber: 'CNT-1', status: 'CLOSED', startDate: new Date('2026-11-07T00:00:00.000Z'),
    endDate: new Date('2026-11-08T00:00:00.000Z'), rentAmount: 5000, billingCycle: 'MONTHLY',
    depositAmount: null, packageId: null, packageSnapshot: null, notes: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'), updatedAt: new Date('2026-11-07T00:00:00.000Z'),
    ...overrides,
  };
}

function prismaMock() {
  const prisma: any = {
    stayContract: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    bedAssignment: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma));
  return prisma;
}

function locksMock() {
  return {
    lockHostel: jest.fn().mockResolvedValue(undefined),
    lockResident: jest.fn().mockResolvedValue(undefined),
    lockContract: jest.fn().mockResolvedValue(undefined),
    lockRoom: jest.fn(),
    lockBed: jest.fn(),
    lockForUpdate: jest.fn(),
    lockOrganization: jest.fn(),
  };
}

function makeService(prisma = prismaMock(), locks = locksMock()) {
  const svc = new ContractsService(prisma as unknown as PrismaService, {} as any, locks as any);
  return { svc, prisma, locks };
}

describe('ContractsService.checkout', () => {
  beforeEach(() => businessTodayForOrgMock.mockReset());

  it('closes on the start day with an exclusive D+1 end date and CHECKOUT endReason', async () => {
    businessTodayForOrgMock.mockResolvedValue('2026-11-07');
    const { svc, prisma } = makeService();
    prisma.stayContract.findFirst
      .mockResolvedValueOnce({ hostelId: 'h1', residentId: 'r1' })
      .mockResolvedValueOnce({ id: 'c1', status: 'ACTIVE', startDate: new Date('2026-11-07T00:00:00.000Z'), version: 1 })
      .mockResolvedValueOnce(contractRow());

    await svc.checkout('o1', 'c1');

    const updateArg = prisma.stayContract.updateMany.mock.calls[0][0];
    expect(updateArg.data.endDate.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    expect(updateArg.data.status).toBe('CLOSED');

    const assignArg = prisma.bedAssignment.updateMany.mock.calls[0][0];
    expect(assignArg.data.endReason).toBe('CHECKOUT');
    expect(assignArg.data.endDate.toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });

  it('rejects a checkout before the contract start date', async () => {
    businessTodayForOrgMock.mockResolvedValue('2026-11-06');
    const { svc, prisma } = makeService();
    prisma.stayContract.findFirst
      .mockResolvedValueOnce({ hostelId: 'h1', residentId: 'r1' })
      .mockResolvedValueOnce({ id: 'c1', status: 'ACTIVE', startDate: new Date('2026-11-07T00:00:00.000Z'), version: 1 });

    await expect(svc.checkout('o1', 'c1')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    expect(prisma.stayContract.updateMany).not.toHaveBeenCalled();
  });
});

describe('ContractsService.terminate', () => {
  it('cancels a DRAFT contract', async () => {
    const { svc, prisma } = makeService();
    prisma.stayContract.findFirst
      .mockResolvedValueOnce({ status: 'DRAFT', version: 2 })
      .mockResolvedValueOnce(contractRow({ status: 'TERMINATED' }));

    await svc.terminate('o1', 'c1');

    expect(prisma.stayContract.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'o1', status: 'DRAFT', version: 2 },
      data: { status: 'TERMINATED', version: { increment: 1 } },
    });
  });

  it('rejects terminating an ACTIVE contract', async () => {
    const { svc, prisma } = makeService();
    prisma.stayContract.findFirst.mockResolvedValueOnce({ status: 'ACTIVE', version: 2 });

    await expect(svc.terminate('o1', 'c1')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    expect(prisma.stayContract.updateMany).not.toHaveBeenCalled();
  });

  it('rejects terminating a CLOSED contract', async () => {
    const { svc, prisma } = makeService();
    prisma.stayContract.findFirst.mockResolvedValueOnce({ status: 'CLOSED', version: 2 });

    await expect(svc.terminate('o1', 'c1')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    expect(prisma.stayContract.updateMany).not.toHaveBeenCalled();
  });
});