import { StripeService } from './stripe.service';

describe('StripeService checkout trial', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.STRIPE_PRICE_PRO = 'price_pro';
    process.env.STRIPE_PRICE_BUSINESS = 'price_business';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it.each(['PRO', 'BUSINESS'] as const)('does not grant a new Stripe trial when subscribing to %s', async (plan) => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const stripeMock = {
      customers: {
        create: jest.fn().mockResolvedValue({ id: 'cus_123' }),
      },
      checkout: {
        sessions: {
          create: jest
            .fn()
            .mockResolvedValue({ url: 'https://checkout.stripe.com/test' }),
        },
      },
    };

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'salon@example.com',
      salonName: 'Ink Lab',
      role: 'user_salon',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });

    prisma.user.update.mockResolvedValue({});

    const service = new StripeService(prisma as any);
    (service as any).stripe = stripeMock;

    const result = await service.createCheckoutSession('user-1', plan);

    expect(result).toBe('https://checkout.stripe.com/test');
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        subscription_data: {},
      }),
      expect.objectContaining({
        idempotencyKey: expect.any(String),
      }),
    );
  });
});

describe('Business account eligibility', () => {
  beforeEach(() => { process.env.STRIPE_SECRET_KEY = 'sk_test_123'; process.env.FRONTEND_URL = 'https://app.example.com'; });
  it.each(['user_tatoueur', 'client', 'admin'])('rejects %s before any Stripe call', async (role) => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', role }) } };
    const service = new StripeService(prisma as never);
    await expect(service.createCheckoutSession('u1', 'BUSINESS')).rejects.toThrow('réservé aux comptes salon');
    await expect(service.ensurePaidPlan('u1', 'BUSINESS')).rejects.toThrow('réservé aux comptes salon');
  });
});

describe('Native trial checkout continuity', () => {
  const previousEnv = { ...process.env };
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.STRIPE_PRICE_BUSINESS = 'price_business';
  });
  afterAll(() => { process.env = previousEnv; });
  it.each([3, 1, 0])('preserves only %s remaining days without restarting a trial', async days => {
    const end = new Date(Date.now() + (days || -1) * 86400000);
    const create = jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' });
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({
      id: 'u1', role: 'user_salon', email: 'salon@example.com', salonName: 'Salon', stripeCustomerId: 'cus_1', stripeSubscriptionId: null,
      saasPlanDetails: { currentPlan: 'BUSINESS', planStatus: 'TRIAL', trialEndDate: end },
    }) } };
    const service = new StripeService(prisma as never);
    (service as any).stripe = { checkout: { sessions: { create } } };
    await service.createCheckoutSession('u1', 'BUSINESS');
    const params = create.mock.calls[0][0];
    expect(params.subscription_data.trial_period_days).toBeUndefined();
    if (days === 3) expect(params.subscription_data.trial_end).toBe(Math.floor(end.getTime() / 1000));
    if (days === 1) expect(params.subscription_data).toEqual(expect.objectContaining({ billing_cycle_anchor: Math.floor(end.getTime() / 1000), proration_behavior: 'none' }));
    if (days === 0) expect(params.subscription_data).toEqual({});
  });
});
