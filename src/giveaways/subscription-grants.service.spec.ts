import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, SaasPlan, SaasPlanStatus } from '@prisma/client';
import { SaasService } from '../saas/saas.service';
import { planAppGrant, SubscriptionGrantsService } from './subscription-grants.service';

const NOW = new Date('2027-01-20T10:00:00Z');
const months = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};

describe('planAppGrant (no Stripe subscription)', () => {
  it('free account: starts at activation, 12 calendar months', () => {
    const p = planAppGrant(null, SaasPlan.PRO, 12, NOW);
    expect(p).toMatchObject({ startsAt: NOW, deferred: false });
    expect(p.endsAt.toISOString()).toBe('2028-01-20T10:00:00.000Z');
    const expired = planAppGrant({ plan: SaasPlan.PRO, planStatus: SaasPlanStatus.EXPIRED, endDate: new Date('2026-01-01'), trialEndDate: null, paymentMethod: 'ADMIN_GIFT' }, SaasPlan.PRO, 12, NOW);
    expect(expired.startsAt).toEqual(NOW);
  });

  it('native trial, invitation, admin gift or other giveaway on the same plan: chained, no day lost', () => {
    const trialEnd = new Date('2027-03-01T00:00:00Z');
    const trial = planAppGrant({ plan: SaasPlan.PRO, planStatus: SaasPlanStatus.TRIAL, endDate: new Date('2027-12-31'), trialEndDate: trialEnd, paymentMethod: null }, SaasPlan.PRO, 12, NOW);
    expect(trial).toMatchObject({ startsAt: trialEnd, deferred: true });
    expect(trial.endsAt).toEqual(months(trialEnd, 12));
    for (const paymentMethod of ['INVITATION', 'ADMIN_GIFT', 'GIVEAWAY']) {
      const end = new Date('2027-06-01T00:00:00Z');
      const p = planAppGrant({ plan: SaasPlan.PRO, planStatus: SaasPlanStatus.ACTIVE, endDate: end, trialEndDate: null, paymentMethod }, SaasPlan.PRO, 12, NOW);
      expect(p).toMatchObject({ startsAt: end, endsAt: months(end, 12), deferred: true });
    }
  });

  it('lower plan running: upgrade now, unless the lower plan outlasts the prize', () => {
    const short = planAppGrant({ plan: SaasPlan.PRO, planStatus: SaasPlanStatus.ACTIVE, endDate: new Date('2027-05-01'), trialEndDate: null, paymentMethod: 'INVITATION' }, SaasPlan.BUSINESS, 12, NOW);
    expect(short).toMatchObject({ plan: SaasPlan.BUSINESS, startsAt: NOW });
    expect(() => planAppGrant({ plan: SaasPlan.PRO, planStatus: SaasPlanStatus.ACTIVE, endDate: new Date('2029-05-01'), trialEndDate: null, paymentMethod: 'INVITATION' }, SaasPlan.BUSINESS, 12, NOW)).toThrow(ConflictException);
  });

  it('refuses higher plan running, unknown origins, open-ended paid plans and FREE prizes', () => {
    expect(() => planAppGrant({ plan: SaasPlan.BUSINESS, planStatus: SaasPlanStatus.ACTIVE, endDate: new Date('2027-05-01'), trialEndDate: null, paymentMethod: 'ADMIN_GIFT' }, SaasPlan.PRO, 12, NOW)).toThrow(ConflictException);
    expect(() => planAppGrant({ plan: SaasPlan.PRO, planStatus: SaasPlanStatus.ACTIVE, endDate: new Date('2027-05-01'), trialEndDate: null, paymentMethod: 'STRIPE' }, SaasPlan.PRO, 12, NOW)).toThrow(/inconnue/);
    expect(() => planAppGrant({ plan: SaasPlan.PRO, planStatus: SaasPlanStatus.ACTIVE, endDate: null, trialEndDate: null, paymentMethod: 'STRIPE' }, SaasPlan.PRO, 12, NOW)).toThrow(/sans date de fin/);
    expect(() => planAppGrant(null, SaasPlan.FREE, 12, NOW)).toThrow();
    expect(() => planAppGrant(null, SaasPlan.PRO, 0, NOW)).toThrow();
  });
});

describe('SubscriptionGrantsService', () => {
  const saas = new SaasService({} as never);
  const cache = { delPattern: jest.fn().mockResolvedValue(undefined) };
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.clearAllMocks();
  });

  function setup(user: Record<string, unknown>) {
    const state = { user: { ...user } as any, details: (user.saasPlanDetails as any) ?? null, grants: [] as any[] };
    const db: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (cb: any) => cb(db)),
      user: {
        findUnique: jest.fn(async () => ({ ...state.user, saasPlanDetails: state.details })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.stripeSubscriptionId === null && state.user.stripeSubscriptionId) return { count: 0 };
          Object.assign(state.user, data);
          return { count: 1 };
        }),
        update: jest.fn(async ({ data }: any) => Object.assign(state.user, data)),
      },
      saasPlanDetails: {
        upsert: jest.fn(async ({ update, create }: any) => (state.details = state.details ? { ...state.details, ...update } : create)),
        update: jest.fn(async ({ data }: any) => (state.details = { ...state.details, ...data })),
      },
      subscriptionGrant: {
        findUnique: jest.fn(async ({ where }: any) => state.grants.find((g) => (where.id ? g.id === where.id : g.idempotencyKey === where.idempotencyKey)) ?? null),
        create: jest.fn(async ({ data }: any) => {
          if (state.grants.some((g) => g.idempotencyKey === data.idempotencyKey))
            throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
          const g = { id: `g${state.grants.length + 1}`, status: 'ACTIVE', ...data };
          state.grants.push(g);
          return g;
        }),
        update: jest.fn(async ({ where, data }: any) => Object.assign(state.grants.find((g) => g.id === where.id), data)),
      },
    };
    const stripe = {
      previewAdminGift: jest.fn(async () => ({ currentPlan: 'PRO', startDate: '2027-02-10T00:00:00.000Z', endDate: '2028-02-10T00:00:00.000Z', amount: 3599, currency: 'eur', interval: 'month', intervalCount: 1, confirmation: 'c'.repeat(64), requestId: '11111111-1111-1111-1111-111111111111' })),
      applyAdminGift: jest.fn(async () => ({ currentPlan: 'PRO', startDate: new Date('2027-02-10T00:00:00Z'), endDate: new Date('2028-02-10T00:00:00Z'), autoResume: true })),
    };
    const service = new SubscriptionGrantsService(db, saas, cache as never, stripe as never);
    jest.spyOn(saas, 'markStripeGift').mockResolvedValue({} as never);
    return { service, state, db, stripe };
  }

  const input = { userId: 'u1', plan: SaasPlan.PRO, durationMonths: 12, source: 'giveaway:inkera-2026-2027', actorId: 'admin', idempotencyKey: 'giveaway-award:a1', awardId: 'a1' };

  it('free account: app entitlement, no Stripe call, no charge, idempotent replay', async () => {
    const { service, state, stripe } = setup({ id: 'u1', role: 'user_tatoueur', saasPlan: 'FREE', stripeSubscriptionId: null });
    const first = await service.apply(input, NOW);
    expect(first.created).toBe(true);
    expect(first.grant).toMatchObject({ mode: 'APP_ENTITLEMENT', plan: 'PRO', startsAt: NOW });
    expect(state.user).toMatchObject({ saasPlan: 'PRO' });
    expect(state.details).toMatchObject({ paymentMethod: 'GIVEAWAY', monthlyPrice: 0, nextPaymentDate: null, planStatus: 'ACTIVE' });
    const replay = await service.apply(input, NOW);
    expect(replay).toEqual({ grant: first.grant, created: false });
    expect(state.grants).toHaveLength(1);
    expect(stripe.applyAdminGift).not.toHaveBeenCalled();
    expect(stripe.previewAdminGift).not.toHaveBeenCalled();
  });

  it('refuses BUSINESS for a non-salon account', async () => {
    const { service } = setup({ id: 'u1', role: 'user_tatoueur', saasPlan: 'FREE', stripeSubscriptionId: null });
    await expect(service.apply({ ...input, plan: SaasPlan.BUSINESS }, NOW)).rejects.toThrow(/Business/);
  });

  it('Stripe subscriber: refused while GIVEAWAY_STRIPE_GRANTS is off (default)', async () => {
    delete process.env.GIVEAWAY_STRIPE_GRANTS;
    const { service, stripe } = setup({ id: 'u1', role: 'user_tatoueur', saasPlan: 'PRO', stripeSubscriptionId: 'sub_1', saasPlanDetails: { currentPlan: 'PRO', paymentMethod: 'STRIPE' } });
    await expect(service.apply({ ...input, confirmation: 'c'.repeat(64), requestId: '1'.repeat(36) }, NOW)).rejects.toThrow(ForbiddenException);
    expect(stripe.applyAdminGift).not.toHaveBeenCalled();
  });

  it('test mode only works with a test key', () => {
    expect(SubscriptionGrantsService.stripeWritesAllowed({ GIVEAWAY_STRIPE_GRANTS: 'test', STRIPE_SECRET_KEY: 'sk_live_x' })).toBe(false);
    expect(SubscriptionGrantsService.stripeWritesAllowed({ GIVEAWAY_STRIPE_GRANTS: 'test', STRIPE_SECRET_KEY: 'sk_test_x' })).toBe(true);
    expect(SubscriptionGrantsService.stripeWritesAllowed({ STRIPE_SECRET_KEY: 'sk_test_x' })).toBe(false);
  });

  it('Stripe subscriber (allowed): keeps the paid period, defers via the confirmed admin-gift mechanism', async () => {
    process.env.GIVEAWAY_STRIPE_GRANTS = 'test';
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    const { service, stripe } = setup({ id: 'u1', role: 'user_tatoueur', saasPlan: 'PRO', stripeSubscriptionId: 'sub_1', saasPlanDetails: { currentPlan: 'PRO', paymentMethod: 'STRIPE', endDate: null } });
    const preview = await service.preview('u1', SaasPlan.PRO, 12, NOW);
    expect(preview).toMatchObject({ mode: 'STRIPE_TRIAL_EXTENSION', deferred: true });
    await expect(service.apply(input, NOW)).rejects.toThrow(/confirmation/);
    const { grant } = await service.apply({ ...input, confirmation: 'c'.repeat(64), requestId: '11111111-1111-1111-1111-111111111111' }, NOW);
    expect(stripe.applyAdminGift).toHaveBeenCalledWith('u1', 12, 'MONTHS', 'c'.repeat(64), '11111111-1111-1111-1111-111111111111', 'admin', 'giveaway:inkera-2026-2027');
    expect(saas.markStripeGift).toHaveBeenCalled();
    expect(grant).toMatchObject({ mode: 'STRIPE_TRIAL_EXTENSION', startsAt: new Date('2027-02-10T00:00:00Z'), stripeSubscriptionId: 'sub_1' });
  });

  it('refuses when a Stripe gift is already scheduled (no overlap)', async () => {
    const { service } = setup({ id: 'u1', role: 'user_tatoueur', saasPlan: 'PRO', stripeSubscriptionId: 'sub_1', saasPlanDetails: { currentPlan: 'PRO', paymentMethod: 'STRIPE_GIFT' } });
    await expect(service.preview('u1', SaasPlan.PRO, 12, NOW)).rejects.toThrow(ConflictException);
  });

  it('a Stripe subscription appearing during activation aborts the app grant (no double billing)', async () => {
    const { service, db, state } = setup({ id: 'u1', role: 'user_tatoueur', saasPlan: 'FREE', stripeSubscriptionId: null });
    db.user.findUnique.mockImplementationOnce(async () => ({ ...state.user, saasPlanDetails: null }));
    db.user.findUnique.mockImplementationOnce(async () => ({ ...state.user, stripeSubscriptionId: 'sub_new', saasPlanDetails: null }));
    await expect(service.apply(input, NOW)).rejects.toThrow(ConflictException);
    expect(state.grants).toHaveLength(0);
  });

  it('cancel reverts only an entitlement still set by this grant, and restores a chained one', async () => {
    const end = new Date('2027-06-01T00:00:00Z');
    const { service, state } = setup({ id: 'u1', role: 'user_tatoueur', saasPlan: 'PRO', stripeSubscriptionId: null, saasPlanDetails: { currentPlan: 'PRO', planStatus: 'ACTIVE', endDate: end, trialEndDate: null, paymentMethod: 'INVITATION' } });
    const { grant } = await service.apply(input, NOW);
    expect(grant.startsAt).toEqual(end);
    const res = await service.cancel(grant.id, 'admin', 'Erreur de saisie du gagnant', NOW);
    expect(res.entitlementReverted).toBe(true);
    expect(state.details).toMatchObject({ currentPlan: 'PRO', endDate: end, paymentMethod: 'INVITATION' });
    expect(res.grant.status).toBe('CANCELLED');
  });

  it('effective status is derived from dates', () => {
    const g = { status: 'ACTIVE' as const, startsAt: new Date('2027-02-01'), endsAt: new Date('2028-02-01') };
    expect(SubscriptionGrantsService.effectiveStatus(g, NOW)).toBe('SCHEDULED');
    expect(SubscriptionGrantsService.effectiveStatus(g, new Date('2027-06-01'))).toBe('ACTIVE');
    expect(SubscriptionGrantsService.effectiveStatus(g, new Date('2028-02-02'))).toBe('EXPIRED');
  });
});
