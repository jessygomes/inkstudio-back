import { SaasPlan, SaasPlanStatus } from '@prisma/client';
import { SaasService } from './saas.service';

const createPrismaMock = () => ({
  saasPlanDetails: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
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

  it('records the first active paid plan only when the date is still empty', async () => {
    const firstPaidPlanAt = new Date('2026-10-01T10:00:00Z');
    jest.spyOn(service, 'updateUserPlan').mockResolvedValue({} as never);
    prisma.saasPlanDetails.findUniqueOrThrow.mockResolvedValue({ firstPaidPlanAt });

    const result = await service.markSubscriptionActive('user-1', SaasPlan.PRO, null, firstPaidPlanAt);

    expect(prisma.saasPlanDetails.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', firstPaidPlanAt: null },
      data: { firstPaidPlanAt },
    });
    expect(result.firstPaidPlanAt).toEqual(firstPaidPlanAt);
  });

  it('does not record a paid start date during a trial or on Free', async () => {
    jest.spyOn(service, 'updateUserPlan').mockResolvedValue({} as never);

    await service.markSubscriptionTrialing('user-1', SaasPlan.PRO, new Date());
    await service.markSubscriptionActive('user-1', SaasPlan.FREE, null);

    expect(prisma.saasPlanDetails.updateMany).not.toHaveBeenCalled();
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

  it('downgrades expired trial users without active Stripe subscription', async () => {
    prisma.saasPlanDetails.findMany.mockResolvedValue([
      {
        userId: 'user-trial-1',
        user: { stripeSubscriptionId: null },
      },
      {
        userId: 'user-trial-2',
        user: { stripeSubscriptionId: 'sub_live_123' },
      },
    ]);

    const updateSpy = jest
      .spyOn(service, 'updateUserPlan')
      .mockResolvedValue({} as never);

    const result = await service.downgradeExpiredTrialUsers();

    expect(prisma.saasPlanDetails.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          planStatus: SaasPlanStatus.TRIAL,
          currentPlan: { in: [SaasPlan.PRO, SaasPlan.BUSINESS] },
          trialEndDate: expect.objectContaining({ lte: expect.any(Date) }),
        }),
      }),
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      'user-trial-1',
      SaasPlan.FREE,
      null,
      expect.objectContaining({
        planStatus: SaasPlanStatus.EXPIRED,
        trialEndDate: null,
      }),
    );

    expect(result.scanned).toBe(2);
    expect(result.downgraded).toBe(1);
  });
});

describe('Native trial access expiry', () => {
  it.each([false, true])('expires overdue access only when not subscribed (Stripe: %s)', async subscribed => {
    const details = { userId: 'u1', currentPlan: SaasPlan.BUSINESS, planStatus: SaasPlanStatus.TRIAL, trialEndDate: new Date(Date.now()-1000), endDate: null };
    const prisma = { saasPlanDetails: { findUnique: jest.fn().mockResolvedValue(details) }, user: { findUnique: jest.fn().mockResolvedValue({ stripeSubscriptionId: subscribed ? 'sub_1' : null }) } };
    const service = new SaasService(prisma as never);
    const update = jest.spyOn(service, 'updateUserPlan').mockResolvedValue({ ...details, currentPlan: SaasPlan.FREE, planStatus: SaasPlanStatus.EXPIRED, trialEndDate: null } as never);
    const result = await service.getUserPlanDetails('u1');
    expect(update).toHaveBeenCalledTimes(subscribed ? 0 : 1);
    expect(result.currentPlan).toBe(subscribed ? SaasPlan.BUSINESS : SaasPlan.FREE);
    expect(result.hasStripeSubscription).toBe(subscribed);
  });
});
