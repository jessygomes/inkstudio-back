import { FlashService } from './flash.service';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../redis/cache.service';

describe('public flash visibility', () => {
  const prisma = { user: { findUnique: jest.fn() }, flash: { count: jest.fn(), findMany: jest.fn() } };
  const cache = { get: jest.fn(), set: jest.fn() };
  const service = new FlashService(prisma as unknown as PrismaService, cache as unknown as CacheService);
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockResolvedValue({ role: 'user_salon', linkedTatoueurs: [{ id: 'hidden-artist' }] });
    prisma.flash.count.mockResolvedValue(0);
    prisma.flash.findMany.mockResolvedValue([]);
    cache.get.mockResolvedValue({ flashs: [{ id: 'stale-hidden-flash' }] });
  });
  it('excludes hidden linked creators from available public flashs despite stale cache', async () => {
    const result = await service.getAvailableFlashsByUser('salon', 1, true);
    expect(result).toMatchObject({ flashs: [] });
    expect(prisma.flash.count).toHaveBeenCalledWith({ where: { userId: { in: ['salon', 'hidden-artist'] }, isAvailable: true, user: { publicVisibility: { not: 'HIDDEN' } } } });
  });
  it('also checks visibility when a public caller requests all flashs', async () => {
    const result = await service.getAllFlashsByUser('salon', 1, undefined, true);
    expect(result).toMatchObject({ flashs: [] });
    expect(prisma.flash.count).toHaveBeenCalledWith({ where: { userId: { in: ['salon', 'hidden-artist'] }, user: { publicVisibility: { not: 'HIDDEN' } } } });
  });
  it('keeps private owner results available through the existing cache', async () => {
    const result = await service.getAllFlashsByUser('salon');
    expect(result).toMatchObject({ flashs: [{ id: 'stale-hidden-flash' }] });
    expect(prisma.flash.count).not.toHaveBeenCalled();
  });
});
