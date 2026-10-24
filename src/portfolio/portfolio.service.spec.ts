/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioService } from './portfolio.service';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { AddPhotoDto } from './dto/add-photo.dto';

const createPrismaMock = () => ({
  appointmentPhoto: { findUnique: jest.fn() },
  style: {
    findMany: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve(create)),
  },
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

const buildPhotoDto = (overrides: Partial<AddPhotoDto> = {}): AddPhotoDto => ({
  title: 'T1',
  imageUrl: 'http://img',
  description: 'desc',
  tatoueurId: 'tat1',
  style: ['Fine line'],
  ...overrides,
});

describe('PortfolioService', () => {
  let service: PortfolioService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let cache: ReturnType<typeof createCacheMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    cache = createCacheMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
    jest.clearAllMocks();
  });

  describe('addPhotoToPortfolio', () => {
    it('rejects a source photo from another salon before creating a portfolio item', async () => {
      prisma.appointmentPhoto.findUnique.mockResolvedValue({ url: 'https://source.test/photo.jpg', appointment: { userId: 'other', performerUserId: null } });
      const result = await service.addPhotoToPortfolio({ userId: 'u1', portfolioBody: buildPhotoDto({ appointmentPhotoId: 'source' }) });
      expect(result.error).toBe(true);
      expect(prisma.portfolio.create).not.toHaveBeenCalled();
    });

    it('uses the stored source URL when adding an appointment photo to the portfolio', async () => {
      prisma.appointmentPhoto.findUnique.mockResolvedValue({ url: 'https://source.test/photo.jpg', appointment: { userId: 'u1', performerUserId: null } });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.tatoueur.findFirst.mockResolvedValue({ id: 'tat1' });
      prisma.portfolio.create.mockResolvedValue({ id: 'p1' });
      await service.addPhotoToPortfolio({ userId: 'u1', portfolioBody: buildPhotoDto({ appointmentPhotoId: 'source', imageUrl: 'https://other.test/image.jpg' }) });
      expect(prisma.portfolio.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ imageUrl: 'https://source.test/photo.jpg', appointmentPhotoId: 'source' }) }));
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
          style: ['FINE LINE'],
        }),
        include: { categories: true },
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
      prisma.user.findUnique.mockResolvedValue({
        role: 'user',
        linkedTatoueurs: [],
      });
      prisma.portfolio.count.mockResolvedValue(2);
      prisma.portfolio.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

      const result = await service.getPortfolioPhotos('u1');

      expect(result.photos).toHaveLength(2);
      expect(cache.set).toHaveBeenCalledWith(
        'portfolio:photos:u1:all:page:1:limit:all:s:all:h:all:c:all:z:all',
        result,
        900,
      );
    });

    it('includes linked user_tatoueur portfolios for a user_salon', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        role: 'user_salon',
        linkedTatoueurs: [
          { id: 'tat-user-1', salonName: 'INK ONE' },
          { id: 'tat-user-2', salonName: 'INK TWO' },
        ],
      });
      prisma.portfolio.count.mockResolvedValue(3);
      prisma.portfolio.findMany.mockResolvedValue([
        { id: 'p-salon' },
        { id: 'p-tat-1' },
        { id: 'p-tat-2' },
      ]);

      const result = await service.getPortfolioPhotos('salon-1');

      expect(result.photos).toHaveLength(3);
      expect(prisma.portfolio.count).toHaveBeenCalledWith({
        where: {
          userId: { in: ['salon-1', 'tat-user-1', 'tat-user-2'] },
        },
      });
      expect(prisma.portfolio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: { in: ['salon-1', 'tat-user-1', 'tat-user-2'] },
          },
        }),
      );
    });

    it('adds fallback tatoueur using linked user salonName when missing', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        role: 'user_salon',
        linkedTatoueurs: [{ id: 'tat-user-1', salonName: 'INK MASTER' }],
      });
      prisma.portfolio.count.mockResolvedValue(1);
      prisma.portfolio.findMany.mockResolvedValue([
        {
          id: 'p-tat-1',
          userId: 'tat-user-1',
          tatoueurId: null,
          title: 'Flash',
          imageUrl: 'http://img',
          description: 'desc',
        },
      ]);

      const result = await service.getPortfolioPhotos('salon-1');

      expect(result.photos).toHaveLength(1);
      expect(
        (result.photos[0] as { tatoueur?: { name: string } }).tatoueur?.name,
      ).toBe('INK MASTER');
      expect(
        (result.photos[0] as { tatoueur?: { linkedUserId: string } }).tatoueur
          ?.linkedUserId,
      ).toBe('tat-user-1');
    });

    it('filters photos by linked tatoueur id when tatoueurId is a linked identifier', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        role: 'user_salon',
        linkedTatoueurs: [{ id: 'tat-user-1', salonName: 'INK MASTER' }],
      });
      prisma.portfolio.count.mockResolvedValue(1);
      prisma.portfolio.findMany.mockResolvedValue([
        { id: 'p-linked-1', userId: 'tat-user-1', tatoueurId: null },
      ]);

      await service.getPortfolioPhotos('salon-1', 'linked_tat-user-1');

      expect(prisma.portfolio.count).toHaveBeenCalledWith({
        where: {
          userId: 'tat-user-1',
        },
      });
      expect(prisma.portfolio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'tat-user-1',
          },
        }),
      );
    });

    it('throws on retrieval error', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        role: 'user',
        linkedTatoueurs: [],
      });
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
        'portfolio:inspirations:page:1:limit:12:city:all:s:all:h:all:c:all:z:all',
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
            hasSome: ['FINE LINE', 'MINIMALIST'],
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
              hasSome: ['FINE LINE', 'MINIMALIST'],
            },
          }),
          skip: 0,
          take: 12,
        }),
      );
      expect(cache.set).toHaveBeenCalledWith(
        'portfolio:inspirations:page:1:limit:12:city:Paris:s:FINE LINE|MINIMALIST:h:all:c:all:z:all',
        expect.objectContaining({ photos: [{ id: 'p1' }] }),
        900,
      );
    });

    it('filters inspiration photos by category, hashtag and piece size', async () => {
      cache.get.mockResolvedValue(null);
      prisma.portfolio.count.mockResolvedValue(0);
      prisma.portfolio.findMany.mockResolvedValue([]);

      await service.getInspirationPortfolioPhotos({
        hashtag: '#Rose,floral',
        category: 'Walk-ins',
        pieceSize: 'small,bogus',
      });

      expect(prisma.portfolio.count).toHaveBeenCalledWith({
        where: {
          user: { isInspirationSalon: true },
          hashtags: { hasSome: ['rose', 'floral'] },
          categories: { some: { slug: { in: ['walk-ins'] } } },
          pieceSize: { in: ['SMALL'] },
        },
      });
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

    it('normalizes style before updating photo', async () => {
      prisma.portfolio.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' });
      prisma.portfolio.update.mockResolvedValue({
        id: 'p1',
        style: ['Fine line', 'Blackwork'],
      });

      await service.updatePortfolioPhoto(
        'p1',
        { style: [' Fine line ', '', 'Blackwork', 'Fine line'] },
        'u1',
      );

      expect(prisma.portfolio.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: {
          style: ['FINE LINE', 'BLACKWORK'],
        },
        include: { categories: true },
      });
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

  describe('style registry', () => {
    const known = [
      { name: 'FINELINE', key: 'fineline' },
      { name: 'BLACKWORK', key: 'blackwork' },
    ];

    const addWithStyles = async (style: string[]) => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.portfolio.create.mockResolvedValue({ id: 'p1' });
      await service.addPhotoToPortfolio({
        userId: 'u1',
        portfolioBody: buildPhotoDto({ style, tatoueurId: undefined }),
      });
      return prisma.portfolio.create.mock.calls[0][0].data.style;
    };

    it('reuses an existing style when the spelling is a close typo', async () => {
      prisma.style.findMany.mockResolvedValue(known);

      expect(await addWithStyles(['fineeline', 'Fine-Line'])).toEqual(['FINELINE']);
      expect(prisma.style.upsert).not.toHaveBeenCalled();
    });

    it('creates a style that has no close match', async () => {
      prisma.style.findMany.mockResolvedValue(known);

      expect(await addWithStyles(['Réalisme'])).toEqual(['RÉALISME']);
      expect(prisma.style.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'realisme' } }),
      );
    });

    it('suggests matching styles and flags when creation is allowed', async () => {
      prisma.style.findMany.mockResolvedValue(known);

      const result = await service.suggestStyles('fi');
      expect(result.suggestions).toEqual(['FINELINE']);
      expect(result.canCreate).toBe(true);

      const typo = await service.suggestStyles('fineeline');
      expect(typo.canCreate).toBe(false);
      expect(typo).toMatchObject({ didYouMean: 'FINELINE' });
    });

    it('lists all styles without userId', async () => {
      prisma.style.findMany.mockResolvedValue([{ name: 'BLACKWORK' }]);

      expect(await service.getStyles()).toEqual({ error: false, styles: [{ name: 'BLACKWORK' }] });
    });

    it('lists only styles present in a portfolio with counts', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'user', linkedTatoueurs: [] });
      prisma.portfolio.findMany.mockResolvedValue([
        { style: ['FINELINE', 'BLACKWORK'] },
        { style: ['FINELINE'] },
      ]);

      expect(await service.getStyles({ userId: 'u1' })).toEqual({
        error: false,
        styles: [
          { name: 'BLACKWORK', count: 1 },
          { name: 'FINELINE', count: 2 },
        ],
      });
    });
  });
});
