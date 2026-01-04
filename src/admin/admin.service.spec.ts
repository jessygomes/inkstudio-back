/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { SaasPlan } from '@prisma/client';

const createPrismaMock = () => ({
  user: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    groupBy: jest.fn(),
  },
  tatoueur: {
    count: jest.fn(),
  },
  appointment: {
    count: jest.fn(),
  },
});

const createCacheMock = () => ({
  get: jest.fn(),
  set: jest.fn(),
});

describe('AdminService', () => {
  let service: AdminService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let cache: ReturnType<typeof createCacheMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    cache = createCacheMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns cached salons when available', async () => {
    const cached = {
      error: false,
      salons: [{ id: 's1' }],
      pagination: { currentPage: 1 },
    };
    cache.get.mockResolvedValue(cached);

    const result = await service.getAllSalons(
      1,
      10,
      'test',
      SaasPlan.PRO,
      true,
    );

    expect(result).toEqual(cached);
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('fetches salons from database and caches the result', async () => {
    cache.get.mockResolvedValue(null);
    prisma.user.count.mockResolvedValue(2);
    prisma.user.findMany.mockResolvedValue([
      { id: 's1', salonName: 'A', verifiedSalon: false },
      { id: 's2', salonName: 'B', verifiedSalon: true },
    ]);

    const result = await service.getAllSalons(
      1,
      10,
      undefined,
      SaasPlan.PRO,
      false,
    );

    expect(result.error).toBe(false);
    const success = result as { error: false, salons: any[], pagination: any };
    expect(success.salons).toHaveLength(2);
    expect(success.pagination.totalSalons).toBe(2);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), result, 600);
  });

  it('returns an error object when user is not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.getUserById('unknown-id');

    expect(result).toEqual({
      error: true,
      message: 'Utilisateur introuvable.',
    });
  });

  it('computes admin stats from prisma queries', async () => {
    prisma.user.count
      .mockResolvedValueOnce(3) // total salons
      .mockResolvedValueOnce(5) // total clients
      .mockResolvedValueOnce(1) // salons with pending docs
      .mockResolvedValueOnce(2) // salons verified
      .mockResolvedValueOnce(1) // new salons this month
      .mockResolvedValueOnce(2); // new clients this month
    prisma.tatoueur.count.mockResolvedValue(4);
    prisma.appointment.count.mockResolvedValue(7);
    prisma.user.groupBy.mockResolvedValue([
      { saasPlan: SaasPlan.FREE, _count: { saasPlan: 1 } },
      { saasPlan: SaasPlan.PRO, _count: { saasPlan: 2 } },
    ]);

    const result = await service.getAdminStats();

    expect(result.error).toBe(false);
    expect(result.stats).toMatchObject({
      totalSalons: 3,
      totalClients: 5,
      salonsWithPendingDocuments: 1,
      salonsVerified: 2,
      newSalonsThisMonth: 1,
      newClientsThisMonth: 2,
      totalTatoueurs: 4,
      totalAppointments: 7,
      salonsBySaasPlan: {
        FREE: 1,
        PRO: 2,
      },
    });
  });

  // it('returns monthly evolution data with revenue estimation', async () => {
  //   const fixedNow = new Date('2024-06-15T12:00:00Z');
  //   jest.useFakeTimers({ now: fixedNow });

  //   prisma.user.count.mockImplementation((args) => {
  //     if (args?.where?.saasPlan === SaasPlan.PRO) return 1;
  //     if (args?.where?.saasPlan === SaasPlan.BUSINESS) return 2;
  //     return 3; // salons created per month
  //   });
  //   prisma.appointment.count.mockResolvedValue(5);

  //   const result = await service.getMonthlyEvolution(2);

  //   expect(result.error).toBe(false);
  //   const data = (result as { error: false, data: any[] }).data;
  //   expect(data).toHaveLength(2);
  //   expect(data[0]).toMatchObject({
  //     salons: 3,
  //     appointments: 5,
  //     revenue: 2 * 80 + 1 * 40,
  //   });

  //   jest.useRealTimers();
  // });
});
