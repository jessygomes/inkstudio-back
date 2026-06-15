import { Test, TestingModule } from '@nestjs/testing';
import { TatoueursService } from './tatoueurs.service';
import { PrismaService } from 'src/database/prisma.service';
import { SaasService } from 'src/saas/saas.service';
import { CacheService } from 'src/redis/cache.service';
import { CreateTatoueurDto } from './dto/create-tatoueur.dto';
import { Role } from '@prisma/client';

const createPrismaMock = () => ({
  tatoueur: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  salonTatoueurTeamRequest: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(async (callback) => callback(createPrismaMock())),
});

const createSaasMock = () => ({
  canPerformAction: jest.fn(),
  checkLimits: jest.fn(),
});

const createCacheMock = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
});

const buildTatoueurDto = (
  overrides: Partial<CreateTatoueurDto> = {},
): CreateTatoueurDto => ({
  name: 'John',
  img: 'img.jpg',
  description: 'Professional tattoo artist',
  phone: '123456789',
  instagram: '@john_tattoo',
  hours: 'Mon-Fri 10-18',
  style: ['Realistic'],
  skills: ['Portraits'],
  rdvBookingEnabled: true,
  ...overrides,
});

describe('TatoueursService', () => {
  let service: TatoueursService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let saas: ReturnType<typeof createSaasMock>;
  let cache: ReturnType<typeof createCacheMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    saas = createSaasMock();
    cache = createCacheMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TatoueursService,
        { provide: PrismaService, useValue: prisma },
        { provide: SaasService, useValue: saas },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<TatoueursService>(TatoueursService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('returns error when SaaS limit reached', async () => {
      saas.canPerformAction.mockResolvedValue(false);
      saas.checkLimits.mockResolvedValue({
        limits: { tattooeurs: 5 },
      });

      const result = await service.create({
        tatoueurBody: buildTatoueurDto(),
        userId: 'u1',
      });

      expect(result.error).toBe(true);
      expect(result.message).toContain('Limite de tatoueurs atteinte');
      expect(prisma.tatoueur.create).not.toHaveBeenCalled();
    });

    it('creates tatoueur successfully and invalidates cache', async () => {
      saas.canPerformAction.mockResolvedValue(true);
      prisma.tatoueur.create.mockResolvedValue({
        id: 't1',
        name: 'John',
        userId: 'u1',
      });

      const result = await service.create({
        tatoueurBody: buildTatoueurDto(),
        userId: 'u1',
      });

      expect(result.error).toBe(false);
      expect(
        (result as unknown as { tatoueur?: { id: string } }).tatoueur?.id,
      ).toBe('t1');
      expect(prisma.tatoueur.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            style: ['REALISTIC'],
          }),
        }),
      );
      expect(cache.del).toHaveBeenCalledWith('tatoueurs:all');
      expect(cache.del).toHaveBeenCalledWith('tatoueurs:user:u1');
      expect(cache.del).toHaveBeenCalledWith(
        'tatoueurs:user:u1:appointment-enabled',
      );
    });

    it('returns error on create failure', async () => {
      saas.canPerformAction.mockResolvedValue(true);
      prisma.tatoueur.create.mockRejectedValue(new Error('boom'));

      const result = await service.create({
        tatoueurBody: buildTatoueurDto(),
        userId: 'u1',
      });

      expect(result.error).toBe(true);
      expect(result.message).toBe('boom');
    });
  });

  describe('getAllTatoueurs', () => {
    it('returns cached tatoueurs when present', async () => {
      const cached = [{ id: 't1', name: 'John' }];
      cache.get.mockResolvedValue(cached);

      const result = await service.getAllTatoueurs();

      expect(result).toEqual(cached);
      expect(prisma.tatoueur.findMany).not.toHaveBeenCalled();
    });

    it('fetches tatoueurs, caches them, and returns list', async () => {
      cache.get.mockResolvedValue(null);
      prisma.tatoueur.findMany.mockResolvedValue([
        { id: 't1', name: 'John' },
        { id: 't2', name: 'Jane' },
      ]);

      const result = await service.getAllTatoueurs();

      expect(result).toHaveLength(2);
      expect(cache.set).toHaveBeenCalledWith('tatoueurs:all', result, 1800);
    });

    it('returns error on retrieval failure', async () => {
      cache.get.mockResolvedValue(null);
      prisma.tatoueur.findMany.mockRejectedValue(new Error('db fail'));

      const result = await service.getAllTatoueurs();

      expect((result as unknown as { error: boolean }).error).toBe(true);
      expect((result as unknown as { message: string }).message).toBe(
        'db fail',
      );
    });
  });

  describe('getTatoueurByUserId', () => {
    it('returns cached tatoueurs when present', async () => {
      const cached = [{ id: 't1', name: 'John', userId: 'u1' }];
      cache.get.mockResolvedValue(cached);

      const result = await service.getTatoueurByUserId('u1');

      expect(result).toEqual(cached);
      expect(prisma.tatoueur.findMany).not.toHaveBeenCalled();
    });

    it('fetches user tatoueurs, caches them, and returns list', async () => {
      cache.get.mockResolvedValue(null);
      prisma.tatoueur.findMany.mockResolvedValue([
        { id: 't1', name: 'John', userId: 'u1' },
      ]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.getTatoueurByUserId('u1');

      expect(result).toHaveLength(1);
      expect(cache.set).toHaveBeenCalledWith('tatoueurs:user:u1', result, 1200);
    });

    it('uses salonName as name for linked tatoueur users', async () => {
      cache.get.mockResolvedValue(null);
      prisma.tatoueur.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'linked-user-1',
          salonName: 'INK MASTER',
          firstName: 'Jean',
          lastName: 'Dupont',
          image: 'img.jpg',
          profileImage: null,
          phone: '123',
          instagram: '@ink',
          description: 'desc',
          prestations: ['TATTOO'],
          style: ['REALISTIC'],
          appointmentBookingEnabled: true,
        },
      ]);

      const result = await service.getTatoueurByUserId('u1');

      expect(result).toHaveLength(1);
      expect((result[0] as { name: string }).name).toBe('INK MASTER');
      expect((result[0] as { isLinkedUser: boolean }).isLinkedUser).toBe(true);
    });

    it('returns error on retrieval failure', async () => {
      cache.get.mockResolvedValue(null);
      prisma.tatoueur.findMany.mockRejectedValue(new Error('db fail'));

      const result = await service.getTatoueurByUserId('u1');

      expect((result as unknown as { error: boolean }).error).toBe(true);
    });
  });

  describe('getTatoueurByUserIdForAppointment', () => {
    it('returns cached appointment-enabled tatoueurs when present', async () => {
      const cached = [{ id: 't1', name: 'John', rdvBookingEnabled: true }];
      cache.get.mockResolvedValue(cached);

      const result = await service.getTatoueurByUserIdForAppointment('u1');

      expect(result).toEqual(cached);
      expect(prisma.tatoueur.findMany).not.toHaveBeenCalled();
    });

    it('fetches appointment-enabled tatoueurs, caches them, and returns', async () => {
      cache.get.mockResolvedValue(null);
      prisma.tatoueur.findMany.mockResolvedValue([
        { id: 't1', name: 'John', rdvBookingEnabled: true },
      ]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.getTatoueurByUserIdForAppointment('u1');

      expect(result).toHaveLength(1);
      expect(cache.set).toHaveBeenCalledWith(
        'tatoueurs:user:u1:appointment-enabled',
        result,
        900,
      );
    });

    it('includes linked tatoueur users enabled for appointments', async () => {
      cache.get.mockResolvedValue(null);
      prisma.tatoueur.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'linked-user-1',
          salonName: 'INK MASTER',
          firstName: 'Jean',
          lastName: 'Dupont',
          image: 'img.jpg',
          profileImage: null,
          phone: '123',
          instagram: '@ink',
          description: 'desc',
          prestations: ['TATTOO'],
          style: ['REALISTIC'],
          appointmentBookingEnabled: true,
        },
      ]);

      const result = await service.getTatoueurByUserIdForAppointment('u1');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'linked_linked-user-1',
          name: 'INK MASTER',
          rdvBookingEnabled: true,
          isLinkedUser: true,
        }),
      );
    });

    it('updates linked tatoueur appointment booking for salon', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'linked-user-1',
        role: Role.user_tatoueur,
        salonId: 'salon-1',
        appointmentBookingEnabled: false,
      });
      prisma.user.update.mockResolvedValue({
        id: 'linked-user-1',
        appointmentBookingEnabled: true,
        salonId: 'salon-1',
      });

      const result = await service.updateLinkedTatoueurAppointmentBooking({
        salonUserId: 'salon-1',
        salonRole: 'user_salon',
        tatoueurUserId: 'linked-user-1',
        appointmentBookingEnabled: true,
      });

      expect(result.error).toBe(false);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'linked-user-1' },
          data: { appointmentBookingEnabled: true },
        }),
      );
      expect(cache.delPattern).toHaveBeenCalledWith('user:slug:*');
    });

    it('returns error on retrieval failure', async () => {
      cache.get.mockResolvedValue(null);
      prisma.tatoueur.findMany.mockRejectedValue(new Error('db fail'));

      const result = await service.getTatoueurByUserIdForAppointment('u1');

      expect((result as unknown as { error: boolean }).error).toBe(true);
    });
  });

  describe('getOneTatoueur', () => {
    it('returns cached tatoueur when present', async () => {
      const cached = { id: 't1', name: 'John' };
      cache.get.mockResolvedValue(cached);

      const result = await service.getOneTatoueur('t1');

      expect(result).toEqual(cached);
      expect(prisma.tatoueur.findUnique).not.toHaveBeenCalled();
    });

    it('fetches tatoueur, caches it, and returns when found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.tatoueur.findUnique.mockResolvedValue({ id: 't1', name: 'John' });

      const result = await service.getOneTatoueur('t1');

      expect(result).toEqual({ id: 't1', name: 'John' });
      expect(cache.set).toHaveBeenCalledWith('tatoueur:t1', result, 1800);
    });

    it('returns null when tatoueur not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.tatoueur.findUnique.mockResolvedValue(null);

      const result = await service.getOneTatoueur('t1');

      expect(result).toBeNull();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('returns error on retrieval failure', async () => {
      cache.get.mockResolvedValue(null);
      prisma.tatoueur.findUnique.mockRejectedValue(new Error('db fail'));

      const result = await service.getOneTatoueur('t1');

      expect((result as unknown as { error: boolean }).error).toBe(true);
    });
  });

  describe('updateTatoueur', () => {
    it('updates tatoueur and invalidates cache', async () => {
      prisma.tatoueur.update.mockResolvedValue({
        id: 't1',
        name: 'Updated Name',
        userId: 'u1',
      });

      const result = await service.updateTatoueur(
        't1',
        buildTatoueurDto({ name: 'Updated' }),
      );

      expect(result.error).toBe(false);
      expect(
        (result as unknown as { tatoueur?: { name: string } }).tatoueur?.name,
      ).toBe('Updated Name');
      expect(prisma.tatoueur.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            style: ['REALISTIC'],
          }),
        }),
      );
      expect(cache.del).toHaveBeenCalledWith('tatoueur:t1');
      expect(cache.del).toHaveBeenCalledWith('tatoueurs:all');
      expect(cache.del).toHaveBeenCalledWith('tatoueurs:user:u1');
      expect(cache.del).toHaveBeenCalledWith(
        'tatoueurs:user:u1:appointment-enabled',
      );
    });

    it('returns error on update failure', async () => {
      prisma.tatoueur.update.mockRejectedValue(new Error('boom'));

      const result = await service.updateTatoueur('t1', buildTatoueurDto());

      expect(result.error).toBe(true);
      expect(result.message).toBe('boom');
    });
  });

  describe('deleteTatoueur', () => {
    it('deletes tatoueur and invalidates cache', async () => {
      prisma.tatoueur.delete.mockResolvedValue({
        id: 't1',
        userId: 'u1',
      });

      const result = await service.deleteTatoueur('t1');

      expect(result.error).toBe(false);
      expect(result.message).toBe('Tatoueur supprimé avec succès.');
      expect(cache.del).toHaveBeenCalledWith('tatoueur:t1');
      expect(cache.del).toHaveBeenCalledWith('tatoueurs:all');
      expect(cache.del).toHaveBeenCalledWith('tatoueurs:user:u1');
      expect(cache.del).toHaveBeenCalledWith(
        'tatoueurs:user:u1:appointment-enabled',
      );
    });

    it('returns error on delete failure', async () => {
      prisma.tatoueur.delete.mockRejectedValue(new Error('boom'));

      const result = await service.deleteTatoueur('t1');

      expect(result.error).toBe(true);
      expect(result.message).toBe('boom');
    });
  });
});
