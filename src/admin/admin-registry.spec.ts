import { validate } from 'class-validator';
import { AdminService } from './admin.service';
import { getMembershipDuration } from './account-membership';
import { StyleNameDto } from './dto/style.dto';
import { CreateTattooCategoryDto } from './dto/tattoo-category.dto';

describe('Admin registration age', () => {
  it('uses registration date and clamps complete calendar months', () => {
    expect(getMembershipDuration('2024-01-31T10:00:00Z', new Date('2026-04-30T10:00:00Z'))).toEqual(expect.objectContaining({ years: 2, months: 3, days: 0, label: '2 ans, 3 mois' }));
  });
  it('counts Paris civil days across the daylight saving change', () => {
    expect(getMembershipDuration('2026-03-28T11:00:00Z', new Date('2026-03-30T10:00:00Z'))?.totalDays).toBe(2);
  });
  it('handles today, invalid and future dates without negative ages', () => {
    const now = new Date('2026-10-23T10:00:00Z');
    expect(getMembershipDuration(now, now)?.label).toBe('Aujourd’hui');
    expect(getMembershipDuration('invalid', now)).toBeNull();
    expect(getMembershipDuration('2027-01-01', now)).toBeNull();
  });
  it('recomputes cached registration ages rather than keeping stale values', async () => {
    const cached = { error: false, salons: [{ id: 's1', createdAt: '2026-01-01T10:00:00Z', membership: { totalDays: 1 } }], pagination: {} };
    const service = new AdminService({} as never, { get: jest.fn().mockResolvedValue(cached) } as never, {} as never);
    const result = await service.getAllSalons();
    expect(result && 'salons' in result ? result.salons[0].membership?.totalDays : 0).toBeGreaterThan(1);
    expect(cached.salons[0].membership.totalDays).toBe(1);
  });
  it('includes registration age on the user detail response', async () => {
    const service = new AdminService({ user: { findUnique: jest.fn().mockResolvedValue({ id: 's1', createdAt: '2025-01-01T10:00:00Z' }) } } as never, {} as never, {} as never);
    expect(await service.getUserById('s1')).toEqual(expect.objectContaining({ user: expect.objectContaining({ membership: expect.objectContaining({ since: '2025-01-01T10:00:00.000Z' }) }) }));
  });
});

describe('Admin taxonomy operations', () => {
  const style = { id: 'st1', name: 'OLD SCHOOL', key: 'oldschool' };
  let prisma: any;
  let cache: any;
  let service: AdminService;
  beforeEach(() => {
    prisma = {
      style: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(style), create: jest.fn().mockResolvedValue(style), update: jest.fn().mockResolvedValue(style), delete: jest.fn().mockResolvedValue(style) },
      tattooCategory: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn().mockResolvedValue({ id: 'c1' }) },
      $executeRaw: jest.fn().mockResolvedValue(2),
      $queryRaw: jest.fn().mockResolvedValue([{ name: style.name, count: BigInt(2) }]),
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    cache = { delPattern: jest.fn() };
    service = new AdminService(prisma, cache, {} as never);
  });
  it('returns style usage counts with the list envelope', async () => {
    prisma.style.findMany.mockResolvedValue([style]);
    expect(await service.getStyles()).toEqual({ error: false, styles: [{ ...style, photoCount: 2 }] });
  });
  it('refuses existing or near-identical styles without creating a duplicate', async () => {
    prisma.style.findMany.mockResolvedValue([style]);
    expect(await service.createStyle('old school')).toEqual(expect.objectContaining({ error: true }));
    expect(prisma.style.create).not.toHaveBeenCalled();
  });
  it('handles a duplicate inserted concurrently as a clear application error', async () => {
    prisma.style.create.mockRejectedValue({ code: 'P2002' });
    expect(await service.createStyle('NEW SCHOOL')).toEqual({ error: true, message: 'Ce style existe déjà.' });
  });
  it('renames styles and their photo references atomically', async () => {
    expect(await service.updateStyle(style.id, 'Traditional')).toEqual(expect.objectContaining({ error: false }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['OLD SCHOOL', 'TRADITIONAL', 'OLD SCHOOL']);
    expect(cache.delPattern).toHaveBeenCalledWith('portfolio:*');
  });
  it('removes style references with the registry entry without deleting photos', async () => {
    expect(await service.deleteStyle(style.id)).toEqual(expect.objectContaining({ error: false }));
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['OLD SCHOOL', 'OLD SCHOOL']);
    expect(prisma.style.delete).toHaveBeenCalledWith({ where: { id: style.id } });
  });
  it('keeps the category response envelope and association counts', async () => {
    const categories = [{ id: 'c1', name: 'Healed', _count: { portfolios: 4 } }];
    prisma.tattooCategory.findMany.mockResolvedValue(categories);
    expect(await service.getTattooCategories()).toEqual({ error: false, categories });
  });
  it('supports category visibility changes and duplicate slug feedback', async () => {
    prisma.tattooCategory.update.mockResolvedValue({ id: 'c1', isActive: false });
    expect(await service.updateTattooCategory('c1', { isActive: false })).toEqual(expect.objectContaining({ error: false }));
    prisma.tattooCategory.create.mockRejectedValue({ code: 'P2002' });
    expect(await service.createTattooCategory({ name: 'Healed' })).toEqual(expect.objectContaining({ error: true }));
  });
  it('validates names and ordering before database writes', async () => {
    expect(await validate(Object.assign(new StyleNameDto(), { name: 'x'.repeat(81) }))).not.toHaveLength(0);
    expect(await validate(Object.assign(new CreateTattooCategoryDto(), { name: 'Healed', sortOrder: -1 }))).not.toHaveLength(0);
    expect(await validate(Object.assign(new CreateTattooCategoryDto(), { name: 'Healed', sortOrder: 2147483648 }))).not.toHaveLength(0);
  });
});
