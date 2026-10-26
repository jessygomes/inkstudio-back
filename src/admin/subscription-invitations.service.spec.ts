import { SubscriptionInvitationsService } from './subscription-invitations.service';

describe('subscription invitations', () => {
  const setup = () => {
    const prisma = {
      subscriptionInvitation: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findUnique: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
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

  it('changes the offer end date from its original activation and restores an expired offer', async () => {
    const { service, prisma, cache } = setup();
    prisma.subscriptionInvitation.updateMany.mockResolvedValue({ count: 1 });
    prisma.subscriptionInvitation.findUniqueOrThrow.mockResolvedValue({
      id: 'i1',
      redeemedById: 'u1',
      redeemedAt: new Date('2026-01-31T10:00:00Z'),
      plan: 'PRO',
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
      redeemedById: 'u1',
      redeemedAt: new Date(),
      plan: 'PRO',
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'u1',
      stripeSubscriptionId: 'sub_1',
      saasPlanDetails: { paymentMethod: 'INVITATION' },
    });
    await expect(service.updateDuration('i1', 12)).rejects.toThrow();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('only revokes invitations that have not been redeemed', async () => {
    const { service, prisma } = setup();
    prisma.subscriptionInvitation.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.revoke('i1')).rejects.toThrow();
    expect(prisma.subscriptionInvitation.updateMany).toHaveBeenCalledWith({
      where: { id: 'i1', redeemedAt: null, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
