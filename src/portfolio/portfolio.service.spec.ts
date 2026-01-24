/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioService } from './portfolio.service';
import { PrismaService } from 'src/database/prisma.service';
import { SaasService } from 'src/saas/saas.service';
import { CacheService } from 'src/redis/cache.service';
import { AddPhotoDto } from './dto/add-photo.dto';

const createPrismaMock = () => ({
  user: {
    findUnique: jest.fn(),
  },
  portfolio: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
});

const createCacheMock = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
});

const createSaasMock = () => ({
  canPerformAction: jest.fn(() => Promise.resolve(true)),
  checkLimits: jest.fn(() =>
    Promise.resolve({ limits: { portfolioImages: 5 } }),
  ),
});

const buildPhotoDto = (overrides: Partial<AddPhotoDto> = {}): AddPhotoDto => ({
  title: 'T1',
  imageUrl: 'http://img',
  description: 'desc',
  tatoueurId: 'tat1',
  ...overrides,
});

describe('PortfolioService', () => {
  let service: PortfolioService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let cache: ReturnType<typeof createCacheMock>;
  let saas: ReturnType<typeof createSaasMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    cache = createCacheMock();
    saas = createSaasMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        { provide: PrismaService, useValue: prisma },
        { provide: SaasService, useValue: saas },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
    jest.clearAllMocks();
  });

  describe('addPhotoToPortfolio', () => {
    it('returns error when SaaS limit reached', async () => {
      saas.canPerformAction.mockResolvedValue(false);
      saas.checkLimits.mockResolvedValue({ limits: { portfolioImages: 3 } });

      const result = await service.addPhotoToPortfolio({
        userId: 'u1',
        portfolioBody: buildPhotoDto(),
      });

      expect(result).toEqual({
        error: true,
        message:
          "Limite d'images portfolio atteinte (3). Passez au plan PRO ou BUSINESS pour continuer.",
      });
      expect(prisma.portfolio.create).not.toHaveBeenCalled();
    });

    it('returns error when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.addPhotoToPortfolio({
        userId: 'u1',
        portfolioBody: buildPhotoDto(),
      });

      expect(result).toEqual({
        error: true,
        message: 'Utilisateur non trouvé',
      });
      expect(prisma.portfolio.create).not.toHaveBeenCalled();
    });

    it('creates photo, invalidates cache, returns payload', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.portfolio.create.mockResolvedValue({ id: 'p1', userId: 'u1' });

      const result = await service.addPhotoToPortfolio({
        userId: 'u1',
        portfolioBody: buildPhotoDto(),
      });

      expect(result).toMatchObject({ error: false, photo: { id: 'p1' } });
      expect(prisma.portfolio.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          title: 'T1',
          imageUrl: 'http://img',
        }),
      });
      expect(cache.del).toHaveBeenCalledWith('portfolio:photos:u1');
    });

    it('returns error message when creation throws', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.portfolio.create.mockRejectedValue(new Error('boom'));

      const result = await service.addPhotoToPortfolio({
        userId: 'u1',
        portfolioBody: buildPhotoDto(),
      });

      expect(result).toEqual({ error: true, message: 'boom' });
    });
  });

  describe('getPortfolioPhotos', () => {
    it('returns cached photos when present', async () => {
      const cached = [{ id: 'p1' }];
      cache.get.mockResolvedValue(cached);

      const result = await service.getPortfolioPhotos('u1');

      expect(result).toEqual(cached);
      expect(prisma.portfolio.findMany).not.toHaveBeenCalled();
    });

    it('fetches photos, caches them, and returns list', async () => {
      cache.get.mockResolvedValue(null);
      prisma.portfolio.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

      const result = await service.getPortfolioPhotos('u1');

      expect(result).toHaveLength(2);
      expect(cache.set).toHaveBeenCalledWith(
        'portfolio:photos:u1',
        result,
        900,
      );
    });

    it('throws on retrieval error', async () => {
      cache.get.mockResolvedValue(null);
      prisma.portfolio.findMany.mockRejectedValue(new Error('db fail'));

      await expect(service.getPortfolioPhotos('u1')).rejects.toThrow(
        'Erreur lors de la récupération des photos du portfolio',
      );
    });
  });

  describe('updatePortfolioPhoto', () => {
    it('returns error when photo not found', async () => {
      prisma.portfolio.findUnique.mockResolvedValue(null);

      const result = await service.updatePortfolioPhoto('p1', { title: 'New' });

      expect(result).toEqual({ error: true, message: 'Photo non trouvée' });
      expect(prisma.portfolio.update).not.toHaveBeenCalled();
    });

    it('updates photo, invalidates cache, and returns payload', async () => {
      prisma.portfolio.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' });
      prisma.portfolio.update.mockResolvedValue({ id: 'p1', title: 'New' });

      const result = await service.updatePortfolioPhoto('p1', { title: 'New' });

      expect(result).toEqual({
        error: false,
        message: 'Photo mise à jour avec succès',
        photo: { id: 'p1', title: 'New' },
      });
      expect(cache.del).toHaveBeenCalledWith('portfolio:photos:u1');
    });

    it('returns error message when update throws', async () => {
      prisma.portfolio.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' });
      prisma.portfolio.update.mockRejectedValue(new Error('boom'));

      const result = await service.updatePortfolioPhoto('p1', { title: 'New' });

      expect(result).toEqual({ error: true, message: 'boom' });
    });
  });

  describe('deletePortfolioPhoto', () => {
    it('throws when photo not found', async () => {
      prisma.portfolio.findUnique.mockResolvedValue(null);

      await expect(service.deletePortfolioPhoto('p1')).rejects.toThrow(
        'Photo non trouvée',
      );
    });

    it('deletes photo, invalidates cache, and returns success message', async () => {
      prisma.portfolio.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' });
      prisma.portfolio.delete.mockResolvedValue({});

      const result = await service.deletePortfolioPhoto('p1');

      expect(result).toEqual({ message: 'Photo supprimée avec succès' });
      expect(cache.del).toHaveBeenCalledWith('portfolio:photos:u1');
    });

    it('throws wrapped error on delete failure', async () => {
      prisma.portfolio.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' });
      prisma.portfolio.delete.mockRejectedValue(new Error('boom'));

      await expect(service.deletePortfolioPhoto('p1')).rejects.toThrow(
        'Erreur lors de la suppression de la photo du portfolio',
      );
    });
  });
});
