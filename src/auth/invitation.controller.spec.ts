import { AuthController } from './auth.controller';

describe('invitation preview', () => {
  const token = 'a'.repeat(64);
  const invitation = {
    email: null, role: 'user_tatoueur', plan: 'PRO', durationMonths: 12,
    useCount: 4, maxUses: 5, revokedAt: null, expiresAt: new Date('2099-01-01'),
  };

  it('allows a shared link with one remaining place and no imposed email', async () => {
    const prisma = { subscriptionInvitation: { findUnique: jest.fn().mockResolvedValue(invitation) } };
    const controller = new AuthController({} as never, {} as never, prisma as never);
    expect(await controller.invitation(token)).toEqual({ email: null, role: 'user_tatoueur', plan: 'PRO', durationMonths: 12 });
  });

  it.each([
    null, { ...invitation, useCount: 5 }, { ...invitation, revokedAt: new Date() },
    { ...invitation, expiresAt: new Date('2020-01-01') },
  ])('rejects unavailable invitations before showing a registration form', async record => {
    const prisma = { subscriptionInvitation: { findUnique: jest.fn().mockResolvedValue(record) } };
    const controller = new AuthController({} as never, {} as never, prisma as never);
    await expect(controller.invitation(token)).rejects.toThrow();
  });

  it('preserves a personal invitation email', async () => {
    const prisma = { subscriptionInvitation: { findUnique: jest.fn().mockResolvedValue({ ...invitation, email: 'personal@example.com', maxUses: 1, useCount: 0 }) } };
    const controller = new AuthController({} as never, {} as never, prisma as never);
    expect(await controller.invitation(token)).toMatchObject({ email: 'personal@example.com' });
  });
});
