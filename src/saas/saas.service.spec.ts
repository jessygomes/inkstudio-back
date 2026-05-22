import { SaasPlan, SaasPlanStatus } from '@prisma/client';
import { SaasService } from './saas.service';

const createPrismaMock = () => ({
  saasPlanDetails: {
    findMany: jest.fn(),
  },
});

describe('SaasService billing lifecycle', () => {
  let service: SaasService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new SaasService(prisma as never);
    jest.clearAllMocks();
  });

  it('delegates markSubscriptionPastDue to updateUserPlan with expected options', async () => {
    const nextPaymentDate = new Date('2026-06-01T00:00:00.000Z');
    const pastDueSince = new Date('2026-05-22T12:00:00.000Z');

    const updateSpy = jest
      .spyOn(service, 'updateUserPlan')
      .mockResolvedValue({} as never);

    await service.markSubscriptionPastDue(
      'user-1',
      SaasPlan.PRO,
      nextPaymentDate,
      pastDueSince,
    );

    expect(updateSpy).toHaveBeenCalledWith('user-1', SaasPlan.PRO, null, {
      planStatus: SaasPlanStatus.PAST_DUE,
      nextPaymentDate,
      pastDueSince,
    });
  });

  it('downgrades users that stayed in past_due beyond grace period', async () => {
    prisma.saasPlanDetails.findMany.mockResolvedValue([
      { userId: 'user-1' },
      { userId: 'user-2' },
    ]);

    const updateSpy = jest
      .spyOn(service, 'updateUserPlan')
      .mockResolvedValue({} as never);

    const result = await service.downgradeExpiredPastDueUsers(5);

    expect(prisma.saasPlanDetails.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          planStatus: SaasPlanStatus.PAST_DUE,
          currentPlan: { in: [SaasPlan.PRO, SaasPlan.BUSINESS] },
          pastDueSince: expect.objectContaining({ lte: expect.any(Date) }),
        }),
      }),
    );

    expect(updateSpy).toHaveBeenNthCalledWith(
      1,
      'user-1',
      SaasPlan.FREE,
      null,
      expect.objectContaining({
        planStatus: SaasPlanStatus.EXPIRED,
        pastDueSince: null,
      }),
    );

    expect(updateSpy).toHaveBeenNthCalledWith(
      2,
      'user-2',
      SaasPlan.FREE,
      null,
      expect.objectContaining({
        planStatus: SaasPlanStatus.EXPIRED,
        pastDueSince: null,
      }),
    );

    expect(result.scanned).toBe(2);
    expect(result.downgraded).toBe(2);
    expect(result.gracePeriodDays).toBe(5);
  });
});
