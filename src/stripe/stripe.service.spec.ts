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

  it('creates a checkout session with a 2-month free trial', async () => {
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
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });

    prisma.user.update.mockResolvedValue({});

    const service = new StripeService(prisma as any);
    (service as any).stripe = stripeMock;

    const result = await service.createCheckoutSession('user-1', 'PRO');

    expect(result).toBe('https://checkout.stripe.com/test');
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        subscription_data: {
          trial_period_days: 60,
        },
      }),
      expect.objectContaining({
        idempotencyKey: expect.any(String),
      }),
    );
  });
});
