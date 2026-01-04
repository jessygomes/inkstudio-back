import { Test, TestingModule } from '@nestjs/testing';
import { ClientsService } from './clients.service';
import { PrismaService } from 'src/database/prisma.service';
import { SaasService } from 'src/saas/saas.service';
import { CacheService } from 'src/redis/cache.service';

const createPrismaMock = () => ({
  $transaction: jest.fn(),
  client: {
    create: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  tattooDetail: {
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  medicalHistory: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  appointment: {
    updateMany: jest.fn(),
  },
  tattooHistory: {
    deleteMany: jest.fn(),
  },
  aftercare: {
    deleteMany: jest.fn(),
  },
  followUpSubmission: {
    deleteMany: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
});

const createCacheMock = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
});

const createSaasMock = () => ({
  canPerformAction: jest.fn(async () => true),
  checkLimits: jest.fn(async () => ({ limits: { clients: 10 } })),
});

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let cache: ReturnType<typeof createCacheMock>;
  let saas: ReturnType<typeof createSaasMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    cache = createCacheMock();
    saas = createSaasMock();

    // $transaction should execute provided callback with prisma
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SaasService, useValue: saas },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
    jest.clearAllMocks();
  });

  it('denies client creation when SaaS limits reached', async () => {
    saas.canPerformAction.mockResolvedValue(false);
    saas.checkLimits.mockResolvedValue({ limits: { clients: 5 } });

    const result = await service.createClient({
      userId: 'u1',
      clientBody: {
        firstName: 'A', lastName: 'B', email: 'a@b.com', phone: '1', birthDate: '', address: '',
      } as any,
    });

    expect(result).toEqual({
      error: true,
      message: expect.stringContaining('Limite de fiches clients atteinte (5)'),
    });
    expect(prisma.client.create).not.toHaveBeenCalled();
  });

  it('creates client and does not create optional details when absent', async () => {
    prisma.client.create.mockResolvedValue({ id: 'c1', userId: 'u1' });

    const result = await service.createClient({
      userId: 'u1',
      clientBody: {
        firstName: 'A', lastName: 'B', email: 'a@b.com', phone: '1', birthDate: '', address: '',
      } as any,
    });

    expect(result).toMatchObject({ error: false, client: { id: 'c1' } });
    expect(prisma.tattooDetail.create).not.toHaveBeenCalled();
    expect(prisma.medicalHistory.create).not.toHaveBeenCalled();
    expect(cache.delPattern).toHaveBeenCalledWith('clients:salon:u1:*');
    expect(cache.delPattern).toHaveBeenCalledWith('clients:search:u1:*');
  });

  it('returns cached client by id when present', async () => {
    const cached = { id: 'c1', firstName: 'A', lastName: 'B' };
    cache.get.mockResolvedValue(cached);

    const result = await service.getClientById('c1');

    expect(result).toEqual(cached);
    expect(prisma.client.findUnique).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('fetches client by id and caches when not cached', async () => {
    cache.get.mockResolvedValue(null);
    const client = { id: 'c1', firstName: 'A' };
    prisma.client.findUnique.mockResolvedValue(client as any);

    const result = await service.getClientById('c1');

    expect(result).toEqual(client);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), client, 600);
  });

  it('returns cached salon clients when present', async () => {
    const cached = { error: false, clients: [{ id: 'c1' }], pagination: { currentPage: 1 } };
    cache.get.mockResolvedValue(cached);

    const result = await service.getClientsBySalon('u1', 1, 5, '');

    expect(result).toEqual(cached);
    expect(prisma.client.count).not.toHaveBeenCalled();
    expect(prisma.client.findMany).not.toHaveBeenCalled();
  });

  it('fetches salon clients with pagination and caches result', async () => {
    cache.get.mockResolvedValue(null);
    prisma.client.count.mockResolvedValue(2);
    prisma.client.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

    const result = await service.getClientsBySalon('u1', 1, 5, '');

    expect(result.error).toBe(false);
    const success = result as { error: false; clients: any[]; pagination: any };
    expect(success.clients).toHaveLength(2);
    expect(success.pagination.totalClients).toBe(2);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), result, 300);
  });

  it('updates client and medical history when existing', async () => {
    prisma.client.update.mockResolvedValue({ id: 'c1', userId: 'u1' });
    prisma.medicalHistory.findUnique.mockResolvedValue({ clientId: 'c1' });
    prisma.medicalHistory.update.mockResolvedValue({ clientId: 'c1', allergies: 'pollen' });

    const result = await service.updateClient('c1', {
      firstName: 'A', lastName: 'B', email: 'e', phone: '1', address: 'addr', allergies: 'pollen', birthDate: '',
    } as any);

    expect(result).toMatchObject({ error: false });
    expect(prisma.medicalHistory.update).toHaveBeenCalled();
    expect(cache.del).toHaveBeenCalledWith('client:c1');
    expect(cache.delPattern).toHaveBeenCalledWith('clients:salon:u1:*');
    expect(cache.delPattern).toHaveBeenCalledWith('clients:search:u1:*');
  });

  it('deletes client and invalidates caches', async () => {
    prisma.client.findUnique.mockResolvedValue({ userId: 'u1' });
    prisma.medicalHistory.deleteMany.mockResolvedValue({});
    prisma.tattooHistory.deleteMany.mockResolvedValue({});
    prisma.aftercare.deleteMany.mockResolvedValue({});
    prisma.followUpSubmission.deleteMany.mockResolvedValue({});
    prisma.appointment.updateMany.mockResolvedValue({});
    prisma.tattooDetail.deleteMany.mockResolvedValue({});
    prisma.client.delete.mockResolvedValue({});

    const result = await service.deleteClient('c1');

    expect(result).toEqual({ error: false, message: 'Client supprimé avec succès.' });
    expect(cache.del).toHaveBeenCalledWith('client:c1');
    expect(cache.delPattern).toHaveBeenCalledWith('clients:salon:u1:*');
    expect(cache.delPattern).toHaveBeenCalledWith('clients:search:u1:*');
  });

  it('searches clients combines existing and user clients, caches result', async () => {
    cache.get.mockResolvedValue(null);
    prisma.client.findMany.mockResolvedValue([
      { id: 'c1', firstName: 'A', lastName: 'B', email: 'ab@x.com', phone: '1', birthDate: null, address: '', linkedUserId: 'uX', createdAt: new Date() },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'uX', firstName: 'A', lastName: 'B', email: 'ab@x.com', phone: '1', clientProfile: { birthDate: null } },
      { id: 'u2', firstName: 'C', lastName: 'D', email: 'cd@x.com', phone: '2', clientProfile: { birthDate: null } },
    ]);

    const result = await service.searchClients('a', 'salon1');

    expect(result.error).toBe(false);
    expect(result.totalResults).toBe(2); // 1 existing + 1 available user client (u2)
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ totalResults: 2 }), 120);
  });

  it('returns monthly new clients count structure', async () => {
    prisma.client.count.mockResolvedValue(5);

    const result = await service.getNewClientsCountByMonth('u1', 5, 2024);

    expect(result).toEqual({ error: false, month: 5, year: 2024, newClientsCount: 5 });
  });
});
