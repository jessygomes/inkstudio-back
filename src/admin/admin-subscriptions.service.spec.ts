import { Logger } from '@nestjs/common';
import { validate } from 'class-validator';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { GrantSubscriptionDto } from './dto/grant-subscription.dto';

describe('admin subscription grants', () => {
  const setup = (
    role = 'user_salon',
    stripeSubscriptionId: string | null = null,
  ) => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ role, stripeSubscriptionId }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      saasPlanDetails: {
        upsert: jest
          .fn()
          .mockResolvedValue({
            currentPlan: role === 'user_salon' ? 'BUSINESS' : 'PRO',
          }),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) => callback(prisma),
    );
    const cache = { delPattern: jest.fn() };
    const saas = {
      getPlanConfiguration: jest
        .fn()
        .mockReturnValue({
          monthlyPrice: 59,
          yearlyPrice: 590,
          maxClients: 999,
        }),
    };
    return {
      prisma,
      cache,
      service: new AdminSubscriptionsService(
        prisma as never,
        saas as never,
        cache as never,
      ),
    };
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-31T10:00:00Z'));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    ['user_salon', 'BUSINESS', 'PAR_TATOUEUR'],
    ['user_tatoueur', 'PRO', 'GLOBAL'],
  ])(
    'offers the correct plan for %s and synchronizes both plan records',
    async (role, plan, agendaMode) => {
      const { service, prisma, cache } = setup(role);
      await service.grant('u1', { duration: 1, unit: 'MONTHS' }, 'admin1');
      const endDate = new Date('2026-02-28T10:00:00Z');
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', role, stripeSubscriptionId: null },
        data: { saasPlan: plan, saasPlanUntil: endDate },
      });
      expect(prisma.saasPlanDetails.upsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        update: expect.objectContaining({
          currentPlan: plan,
          startDate: new Date('2026-01-31T10:00:00Z'),
          endDate,
          planStatus: 'ACTIVE',
          paymentMethod: 'ADMIN_GIFT',
          monthlyPrice: 0,
          yearlyPrice: 0,
          trialEndDate: null,
          nextPaymentDate: null,
          pastDueSince: null,
        }),
        create: expect.objectContaining({ userId: 'u1', agendaMode }),
      });
      expect(
        prisma.saasPlanDetails.upsert.mock.calls[0][0].update,
      ).not.toHaveProperty('firstPaidPlanAt');
      expect(
        prisma.saasPlanDetails.upsert.mock.calls[0][0].update,
      ).not.toHaveProperty('agendaMode');
      expect(cache.delPattern).toHaveBeenCalledWith('admin:*');
    },
  );

  it('supports a duration in days', async () => {
    const { service, prisma } = setup();
    await service.grant('u1', { duration: 3, unit: 'DAYS' }, 'admin1');
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          saasPlanUntil: new Date('2026-02-03T10:00:00Z'),
        }),
      }),
    );
  });

  it('keeps confirmed Stripe gifts managed by Stripe and synchronizes their dates', async () => {
    const startDate = new Date('2026-02-28T10:00:00Z');
    const endDate = new Date('2026-05-28T10:00:00Z');
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ stripeSubscriptionId: 'sub_1' }) } };
    const stripe = { applyAdminGift: jest.fn().mockResolvedValue({ currentPlan: 'BUSINESS', startDate, endDate, autoResume: true }) };
    const saas = { markStripeGift: jest.fn().mockResolvedValue({ currentPlan: 'BUSINESS', endDate: null, trialEndDate: endDate }) };
    const cache = { delPattern: jest.fn() };
    const service = new AdminSubscriptionsService(prisma as never, saas as never, cache as never, stripe as never);
    const result = await service.grant('u1', { duration: 3, unit: 'MONTHS', confirmation: 'a'.repeat(64), requestId: 'bb027d00-b90c-4317-8d01-a73d9c4dff6c' }, 'admin1');
    expect(stripe.applyAdminGift).toHaveBeenCalledTimes(1);
    expect(saas.markStripeGift).toHaveBeenCalledWith('u1', 'BUSINESS', startDate, endDate, true);
    expect(result).toMatchObject({ success: true, autoResume: true });
  });

  it('blocks Stripe subscriptions before changing the local offer', async () => {
    const { service, prisma } = setup('user_salon', 'sub_live');
    await expect(
      service.grant('u1', { duration: 12, unit: 'MONTHS' }, 'admin1'),
    ).rejects.toThrow(/Stripe/);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.saasPlanDetails.upsert).not.toHaveBeenCalled();
  });

  it.each(['client', 'admin', 'user'])(
    'rejects an ineligible %s account',
    async (role) => {
      const { service, prisma } = setup(role);
      await expect(
        service.grant('u1', { duration: 12, unit: 'MONTHS' }, 'admin1'),
      ).rejects.toThrow();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects a missing account', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.grant('u1', { duration: 12, unit: 'MONTHS' }, 'admin1'),
    ).rejects.toThrow();
    expect(prisma.saasPlanDetails.upsert).not.toHaveBeenCalled();
  });

  it('rechecks the billing reference when locking the account', async () => {
    const { service, prisma } = setup();
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.grant('u1', { duration: 12, unit: 'MONTHS' }, 'admin1'),
    ).rejects.toThrow();
    expect(prisma.saasPlanDetails.upsert).not.toHaveBeenCalled();
  });

  it('limits month grants to ten years', async () => {
    const { service, prisma } = setup();
    await expect(
      service.grant('u1', { duration: 121, unit: 'MONTHS' }, 'admin1'),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { duration: 0, unit: 'DAYS' },
    { duration: -1, unit: 'MONTHS' },
    { duration: 1.5, unit: 'MONTHS' },
    { duration: 3651, unit: 'DAYS' },
    { duration: 1, unit: 'YEARS' },
  ])('validates grant input %j', async (body) => {
    expect(
      await validate(Object.assign(new GrantSubscriptionDto(), body)),
    ).not.toHaveLength(0);
  });
});
