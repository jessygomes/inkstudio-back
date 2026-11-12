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
  flash: {
    count: jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
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

  describe('public linked galleries', () => {
    it('checks visibility in the database even when a salon gallery is cached', async () => {
      cache.get.mockResolvedValue({ photos: [{ id: 'hidden-photo' }] });
      prisma.user.findUnique.mockResolvedValue({ role: 'user_salon', linkedTatoueurs: [{ id: 'hidden-artist', salonName: 'Artist' }] });
      prisma.portfolio.count.mockResolvedValue(0);
      prisma.portfolio.findMany.mockResolvedValue([]);
      const result = await service.getPortfolioPhotos('salon', undefined, 1, 12, {}, true);
      expect(result.photos).toEqual([]);
      expect(prisma.portfolio.count).toHaveBeenCalledWith({ where: { userId: { in: ['salon', 'hidden-artist'] }, user: { publicVisibility: { not: 'HIDDEN' } } } });
    });
    it('uses the linked independent nickname in public photo attribution', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ role: 'user_salon', linkedTatoueurs: [{ id: 'artist', salonName: 'Jean Dupont', nickname: 'Blue Ink' }] });
      prisma.portfolio.count.mockResolvedValue(1);
      prisma.portfolio.findMany.mockResolvedValue([{ id: 'photo', userId: 'artist', tatoueurId: null }]);
      const result = await service.getPortfolioPhotos('salon', undefined, 1, 12, {}, true);
      expect(result.photos[0]).toMatchObject({ tatoueur: { name: 'Blue Ink' } });
    });
  });

  describe('getInspirationPortfolioPhotos', () => {
    it('does not expose stale inspiration photos after a profile is hidden', async () => {
      cache.get.mockResolvedValue({ photos: [{ id: 'hidden-photo' }] });
      prisma.portfolio.count.mockResolvedValue(0);
      prisma.portfolio.findMany.mockResolvedValue([]);
      const result = await service.getInspirationPortfolioPhotos({});
      expect(result.photos).toEqual([]);
      expect(prisma.portfolio.count).toHaveBeenCalledWith({ where: { user: { isInspirationSalon: true, publicVisibility: 'VISIBLE' } } });
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
          where: { user: { isInspirationSalon: true, publicVisibility: 'VISIBLE' } },
          skip: 0,
          take: 12,
        }),
      );
      expect(cache.set).toHaveBeenCalledWith(
        'portfolio:inspirations:page:1:limit:12:city:all:type:all:s:all:h:all:c:all:z:all',
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
            isInspirationSalon: true, publicVisibility: 'VISIBLE',
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
        'portfolio:inspirations:page:1:limit:12:city:Paris:type:all:s:FINE LINE|MINIMALIST:h:all:c:all:z:all',
        expect.objectContaining({ photos: [{ id: 'p1', kind: 'photo' }] }),
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
          user: { isInspirationSalon: true, publicVisibility: 'VISIBLE' },
          hashtags: { hasSome: ['rose', 'floral'] },
          categories: { some: { slug: { in: ['walk-ins'] } } },
          pieceSize: { in: ['SMALL'] },
        },
      });
      // Les flashs n'ont ni hashtags, ni catégories, ni taille de pièce : exclus du fil mélangé quand l'un de ces filtres est actif.
      expect(prisma.flash.count).not.toHaveBeenCalled();
      expect(prisma.flash.findMany).not.toHaveBeenCalled();
    });

    describe('flashs', () => {
      const userRow = { id: 'u1', salonName: 'Studio', nickname: null, publicVisibility: 'VISIBLE', image: null, city: 'Paris', postalCode: '75001', instagram: null, isInspirationSalon: true, saasPlan: 'PRO', role: 'user_salon', profileImage: null, firstName: null, lastName: null, salon: null };
      const photo = (id: string, date: string) => ({ id, title: id, description: 'd', imageUrl: 'i', style: [], pieceSize: null, categories: [], hashtags: [], createdAt: new Date(date), updatedAt: new Date(date), user: userRow, tatoueur: null });
      const flash = (id: string, date: string) => ({ id, title: id, description: null, imageUrl: 'i', style: ['FINE LINE'], dimension: '10 cm', appointmentDurationMinutes: 90, price: 80, isAvailable: true, createdAt: new Date(date), updatedAt: new Date(date), user: userRow, tatoueur: null });

      beforeEach(() => cache.get.mockResolvedValue(null));

      it('mélange photos et flashs par date, avec le prix et la durée des flashs', async () => {
        prisma.portfolio.count.mockResolvedValue(2);
        prisma.portfolio.findMany.mockResolvedValue([photo('p1', '2026-11-10'), photo('p2', '2026-11-01')]);
        prisma.flash.count.mockResolvedValue(1);
        prisma.flash.findMany.mockResolvedValue([flash('f1', '2026-11-05')]);

        const result = await service.getInspirationPortfolioPhotos({ page: 1, limit: 12 });

        expect(result.photos.map((item) => [item.id, item.kind])).toEqual([['p1', 'photo'], ['f1', 'flash'], ['p2', 'photo']]);
        expect(result.photos[1]).toMatchObject({ kind: 'flash', price: 80, appointmentDurationMinutes: 90, dimension: '10 cm', description: '', hashtags: [], categories: [], pieceSize: null });
        expect(result.pagination.total).toBe(3);
        // Seuls les flashs disponibles des profils visibles et inscrits aux inspirations.
        expect(prisma.flash.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: { isAvailable: true, user: { isInspirationSalon: true, publicVisibility: 'VISIBLE' } },
        }));
      });

      it('lit chaque source jusqu\'à la fin de la page demandée puis découpe (page 2)', async () => {
        prisma.portfolio.count.mockResolvedValue(3);
        prisma.portfolio.findMany.mockResolvedValue([photo('p1', '2026-11-10'), photo('p2', '2026-11-08'), photo('p3', '2026-11-02')]);
        prisma.flash.count.mockResolvedValue(2);
        prisma.flash.findMany.mockResolvedValue([flash('f1', '2026-11-09'), flash('f2', '2026-11-01')]);

        const result = await service.getInspirationPortfolioPhotos({ page: 2, limit: 2 });

        // Ordre global : p1, f1, p2, p3, f2 → la page 2 (taille 2) contient p2 et p3.
        expect(result.photos.map((item) => item.id)).toEqual(['p2', 'p3']);
        expect(prisma.portfolio.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 4 }));
        expect(prisma.flash.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 4 }));
        expect(result.pagination).toMatchObject({ page: 2, total: 5, totalPages: 3, hasNextPage: true });
      });

      it('type=flash : uniquement les flashs, hashtags / catégories / taille ignorés, style appliqué', async () => {
        prisma.flash.count.mockResolvedValue(1);
        prisma.flash.findMany.mockResolvedValue([flash('f1', '2026-11-05')]);

        const result = await service.getInspirationPortfolioPhotos({ type: 'flash', hashtag: 'rose', category: 'x', pieceSize: 'small', style: 'Fine line', city: 'Paris' });

        expect(prisma.portfolio.count).not.toHaveBeenCalled();
        expect(prisma.portfolio.findMany).not.toHaveBeenCalled();
        expect(result.photos.map((item) => item.id)).toEqual(['f1']);
        expect(prisma.flash.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: { isAvailable: true, user: { isInspirationSalon: true, publicVisibility: 'VISIBLE', city: { contains: 'Paris', mode: 'insensitive' } }, style: { hasSome: ['FINE LINE'] } },
          skip: 0,
          take: 12,
        }));
        expect(cache.set).toHaveBeenCalledWith(expect.stringContaining(':type:flash:'), expect.anything(), 900);
      });

      it('type=photos : aucun flash', async () => {
        prisma.portfolio.count.mockResolvedValue(1);
        prisma.portfolio.findMany.mockResolvedValue([photo('p1', '2026-11-10')]);

        const result = await service.getInspirationPortfolioPhotos({ type: 'photos' });

        expect(prisma.flash.count).not.toHaveBeenCalled();
        expect(prisma.flash.findMany).not.toHaveBeenCalled();
        expect(result.photos.map((item) => item.kind)).toEqual(['photo']);
      });

      it('une valeur de type inconnue revient au fil mélangé', async () => {
        prisma.portfolio.count.mockResolvedValue(0);
        prisma.portfolio.findMany.mockResolvedValue([]);
        await service.getInspirationPortfolioPhotos({ type: 'n-importe-quoi' });
        expect(prisma.portfolio.count).toHaveBeenCalled();
        expect(prisma.flash.count).toHaveBeenCalled();
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
