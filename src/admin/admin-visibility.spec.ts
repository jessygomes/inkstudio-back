import { AdminService } from './admin.service';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../redis/cache.service';
import { MailService } from '../email/mailer.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PublicVisibility } from '@prisma/client';
import { AdminController } from './admin.controller';
import { ROLES_KEY } from '../auth/roles.decorator';

describe('admin public visibility', () => {
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
  const cache = { delPattern: jest.fn() };
  const service = new AdminService(
    prisma as unknown as PrismaService,
    cache as unknown as CacheService,
    {} as MailService,
  );
  beforeEach(() => jest.resetAllMocks());
  it.each(Object.values(PublicVisibility))(
    'saves %s and invalidates public caches',
    async (publicVisibility) => {
      prisma.user.findUnique.mockResolvedValue({ role: 'user_salon' });
      prisma.user.update.mockResolvedValue({ id: 'salon', publicVisibility });
      expect(
        await service.updatePublicVisibility('salon', publicVisibility),
      ).toMatchObject({ error: false, user: { publicVisibility } });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'salon' },
        data: { publicVisibility },
        select: { id: true, publicVisibility: true },
      });
      for (const pattern of [
        'users:list:*',
        'user:slug:*',
        'portfolio:inspirations:*',
        'admin:*',
      ])
        expect(cache.delPattern).toHaveBeenCalledWith(pattern);
    },
  );
  it('rejects client accounts and missing users', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'client' });
    await expect(
      service.updatePublicVisibility('client', PublicVisibility.HIDDEN),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.updatePublicVisibility('missing', PublicVisibility.HIDDEN),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it('keeps the endpoint under the admin role restriction', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual(['admin']);
  });
});
