/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { ClientsService } from './clients.service';
import { PrismaService } from 'src/database/prisma.service';
import { SaasService } from 'src/saas/saas.service';
import { CacheService } from 'src/redis/cache.service';
import { CreateClientDto } from './dto/create-client.dto';

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
  canPerformAction: jest.fn(() => Promise.resolve(true)),
  checkLimits: jest.fn(() => Promise.resolve({ limits: { clients: 10 } })),
});

const buildClientDto = (
  overrides: Partial<CreateClientDto> = {},
): CreateClientDto => ({
  firstName: 'A',
  lastName: 'B',
  email: 'a@b.com',
  phone: '1',
  birthDate: '',
  address: '',
  description: '',
  zone: '',
  size: '',
  colorStyle: '',
  ...overrides,
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
    prisma.$transaction.mockImplementation(<T>(fn: (p: typeof prisma) => T) =>
      fn(prisma),
    );

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
      clientBody: buildClientDto(),
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
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '1',
        birthDate: '',
        address: '',
      } as any,
    });

    expect(result).toMatchObject({ error: false, client: { id: 'c1' } });
    expect(prisma.tattooDetail.create).not.toHaveBeenCalled();
    expect(prisma.medicalHistory.create).not.toHaveBeenCalled();
    expect(cache.delPattern).toHaveBeenCalledWith('clients:salon:u1:*');
    expect(cache.delPattern).toHaveBeenCalledWith('clients:search:u1:*');
  });

  it('creates client with tattoo detail and medical history when provided', async () => {
    prisma.client.create.mockResolvedValue({ id: 'c1', userId: 'u1' });
    prisma.tattooDetail.create.mockResolvedValue({ id: 'td1', clientId: 'c1' });
    prisma.medicalHistory.create.mockResolvedValue({
      id: 'mh1',
      clientId: 'c1',
      allergies: 'pollen',
    });

    const result = await service.createClient({
      userId: 'u1',
      clientBody: buildClientDto({
        birthDate: '2024-01-01',
        address: 'addr',
        description: 'desc',
        zone: 'arm',
        size: '10cm',
        colorStyle: 'color',
        reference: 'ref',
        sketch: 'sketch',
        estimatedPrice: 100,
        allergies: 'pollen',
        healthIssues: 'none',
        medications: 'none',
        pregnancy: false,
        tattooHistory: 'history',
      }),
    });

    expect(result).toMatchObject({
      error: false,
      client: { id: 'c1' },
      tattooDetail: { id: 'td1' },
      medicalHistory: { id: 'mh1' },
    });
    expect(prisma.tattooDetail.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ clientId: 'c1', description: 'desc' }),
    });
    expect(prisma.medicalHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ clientId: 'c1', allergies: 'pollen' }),
    });
    expect(cache.delPattern).toHaveBeenCalledWith('clients:salon:u1:*');
    expect(cache.delPattern).toHaveBeenCalledWith('clients:search:u1:*');
  });

  it('returns error when createClient throws', async () => {
    prisma.client.create.mockRejectedValue(new Error('boom'));

    const result = await service.createClient({
      userId: 'u1',
      clientBody: buildClientDto({ email: 'e' }),
    });

    expect(result).toEqual({ error: true, message: 'boom' });
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

  it('returns error when client by id is not found', async () => {
    cache.get.mockResolvedValue(null);
    prisma.client.findUnique.mockResolvedValue(null);

    const result = await service.getClientById('missing');

    expect(result).toEqual({ error: true, message: 'Client introuvable.' });
  });

  it('returns cached salon clients when present', async () => {
    const cached = {
      error: false,
      clients: [{ id: 'c1' }],
      pagination: { currentPage: 1 },
    };
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
    const success = result as {
      error: false,
      clients: any[],
      pagination: { totalClients: number },
    };
    expect(success.clients).toHaveLength(2);
    expect(success.pagination.totalClients).toBe(2);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), result, 300);
  });

  it('returns error when no clients found for salon', async () => {
    cache.get.mockResolvedValue(null);
    prisma.client.count.mockResolvedValue(0);
    prisma.client.findMany.mockResolvedValue([]);

    const result = await service.getClientsBySalon('u1', 1, 5, '');

    expect(result).toEqual({ error: true, message: 'Aucun client trouvé.' });
  });

  it('applies search filter when fetching salon clients', async () => {
    cache.get.mockResolvedValue(null);
    prisma.client.count.mockResolvedValue(1);
    prisma.client.findMany.mockResolvedValue([{ id: 'c1' }]);

    await service.getClientsBySalon('u1', 1, 10, 'alice');

    expect(prisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          OR: expect.arrayContaining([
            expect.objectContaining({
              firstName: expect.objectContaining({ contains: 'alice' }),
            }),
            expect.objectContaining({
              lastName: expect.objectContaining({ contains: 'alice' }),
            }),
            expect.objectContaining({
              email: expect.objectContaining({ contains: 'alice' }),
            }),
          ]),
        }),
      }),
    );
  });

  it('updates client and medical history when existing', async () => {
    prisma.client.update.mockResolvedValue({ id: 'c1', userId: 'u1' });
    prisma.medicalHistory.findUnique.mockResolvedValue({ clientId: 'c1' });
    prisma.medicalHistory.update.mockResolvedValue({
      clientId: 'c1',
      allergies: 'pollen',
    });

    const result = await service.updateClient(
      'c1',
      buildClientDto({
        email: 'e',
        address: 'addr',
        allergies: 'pollen',
        birthDate: '',
      }),
    );

    expect(result).toMatchObject({ error: false });
    expect(prisma.medicalHistory.update).toHaveBeenCalled();
    expect(cache.del).toHaveBeenCalledWith('client:c1');
    expect(cache.delPattern).toHaveBeenCalledWith('clients:salon:u1:*');
    expect(cache.delPattern).toHaveBeenCalledWith('clients:search:u1:*');
  });

  it('creates medical history when none exists during update', async () => {
    prisma.client.update.mockResolvedValue({ id: 'c1', userId: 'u1' });
    prisma.medicalHistory.findUnique.mockResolvedValue(null);
    prisma.medicalHistory.create.mockResolvedValue({
      clientId: 'c1',
      allergies: 'pollen',
    });

    const result = await service.updateClient(
      'c1',
      buildClientDto({
        email: 'e',
        address: 'addr',
        allergies: 'pollen',
        birthDate: '2024-01-01',
      }),
    );

    expect(result).toMatchObject({
      error: false,
      medicalHistory: { clientId: 'c1' },
    });
    expect(prisma.medicalHistory.create).toHaveBeenCalled();
  });

  it('skips medical history when no medical data provided', async () => {
    prisma.client.update.mockResolvedValue({ id: 'c1', userId: 'u1' });

    const result = await service.updateClient(
      'c1',
      buildClientDto({
        email: 'e',
        address: 'addr',
        birthDate: '',
      }),
    );

    expect(result).toMatchObject({ error: false });
    expect(prisma.medicalHistory.findUnique).not.toHaveBeenCalled();
    expect(prisma.medicalHistory.create).not.toHaveBeenCalled();
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

    expect(result).toEqual({
      error: false,
      message: 'Client supprimé avec succès.',
    });
    expect(cache.del).toHaveBeenCalledWith('client:c1');
    expect(cache.delPattern).toHaveBeenCalledWith('clients:salon:u1:*');
    expect(cache.delPattern).toHaveBeenCalledWith('clients:search:u1:*');
  });

  it('returns error when deleting missing client', async () => {
    prisma.client.findUnique.mockResolvedValue(null);

    const result = await service.deleteClient('missing');

    expect(result).toEqual({
      error: true,
      message: expect.stringContaining('Client introuvable.'),
    });
  });

  it('searches clients combines existing and user clients, caches result', async () => {
    cache.get.mockResolvedValue(null);
    prisma.client.findMany.mockResolvedValue([
      {
        id: 'c1',
        firstName: 'A',
        lastName: 'B',
        email: 'ab@x.com',
        phone: '1',
        birthDate: null,
        address: '',
        linkedUserId: 'uX',
        createdAt: new Date(),
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'uX',
        firstName: 'A',
        lastName: 'B',
        email: 'ab@x.com',
        phone: '1',
        clientProfile: { birthDate: null },
      },
      {
        id: 'u2',
        firstName: 'C',
        lastName: 'D',
        email: 'cd@x.com',
        phone: '2',
        clientProfile: { birthDate: null },
      },
    ]);

    const result = await service.searchClients('a', 'salon1');
    const success = result as unknown as {
      error: boolean,
      totalResults?: number,
    };

    expect(success.error).toBe(false);
    expect(success.totalResults).toBe(2); // 1 existing + 1 available user client (u2)
    expect(cache.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ totalResults: 2 }),
      120,
    );
  });

  it('returns cached search clients when present', async () => {
    const cached = {
      error: false,
      clients: [{ id: 'c1' }],
      userClients: [],
      totalResults: 1,
    };
    cache.get.mockResolvedValue(cached);

    const result = await service.searchClients('q', 'u1');

    expect(result).toEqual(cached);
    expect(prisma.client.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('returns error structure when searchClients throws', async () => {
    cache.get.mockResolvedValue(null);
    prisma.client.findMany.mockRejectedValue(new Error('boom'));

    const result = await service.searchClients('q', 'u1');

    expect(result).toEqual({
      error: true,
      message: 'boom',
      clients: [],
      userClients: [],
      totalResults: 0,
    });
  });

  it('returns monthly new clients count structure', async () => {
    prisma.client.count.mockResolvedValue(5);

    const result = await service.getNewClientsCountByMonth('u1', 5, 2024);

    expect(result).toEqual({
      error: false,
      month: 5,
      year: 2024,
      newClientsCount: 5,
    });
  });

  it('returns error when getNewClientsCountByMonth throws', async () => {
    prisma.client.count.mockRejectedValue(new Error('boom'));

    const result = await service.getNewClientsCountByMonth('u1', 1, 2024);

    expect(result).toEqual({ error: true, message: 'boom' });
  });
});
