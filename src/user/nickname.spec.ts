import { UserService } from './user.service';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../redis/cache.service';
import { MailService } from '../email/mailer.service';

describe('independent nickname persistence', () => {
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
  const cache = { del: jest.fn(), delPattern: jest.fn() };
  const service = new UserService(
    prisma as unknown as PrismaService,
    cache as unknown as CacheService,
    {} as MailService,
  );
  const identity = {
    salonName: 'Jean Dupont',
    firstName: 'Jean',
    lastName: 'Dupont',
    phone: '0102030405',
    address: '',
    city: 'Orléans',
    postalCode: '45000',
    instagram: '',
    facebook: '',
    tiktok: '',
    website: '',
    description: '',
    image: '',
  };
  beforeEach(() => jest.resetAllMocks());

  it.each([
    [' Blue Ink ', 'Blue Ink'],
    ['', null],
  ])(
    'saves or clears %j without replacing legal identity',
    async (nickname, expected) => {
      prisma.user.findUnique.mockResolvedValue({ role: 'user_tatoueur' });
      prisma.user.update.mockResolvedValue({ id: 'artist' });
      await service.updateUser({
        userId: 'artist',
        userBody: { ...identity, nickname: nickname ?? undefined },
      });
      const call = prisma.user.update.mock.calls[0] as unknown as [
        { data: Record<string, unknown> },
      ];
      expect(call[0].data).toMatchObject({
        nickname: expected,
        firstName: 'Jean',
        lastName: 'Dupont',
        salonName: 'Jean Dupont',
      });
    },
  );

  it('leaves a saved nickname untouched when an older client omits the field', async () => {
    prisma.user.update.mockResolvedValue({ id: 'artist' });
    await service.updateUser({ userId: 'artist', userBody: identity });
    const call = prisma.user.update.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(call[0].data).not.toHaveProperty('nickname');
  });

  it('rejects setting an independent nickname from a salon account', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'user_salon' });
    await expect(
      service.updateUser({
        userId: 'salon',
        userBody: { ...identity, nickname: 'Blue' },
      }),
    ).rejects.toThrow('réservé aux comptes indépendants');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
