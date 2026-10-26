import { SubscriptionInvitationsService } from './subscription-invitations.service';

describe('subscription invitations', () => {
  const setup = () => {
    const prisma = {
      subscriptionInvitation: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findUnique: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      subscriptionInvitationRedemption: { update: jest.fn() },
      saasPlanDetails: { update: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) => callback(prisma),
    );
    const cache = { delPattern: jest.fn() };
    const saas = {
      getPlanConfiguration: jest.fn().mockReturnValue({ maxClients: -1 }),
    };
    const service = new SubscriptionInvitationsService(
      prisma as never,
      cache as never,
      saas as never,
    );
    return { service, prisma, cache };
  };

  it('creates a default one-year invitation and stores only the token hash', async () => {
    const { service, prisma } = setup();
    const previousUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://app.example.com';
    try {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.subscriptionInvitation.create.mockResolvedValue({
        id: 'invite-1',
      });
      const result = await service.create(
        { email: 'Invited@Example.com', role: 'user_salon', plan: 'BUSINESS' },
        'admin-1',
      );
      const token = new URL(result.url).searchParams.get('token');
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(prisma.subscriptionInvitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'invited@example.com',
            durationMonths: 12,
            createdById: 'admin-1',
            tokenHash: expect.any(String),
          }),
        }),
      );
      expect(
        prisma.subscriptionInvitation.create.mock.calls[0][0].data.tokenHash,
      ).not.toBe(token);
    } finally {
      if (previousUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previousUrl;
    }
  });

  it('rejects Business for independent artists', async () => {
    const { service, prisma } = setup();
    await expect(
      service.create(
        { email: 'a@example.com', role: 'user_tatoueur', plan: 'BUSINESS' },
        'admin',
      ),
    ).rejects.toThrow();
    expect(prisma.subscriptionInvitation.create).not.toHaveBeenCalled();
  });

  it('creates an invitation with no imposed role or plan', async () => {
    const { service, prisma } = setup();
    const previous = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://app.example.com';
    try {
      await service.create({ maxUses: 5 }, 'admin');
      expect(prisma.subscriptionInvitation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: null, plan: null, email: null, maxUses: 5 }) }));
    } finally { if (previous === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = previous; }
  });

  it('keeps flexible personal invitations limited to one account', async () => {
    const { service, prisma } = setup();
    await expect(service.create({ email: 'personal@example.com', maxUses: 5 }, 'admin')).rejects.toThrow();
    expect(prisma.subscriptionInvitation.create).not.toHaveBeenCalled();
  });

  it('creates a shared link without an email with five places and a configurable validity', async () => {
    const { service, prisma } = setup();
    const previous = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://app.example.com';
    try {
      await service.create(
        {
          role: 'user_tatoueur',
          plan: 'PRO',
          maxUses: 5,
          validityDays: 60,
          durationMonths: 6,
        },
        'admin',
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.subscriptionInvitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: null,
            maxUses: 5,
            durationMonths: 6,
          }),
        }),
      );
      const expiresAt = prisma.subscriptionInvitation.create.mock.calls[0][0]
        .data.expiresAt as Date;
      expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(59 * 86400000);
    } finally {
      if (previous === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previous;
    }
  });

  it('rejects multiple registrations on a personal invitation', async () => {
    const { service, prisma } = setup();
    await expect(
      service.create(
        {
          email: 'invited@example.com',
          role: 'user_salon',
          plan: 'BUSINESS',
          maxUses: 5,
        },
        'admin',
      ),
    ).rejects.toThrow();
    expect(prisma.subscriptionInvitation.create).not.toHaveBeenCalled();
  });

  it('rejects lowering a quota below its consumed places', async () => {
    const { service, prisma } = setup();
    prisma.subscriptionInvitation.updateMany.mockResolvedValue({ count: 1 });
    prisma.subscriptionInvitation.findUniqueOrThrow.mockResolvedValue({
      email: null,
      useCount: 5,
      maxUses: 5,
      redemptions: [],
    });
    await expect(service.update('i1', { maxUses: 4 })).rejects.toThrow();
    expect(prisma.subscriptionInvitation.update).not.toHaveBeenCalled();
  });

  it('allows adding places and extending link validity without altering existing offers', async () => {
    const { service, prisma } = setup();
    prisma.subscriptionInvitation.updateMany.mockResolvedValue({ count: 1 });
    prisma.subscriptionInvitation.findUniqueOrThrow.mockResolvedValue({
      email: null,
      useCount: 5,
      maxUses: 5,
      redemptions: [],
    });
    await service.update('i1', {
      maxUses: 10,
      expiresAt: '2027-12-31T23:59:59Z',
    });
    expect(prisma.subscriptionInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { maxUses: 10, expiresAt: new Date('2027-12-31T23:59:59Z') },
      }),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('can revoke a partly used link without revoking existing grants', async () => {
    const { service, prisma } = setup();
    prisma.subscriptionInvitation.updateMany.mockResolvedValue({ count: 1 });
    await service.revoke('i1');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.saasPlanDetails.update).not.toHaveBeenCalled();
  });

  it('changes the offer end date from its original activation and restores an expired offer', async () => {
    const { service, prisma, cache } = setup();
    prisma.subscriptionInvitation.updateMany.mockResolvedValue({ count: 1 });
    prisma.subscriptionInvitation.findUniqueOrThrow.mockResolvedValue({
      id: 'i1',
      email: null,
      maxUses: 5,
      useCount: 1,
      plan: 'PRO',
      redemptions: [
        {
          id: 'r1', plan: 'PRO',
          redeemedAt: new Date('2026-01-31T10:00:00Z'),
          user: {
            id: 'u1',
            stripeSubscriptionId: null,
            saasPlanDetails: {
              currentPlan: 'FREE',
              paymentMethod: 'INVITATION',
            },
          },
        },
      ],
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'u1',
      stripeSubscriptionId: null,
      saasPlanDetails: { currentPlan: 'FREE', paymentMethod: 'INVITATION' },
    });
    await service.updateDuration('i1', 120);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        saasPlan: 'PRO',
        saasPlanUntil: new Date('2036-01-31T10:00:00Z'),
      },
    });
    expect(prisma.saasPlanDetails.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentPlan: 'PRO',
          monthlyPrice: 0,
          nextPaymentDate: null,
          planStatus: 'ACTIVE',
        }),
      }),
    );
    expect(cache.delPattern).toHaveBeenCalledWith('admin:*');
  });

  it('does not modify a subscription managed by Stripe', async () => {
    const { service, prisma } = setup();
    prisma.subscriptionInvitation.updateMany.mockResolvedValue({ count: 1 });
    prisma.subscriptionInvitation.findUniqueOrThrow.mockResolvedValue({
      id: 'i1',
      email: null,
      maxUses: 5,
      useCount: 1,
      plan: 'PRO',
      redemptions: [
        {
          id: 'r1',
          redeemedAt: new Date(),
          user: {
            id: 'u1',
            stripeSubscriptionId: 'sub_1',
            saasPlanDetails: { paymentMethod: 'INVITATION' },
          },
        },
      ],
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'u1',
      stripeSubscriptionId: 'sub_1',
      saasPlanDetails: { paymentMethod: 'INVITATION' },
    });
    await service.updateDuration('i1', 12);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('updates every eligible beneficiary while preserving paid accounts', async () => {
    const { service, prisma } = setup();
    prisma.subscriptionInvitation.updateMany.mockResolvedValue({ count: 1 });
    prisma.subscriptionInvitation.findUniqueOrThrow.mockResolvedValue({
      email: null, useCount: 3, maxUses: 5, plan: 'PRO',
      redemptions: ['u1', 'u2', 'paid'].map(id => ({ id: `r-${id}`, plan: id === 'u2' ? 'BUSINESS' : 'PRO', redeemedAt: new Date('2026-01-31T10:00:00Z'),
        user: { id, stripeSubscriptionId: id === 'paid' ? 'sub_1' : null, saasPlanDetails: { paymentMethod: 'INVITATION' } },
      })),
    });
    await service.update('i1', { durationMonths: 120 });
    expect(prisma.user.update).toHaveBeenCalledTimes(2);
    expect(prisma.subscriptionInvitationRedemption.update).toHaveBeenCalledTimes(2);
    expect(prisma.subscriptionInvitationRedemption.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r-paid' } }));
  });

  it('rejects revocation of an unknown or already revoked invitation', async () => {
    const { service, prisma } = setup();
    prisma.subscriptionInvitation.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.revoke('i1')).rejects.toThrow();
    expect(prisma.subscriptionInvitation.updateMany).toHaveBeenCalledWith({
      where: { id: 'i1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
