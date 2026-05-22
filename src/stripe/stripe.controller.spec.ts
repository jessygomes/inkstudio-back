import { Test, TestingModule } from '@nestjs/testing';
import { SaasPlan } from '@prisma/client';
import { MailService } from 'src/email/mailer.service';
import { PrismaService } from 'src/database/prisma.service';
import { SaasService } from 'src/saas/saas.service';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';

const createPrismaMock = () => ({
  stripeWebhookEvent: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
});

const createStripeServiceMock = () => ({
  ensurePaidPlan: jest.fn(),
  cancelSubscription: jest.fn(),
});

const createSaasServiceMock = () => ({
  updateUserPlan: jest.fn(),
  markSubscriptionTrialing: jest.fn(),
  markSubscriptionPastDue: jest.fn(),
  markSubscriptionActive: jest.fn(),
});

const createMailServiceMock = () => ({
  sendTrialEndingSoonReminder: jest.fn(),
});

const baseUser = {
  id: 'user-1',
  email: 'salon@example.com',
  salonName: 'Ink Lab',
  firstName: 'Alice',
  lastName: 'Doe',
  saasPlan: SaasPlan.PRO,
  saasPlanUntil: null,
  stripeSubscriptionId: 'sub_123',
  stripeCustomerId: 'cus_123',
};

describe('StripeController webhook flows', () => {
  let controller: StripeController;
  let prisma: ReturnType<typeof createPrismaMock>;
  let saasService: ReturnType<typeof createSaasServiceMock>;
  let mailService: ReturnType<typeof createMailServiceMock>;
  let stripeMock: {
    webhooks: { constructEvent: jest.Mock },
    subscriptions: { retrieve: jest.Mock },
  };

  beforeEach(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit_key';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit_test';
    process.env.STRIPE_PRICE_PRO = 'price_pro';
    process.env.STRIPE_PRICE_BUSINESS = 'price_business';

    prisma = createPrismaMock();
    saasService = createSaasServiceMock();
    mailService = createMailServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeController],
      providers: [
        { provide: StripeService, useValue: createStripeServiceMock() },
        { provide: PrismaService, useValue: prisma },
        { provide: SaasService, useValue: saasService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    controller = module.get<StripeController>(StripeController);

    stripeMock = {
      webhooks: { constructEvent: jest.fn() },
      subscriptions: { retrieve: jest.fn() },
    };

    (controller as unknown as { stripe: typeof stripeMock }).stripe =
      stripeMock;

    prisma.stripeWebhookEvent.findUnique.mockResolvedValue(null);
    prisma.stripeWebhookEvent.create.mockResolvedValue({ id: 'swe_1' });

    jest.clearAllMocks();
  });

  it('sends trial ending reminder to salon on customer.subscription.trial_will_end', async () => {
    const trialEnd = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;

    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_trial',
      type: 'customer.subscription.trial_will_end',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          trial_end: trialEnd,
        },
      },
    });

    prisma.user.findFirst.mockResolvedValue(baseUser);

    const req = {
      headers: { 'stripe-signature': 'sig' },
      rawBody: Buffer.from('{}'),
    };

    const result = await controller.handleWebhook(req as never, 'sig');

    expect(result).toEqual({ received: true });
    expect(mailService.sendTrialEndingSoonReminder).toHaveBeenCalledTimes(1);
    expect(mailService.sendTrialEndingSoonReminder).toHaveBeenCalledWith(
      'salon@example.com',
      expect.objectContaining({
        recipientName: 'Alice',
        salonName: 'Ink Lab',
      }),
    );
    expect(prisma.stripeWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: 'evt_trial',
          eventType: 'customer.subscription.trial_will_end',
        }),
      }),
    );
  });

  it('marks account as past_due on invoice.payment_failed', async () => {
    const currentPeriodEnd = Math.floor(Date.now() / 1000) + 10 * 24 * 60 * 60;

    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_failed',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_1',
          subscription: 'sub_123',
          customer: 'cus_123',
        },
      },
    });

    prisma.user.findFirst.mockResolvedValue(baseUser);

    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_123',
      status: 'past_due',
      current_period_end: currentPeriodEnd,
      trial_end: null,
      items: {
        data: [{ price: { id: 'price_pro' } }],
      },
    });

    const req = {
      headers: { 'stripe-signature': 'sig' },
      rawBody: Buffer.from('{}'),
    };

    const result = await controller.handleWebhook(req as never, 'sig');

    expect(result).toEqual({ received: true });
    expect(saasService.markSubscriptionPastDue).toHaveBeenCalledTimes(1);
    expect(saasService.markSubscriptionPastDue).toHaveBeenCalledWith(
      'user-1',
      SaasPlan.PRO,
      expect.any(Date),
    );
  });

  it('returns account to active on invoice.payment_succeeded', async () => {
    const currentPeriodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_paid',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_2',
          subscription: 'sub_123',
          customer: 'cus_123',
        },
      },
    });

    prisma.user.findFirst.mockResolvedValue(baseUser);

    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      current_period_end: currentPeriodEnd,
      trial_end: null,
      items: {
        data: [{ price: { id: 'price_pro' } }],
      },
    });

    const req = {
      headers: { 'stripe-signature': 'sig' },
      rawBody: Buffer.from('{}'),
    };

    const result = await controller.handleWebhook(req as never, 'sig');

    expect(result).toEqual({ received: true });
    expect(saasService.markSubscriptionActive).toHaveBeenCalledTimes(1);
    expect(saasService.markSubscriptionActive).toHaveBeenCalledWith(
      'user-1',
      SaasPlan.PRO,
      expect.any(Date),
    );
  });

  it('ignores duplicate webhook event ids (idempotence)', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_duplicate',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_dup',
          subscription: 'sub_123',
          customer: 'cus_123',
        },
      },
    });

    prisma.stripeWebhookEvent.findUnique.mockResolvedValue({
      id: 'already_there',
    });

    const req = {
      headers: { 'stripe-signature': 'sig' },
      rawBody: Buffer.from('{}'),
    };

    const result = await controller.handleWebhook(req as never, 'sig');

    expect(result).toEqual({ received: true });
    expect(prisma.stripeWebhookEvent.create).not.toHaveBeenCalled();
    expect(saasService.markSubscriptionPastDue).not.toHaveBeenCalled();
    expect(mailService.sendTrialEndingSoonReminder).not.toHaveBeenCalled();
  });
});
