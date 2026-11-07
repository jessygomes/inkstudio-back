import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

// Renouvellement de session : jeton de rafraîchissement échangé contre un nouveau couple de jetons.
function build(user: { id: string; role: string } | null) {
  const refreshTokens = {
    rotate: jest.fn().mockResolvedValue({ userId: 'u1', refreshToken: 'new-refresh', refreshExpiresAt: new Date('2027-01-01T00:00:00Z') }),
    revokeByToken: jest.fn().mockResolvedValue(undefined),
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
  const jwt = {
    sign: jest.fn().mockReturnValue('new-access'),
    decode: jest.fn().mockReturnValue({ exp: 1_800_000_000 }),
  };
  const none = {} as never;
  const service = new AuthService(prisma as never, jwt as never, none, none, none, none, none, undefined, refreshTokens as never);
  return { service, refreshTokens, prisma, jwt };
}

describe('AuthService.refresh', () => {
  it('renvoie un nouveau jeton d\'accès (avec le rôle actuel du compte) et un nouveau jeton de rafraîchissement', async () => {
    const { service, refreshTokens, jwt } = build({ id: 'u1', role: 'user_salon' });
    const result = await service.refresh('old-refresh', 'jest');
    expect(refreshTokens.rotate).toHaveBeenCalledWith('old-refresh', 'jest');
    expect(jwt.sign).toHaveBeenCalledWith({ userId: 'u1', role: 'user_salon' });
    expect(result).toEqual({
      access_token: 'new-access',
      access_expires_at: new Date(1_800_000_000 * 1000).toISOString(),
      refresh_token: 'new-refresh',
      refresh_expires_at: '2027-01-01T00:00:00.000Z',
    });
  });

  it('refuse (et ferme les sessions) si le compte n\'existe plus', async () => {
    const { service, refreshTokens } = build(null);
    await expect(service.refresh('old-refresh')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1');
  });

  it('refuse si le jeton est rejeté par la rotation', async () => {
    const { service, refreshTokens } = build({ id: 'u1', role: 'client' });
    refreshTokens.rotate.mockRejectedValueOnce(new UnauthorizedException());
    await expect(service.refresh('bad')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuse quand les jetons de rafraîchissement ne sont pas disponibles', async () => {
    const none = {} as never;
    const service = new AuthService({} as never, {} as never, none, none, none, none, none);
    await expect(service.refresh('whatever')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('déconnecte un appareil ou tous les appareils', async () => {
    const { service, refreshTokens } = build({ id: 'u1', role: 'client' });
    await expect(service.logout('tok')).resolves.toEqual({ success: true });
    expect(refreshTokens.revokeByToken).toHaveBeenCalledWith('tok');
    await expect(service.logoutAll('u1')).resolves.toEqual({ success: true });
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1');
  });
});
