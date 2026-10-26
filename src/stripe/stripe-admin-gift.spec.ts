import { StripeService } from './stripe.service';

describe('Stripe gifts with automatic billing resumption', () => {
  const originalEnv = { ...process.env };
  const paidEnd = Math.floor(new Date('2026-01-12T10:00:00Z').getTime() / 1000);
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit_key';
    process.env.STRIPE_PRICE_BUSINESS = 'price_business';
    process.env.STRIPE_PRICE_PRO = 'price_pro';
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T10:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...originalEnv };
  });

  const setup = () => {
    let subscription: any = {
      id: 'sub_1',
      status: 'active',
      trial_end: null,
      metadata: {},
      billing_mode: { type: 'classic' },
      cancel_at_period_end: false,
      cancel_at: null,
      pause_collection: null,
      pending_update: null,
      schedule: null,
      collection_method: 'charge_automatically',
      latest_invoice: { status: 'paid' },
      items: {
        data: [
          {
            id: 'si_1',
            current_period_end: paidEnd,
            quantity: 1,
            price: {
              id: 'price_business',
              unit_amount: 5900,
              currency: 'eur',
              recurring: {
                interval: 'month',
                interval_count: 1,
                usage_type: 'licensed',
              },
            },
          },
        ],
      },
    };
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: 'u1',
            role: 'user_salon',
            stripeSubscriptionId: 'sub_1',
          }),
      },
    };
    const update = jest
      .fn()
      .mockImplementation(async (_id: string, params: any) => {
        subscription = {
          ...subscription,
          status: 'trialing',
          trial_end: params.trial_end,
          metadata: { ...subscription.metadata, ...params.metadata },
        };
        return subscription;
      });
    const retrieve = jest.fn().mockImplementation(async () => subscription);
    const service = new StripeService(prisma as never);
    (service as any).stripe = { subscriptions: { retrieve, update } };
    return {
      service,
      update,
      retrieve,
      get subscription() {
        return subscription;
      },
    };
  };

  it('previews the paid period, gift dates and original price without a Stripe mutation', async () => {
    const { service, update } = setup();
    const preview = await service.previewAdminGift('u1', 3, 'MONTHS');
    expect(preview).toMatchObject({
      startDate: '2026-01-12T10:00:00.000Z',
      endDate: '2026-04-12T10:00:00.000Z',
      amount: 5900,
      currency: 'eur',
      interval: 'month',
      currentPlan: 'BUSINESS',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('defers the next charge without proration or modifying the price and payment method', async () => {
    const { service, update } = setup();
    const preview = await service.previewAdminGift('u1', 3, 'MONTHS');
    await service.applyAdminGift(
      'u1',
      3,
      'MONTHS',
      preview.confirmation,
      preview.requestId,
      'admin1',
    );
    const params = update.mock.calls[0][1];
    expect(params).toMatchObject({
      trial_end: Math.floor(new Date(preview.endDate).getTime() / 1000),
      proration_behavior: 'none',
      metadata: { inkera_admin_gift: '1', inkera_gift_admin: 'admin1' },
    });
    expect(params).not.toHaveProperty('items');
    expect(params).not.toHaveProperty('default_payment_method');
    expect(params).not.toHaveProperty('cancel_at_period_end');
    expect(update.mock.calls[0][2]).toEqual({
      idempotencyKey: `admin-gift:u1:${preview.requestId}`,
    });
  });

  it('does not add another free period on retry', async () => {
    const { service, update } = setup();
    const preview = await service.previewAdminGift('u1', 3, 'MONTHS');
    await service.applyAdminGift(
      'u1',
      3,
      'MONTHS',
      preview.confirmation,
      preview.requestId,
      'admin1',
    );
    const retry = await service.applyAdminGift(
      'u1',
      3,
      'MONTHS',
      preview.confirmation,
      preview.requestId,
      'admin1',
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(retry.endDate.toISOString()).toBe(preview.endDate);
  });

  it('edits an existing offer from its original start instead of extending the trial again', async () => {
    const { service } = setup();
    const first = await service.previewAdminGift('u1', 3, 'MONTHS');
    await service.applyAdminGift(
      'u1',
      3,
      'MONTHS',
      first.confirmation,
      first.requestId,
      'admin1',
    );
    const changed = await service.previewAdminGift('u1', 6, 'MONTHS');
    expect(changed.startDate).toBe(first.startDate);
    expect(changed.endDate).toBe('2026-07-12T10:00:00.000Z');
  });

  it('requires a fresh confirmation when the paid period changes', async () => {
    const fixture = setup();
    const preview = await fixture.service.previewAdminGift('u1', 3, 'MONTHS');
    fixture.subscription.items.data[0].current_period_end += 86400;
    await expect(
      fixture.service.applyAdminGift(
        'u1',
        3,
        'MONTHS',
        preview.confirmation,
        preview.requestId,
        'admin1',
      ),
    ).rejects.toThrow(/changé/);
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it.each(['canceled', 'past_due', 'unpaid'])(
    'rejects an ineligible %s subscription',
    async (status) => {
      const fixture = setup();
      fixture.subscription.status = status;
      await expect(
        fixture.service.previewAdminGift('u1', 3, 'MONTHS'),
      ).rejects.toThrow();
      expect(fixture.update).not.toHaveBeenCalled();
    },
  );

  it('does not undo a customer cancellation', async () => {
    const fixture = setup();
    fixture.subscription.cancel_at_period_end = true;
    await expect(
      fixture.service.previewAdminGift('u1', 3, 'MONTHS'),
    ).rejects.toThrow();
  });

  it('respects a cancellation made after the initial grant when replaying the request', async () => {
    const fixture = setup();
    const preview = await fixture.service.previewAdminGift('u1', 3, 'MONTHS');
    await fixture.service.applyAdminGift(
      'u1',
      3,
      'MONTHS',
      preview.confirmation,
      preview.requestId,
      'admin1',
    );
    fixture.subscription.cancel_at_period_end = true;
    const retry = await fixture.service.applyAdminGift(
      'u1',
      3,
      'MONTHS',
      preview.confirmation,
      preview.requestId,
      'admin1',
    );
    expect(retry.autoResume).toBe(false);
    expect(fixture.update).toHaveBeenCalledTimes(1);
  });

  it('rejects unpaid invoices and incompatible billing modes', async () => {
    const fixture = setup();
    fixture.subscription.latest_invoice.status = 'open';
    await expect(
      fixture.service.previewAdminGift('u1', 3, 'MONTHS'),
    ).rejects.toThrow(/facture/);
    fixture.subscription.latest_invoice.status = 'paid';
    fixture.subscription.billing_mode.type = 'flexible';
    await expect(
      fixture.service.previewAdminGift('u1', 3, 'MONTHS'),
    ).rejects.toThrow();
  });

  it('enforces the Stripe trial horizon', async () => {
    await expect(
      setup().service.previewAdminGift('u1', 120, 'MONTHS'),
    ).rejects.toThrow(/730/);
  });
});
