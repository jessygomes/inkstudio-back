import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PublicProfileAccessGuard } from './public-profile-access';

// Le propriétaire (ou un admin) accède toujours à son profil ; un visiteur ne voit ni un profil masqué, ni un rôle non public.
describe('PublicProfileAccessGuard — owner access', () => {
  const prisma = { user: { findUnique: jest.fn() }, tatoueur: { findUnique: jest.fn() } };
  const reflector = { get: jest.fn().mockReturnValue({ key: 'userId', resource: 'user', source: 'params' }) };
  const guard = new PublicProfileAccessGuard(reflector as unknown as Reflector, prisma as never);
  // L'authentification passport est simulée : on fournit directement req.user.
  jest.spyOn(Object.getPrototypeOf(PublicProfileAccessGuard.prototype), 'canActivate').mockResolvedValue(true);

  const context = (user?: { userId: string; role: string }) => {
    const req = { params: { userId: 'u1' }, query: {}, body: {}, user };
    return { getHandler: () => undefined, switchToHttp: () => ({ getRequest: () => req }) } as never;
  };

  beforeEach(() => jest.clearAllMocks());

  it('lets the owner read a hidden profile, whatever its role', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await expect(guard.canActivate(context({ userId: 'u1', role: 'user_salon' }))).resolves.toBe(true);
  });

  it('lets an admin read any existing profile', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await expect(guard.canActivate(context({ userId: 'admin-1', role: 'admin' }))).resolves.toBe(true);
  });

  it('still returns 404 to the owner when the account does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(context({ userId: 'u1', role: 'user_salon' }))).rejects.toThrow(NotFoundException);
  });

  it('hides a hidden profile from visitors and other accounts', async () => {
    prisma.user.findUnique.mockResolvedValue({ publicVisibility: 'HIDDEN', role: 'user_salon' });
    await expect(guard.canActivate(context())).rejects.toThrow(NotFoundException);
    await expect(guard.canActivate(context({ userId: 'other', role: 'client' }))).rejects.toThrow(NotFoundException);
  });

  it('hides a non-public role from visitors', async () => {
    prisma.user.findUnique.mockResolvedValue({ publicVisibility: 'VISIBLE', role: 'client' });
    await expect(guard.canActivate(context())).rejects.toThrow(NotFoundException);
  });

  it('shows a visible professional profile to visitors', async () => {
    prisma.user.findUnique.mockResolvedValue({ publicVisibility: 'VISIBLE', role: 'user_salon' });
    await expect(guard.canActivate(context())).resolves.toBe(true);
  });
});
