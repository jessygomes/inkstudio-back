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
  tatoueur: {
    findFirst: jest.fn(),
  },
  portfolio: {
    create: jest.fn(),
    count: jest.fn(),
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
  delPattern: jest.fn(),
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
      prisma.tatoueur.findFirst.mockResolvedValue({ id: 'tat1' });
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
      expect(cache.delPattern).toHaveBeenCalledWith('portfolio:photos:u1:*');
    });

    it('returns error message when creation throws', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.tatoueur.findFirst.mockResolvedValue({ id: 'tat1' });
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
      prisma.portfolio.count.mockResolvedValue(2);
      prisma.portfolio.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

      const result = await service.getPortfolioPhotos('u1');

      expect(result.photos).toHaveLength(2);
      expect(cache.set).toHaveBeenCalledWith(
        'portfolio:photos:u1:all:page:1',
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

  describe('getInspirationPortfolioPhotos', () => {
    it('returns cached inspiration photos when present', async () => {
      const cached = { photos: [{ id: 'p1' }], pagination: { page: 1 } };
      cache.get.mockResolvedValue(cached);

      const result = await service.getInspirationPortfolioPhotos({});

      expect(result).toEqual(cached);
      expect(prisma.portfolio.count).not.toHaveBeenCalled();
    });

    it('fetches inspiration photos, caches them, and returns list', async () => {
      cache.get.mockResolvedValue(null);
      prisma.portfolio.count.mockResolvedValue(2);
      prisma.portfolio.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

      const result = await service.getInspirationPortfolioPhotos({
        page: 1,
        limit: 12,
      });

      expect(result.photos).toHaveLength(2);
      expect(prisma.portfolio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user: { isInspirationSalon: true } },
          skip: 0,
          take: 12,
        }),
      );
      expect(cache.set).toHaveBeenCalledWith(
        'portfolio:inspirations:page:1:limit:12:city:all:style:all',
        result,
        900,
      );
    });

    it('filters inspiration photos by city and style', async () => {
      cache.get.mockResolvedValue(null);
      prisma.portfolio.count.mockResolvedValue(1);
      prisma.portfolio.findMany.mockResolvedValue([{ id: 'p1' }]);

      await service.getInspirationPortfolioPhotos({
        page: 1,
        limit: 12,
        city: 'Paris',
        style: 'Fine line,Minimalist',
      });

      expect(prisma.portfolio.count).toHaveBeenCalledWith({
        where: {
          user: {
            isInspirationSalon: true,
            city: {
              contains: 'Paris',
              mode: 'insensitive',
            },
          },
          style: {
            hasSome: ['Fine line', 'Minimalist'],
          },
        },
      });
      expect(prisma.portfolio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: expect.objectContaining({
              city: expect.objectContaining({
                contains: 'Paris',
              }),
            }),
            style: {
              hasSome: ['Fine line', 'Minimalist'],
            },
          }),
          skip: 0,
          take: 12,
        }),
      );
      expect(cache.set).toHaveBeenCalledWith(
        'portfolio:inspirations:page:1:limit:12:city:Paris:style:Fine line|Minimalist',
        expect.objectContaining({ photos: [{ id: 'p1' }] }),
        900,
      );
    });

    it('throws on inspiration retrieval error', async () => {
      cache.get.mockResolvedValue(null);
      prisma.portfolio.count.mockRejectedValue(new Error('db fail'));

      await expect(service.getInspirationPortfolioPhotos({})).rejects.toThrow(
        "Erreur lors de la récupération des images d'inspiration du portfolio",
      );
    });
  });

  describe('updatePortfolioPhoto', () => {
    it('returns error when photo not found', async () => {
      prisma.portfolio.findUnique.mockResolvedValue(null);

      const result = await service.updatePortfolioPhoto(
        'p1',
        { title: 'New' },
        'u1',
      );

      expect(result).toEqual({ error: true, message: 'Photo non trouvée' });
      expect(prisma.portfolio.update).not.toHaveBeenCalled();
    });

    it('updates photo, invalidates cache, and returns payload', async () => {
      prisma.portfolio.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' });
      prisma.portfolio.update.mockResolvedValue({ id: 'p1', title: 'New' });

      const result = await service.updatePortfolioPhoto(
        'p1',
        { title: 'New' },
        'u1',
      );

      expect(result).toEqual({
        error: false,
        message: 'Photo mise à jour avec succès',
        photo: { id: 'p1', title: 'New' },
      });
      expect(cache.delPattern).toHaveBeenCalledWith('portfolio:photos:u1:*');
    });

    it('returns error message when update throws', async () => {
      prisma.portfolio.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' });
      prisma.portfolio.update.mockRejectedValue(new Error('boom'));

      const result = await service.updatePortfolioPhoto(
        'p1',
        { title: 'New' },
        'u1',
      );

      expect(result).toEqual({ error: true, message: 'boom' });
    });
  });

  describe('deletePortfolioPhoto', () => {
    it('throws when photo not found', async () => {
      prisma.portfolio.findUnique.mockResolvedValue(null);

      await expect(service.deletePortfolioPhoto('p1', 'u1')).rejects.toThrow(
        'Photo non trouvée',
      );
    });

    it('deletes photo, invalidates cache, and returns success message', async () => {
      prisma.portfolio.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' });
      prisma.portfolio.delete.mockResolvedValue({});

      const result = await service.deletePortfolioPhoto('p1', 'u1');

      expect(result).toEqual({ message: 'Photo supprimée avec succès' });
      expect(cache.delPattern).toHaveBeenCalledWith('portfolio:photos:u1:*');
    });

    it('throws wrapped error on delete failure', async () => {
      prisma.portfolio.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' });
      prisma.portfolio.delete.mockRejectedValue(new Error('boom'));

      await expect(service.deletePortfolioPhoto('p1', 'u1')).rejects.toThrow(
        'Erreur lors de la suppression de la photo du portfolio',
      );
    });
  });
});
