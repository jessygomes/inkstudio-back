import { Test, TestingModule } from '@nestjs/testing';
import { SalonReviewService } from './salon-review.service';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { CreateSalonReviewDto } from './dto/create-salon-review.dto';

const createPrismaMock = () => ({
  user: {
    findUnique: jest.fn(),
  },
  appointment: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  salonReview: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
});

const createCacheMock = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
});

const buildReviewDto = (
  overrides: Partial<CreateSalonReviewDto> = {},
): CreateSalonReviewDto => ({
  salonId: 'salon1',
  appointmentId: 'apt1',
  rating: 5,
  title: 'Great work',
  comment: 'Excellent service',
  photos: [],
  ...overrides,
});

describe('SalonReviewService', () => {
  let service: SalonReviewService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let cache: ReturnType<typeof createCacheMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    cache = createCacheMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalonReviewService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<SalonReviewService>(SalonReviewService);
    jest.clearAllMocks();
  });

  describe('createReview', () => {
    it('returns error when client not found or not client role', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.createReview(buildReviewDto(), 'client1');

      expect(result).toEqual({
        error: true,
        message: 'Seuls les clients peuvent laisser des avis.',
      });
    });

    it('returns error when salon not found', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'client1', role: 'client' }) // client exists
        .mockResolvedValueOnce(null); // salon not found

      const result = await service.createReview(buildReviewDto(), 'client1');

      expect(result).toEqual({ error: true, message: 'Salon introuvable.' });
    });

    it('returns error when client tries to review themselves', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'client1', role: 'client' })
        .mockResolvedValueOnce({ id: 'client1', role: 'user' }); // same ID

      const result = await service.createReview(
        buildReviewDto({ salonId: 'client1' }),
        'client1',
      );

      expect(result).toEqual({
        error: true,
        message: 'Vous ne pouvez pas laisser un avis sur votre propre profil.',
      });
    });

    it('returns error when no completed appointments found', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'client1', role: 'client' })
        .mockResolvedValueOnce({ id: 'salon1', role: 'user' });
      prisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.createReview(buildReviewDto(), 'client1');

      expect(result).toEqual({
        error: true,
        message:
          'Vous devez avoir au moins un rendez-vous terminé avec ce salon pour laisser un avis.',
      });
    });

    it('returns error when appointment not found', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'client1', role: 'client' })
        .mockResolvedValueOnce({ id: 'salon1', role: 'user' });
      prisma.appointment.findMany.mockResolvedValue([{ id: 'apt1' }]);
      prisma.appointment.findUnique.mockResolvedValue(null);

      const result = await service.createReview(buildReviewDto(), 'client1');

      expect(result).toEqual({
        error: true,
        message: 'Rendez-vous introuvable.',
      });
    });

    it('returns error when existing review for same appointment', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'client1', role: 'client' })
        .mockResolvedValueOnce({ id: 'salon1', role: 'user' });
      prisma.appointment.findMany.mockResolvedValue([{ id: 'apt1' }]);
      prisma.appointment.findUnique.mockResolvedValue({
        id: 'apt1',
        status: 'COMPLETED',
        clientUserId: 'client1',
        userId: 'salon1',
      });
      prisma.salonReview.findUnique.mockResolvedValue({ id: 'review1' });

      const result = await service.createReview(buildReviewDto(), 'client1');

      expect(result).toEqual({
        error: true,
        message: 'Un avis existe déjà pour ce rendez-vous.',
      });
    });

    it('creates review successfully with cache invalidation', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'client1',
          role: 'client',
          firstName: 'John',
          lastName: 'Doe',
        })
        .mockResolvedValueOnce({
          id: 'salon1',
          role: 'user',
          salonName: 'Salon1',
        });
      prisma.appointment.findMany.mockResolvedValue([{ id: 'apt1' }]);
      prisma.appointment.findUnique.mockResolvedValue({
        id: 'apt1',
        status: 'COMPLETED',
        clientUserId: 'client1',
        userId: 'salon1',
      });
      prisma.salonReview.findUnique.mockResolvedValue(null);
      prisma.salonReview.create.mockResolvedValue({
        id: 'review1',
        rating: 5,
        salonId: 'salon1',
      });

      const result = await service.createReview(buildReviewDto(), 'client1');

      expect(result.error).toBe(false);
      expect(
        (result as unknown as { review?: { id: string } }).review?.id,
      ).toBe('review1');
      expect(cache.del).toHaveBeenCalledWith('salon:reviews:salon1');
      expect(cache.delPattern).toHaveBeenCalledWith('salon:reviews:salon1:*');
    });

    it('returns error on create failure', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'client1', role: 'client' })
        .mockResolvedValueOnce({ id: 'salon1', role: 'user' });
      prisma.appointment.findMany.mockResolvedValue([{ id: 'apt1' }]);
      prisma.appointment.findUnique.mockResolvedValue({
        id: 'apt1',
        status: 'COMPLETED',
        clientUserId: 'client1',
        userId: 'salon1',
      });
      prisma.salonReview.findUnique.mockResolvedValue(null);
      prisma.salonReview.create.mockRejectedValue(new Error('boom'));

      const result = await service.createReview(buildReviewDto(), 'client1');

      expect(result).toEqual({
        error: true,
        message: "Une erreur est survenue lors de la création de l'avis.",
      });
    });
  });

  describe('findAllReviewBySalon', () => {
    it('returns cached reviews when present', async () => {
      const cached = { error: false, reviews: [{ id: 'r1' }] };
      cache.get.mockResolvedValue(cached);

      const result = await service.findAllReviewBySalon('salon1', 1, 10);

      expect(result).toEqual(cached);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('returns error when salon not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findAllReviewBySalon('salon1', 1, 10);

      expect(result).toEqual({ error: true, message: 'Salon introuvable.' });
    });

    it('fetches reviews, caches and returns with pagination', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'salon1',
        role: 'user',
        salonName: 'Salon1',
      });
      prisma.$transaction.mockResolvedValue([
        5, // totalReviews count
        [
          {
            id: 'r1',
            rating: 5,
            author: {
              id: 'c1',
              firstName: 'John',
              clientProfile: { pseudo: 'john' },
            },
          },
        ],
        [{ rating: 5, isVerified: true }],
      ]);

      const result = await service.findAllReviewBySalon('salon1', 1, 10);

      expect(result.error).toBe(false);
      expect((result as unknown as { reviews?: any[] }).reviews).toBeDefined();
      expect(
        (result as unknown as { pagination?: any }).pagination,
      ).toBeDefined();
      expect(
        (result as unknown as { statistics?: any }).statistics,
      ).toBeDefined();
      expect(cache.set).toHaveBeenCalled();
    });

    it('handles cache set error gracefully', async () => {
      cache.get.mockResolvedValue(null);
      cache.set.mockRejectedValue(new Error('cache error'));
      prisma.user.findUnique.mockResolvedValue({ id: 'salon1', role: 'user' });
      prisma.$transaction.mockResolvedValue([
        1,
        [],
        [{ rating: 5, isVerified: true }],
      ]);

      const result = await service.findAllReviewBySalon('salon1', 1, 10);

      expect(result.error).toBe(false);
      expect(cache.set).toHaveBeenCalled();
    });

    it('returns error on retrieval failure', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'salon1' });
      prisma.$transaction.mockRejectedValue(new Error('db fail'));

      const result = await service.findAllReviewBySalon('salon1', 1, 10);

      expect(result).toEqual({
        error: true,
        message: 'Une erreur est survenue lors de la récupération des avis.',
      });
    });
  });

  describe('findAllReviewsByClient', () => {
    it('returns cached reviews when present', async () => {
      const cached = { error: false, reviews: [] };
      cache.get.mockResolvedValue(cached);

      const result = await service.findAllReviewsByClient('client1', 1, 10);

      expect(result).toEqual(cached);
    });

    it('returns error when client not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findAllReviewsByClient('client1', 1, 10);

      expect(result).toEqual({ error: true, message: 'Client introuvable.' });
    });

    it('fetches and caches client reviews with pagination', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'client1',
        role: 'client',
      });
      prisma.$transaction.mockResolvedValue([
        3,
        [{ id: 'r1', salon: { id: 's1', salonName: 'Salon1' } }],
        [{ rating: 4, isVerified: true, isVisible: true }],
      ]);

      const result = await service.findAllReviewsByClient('client1', 1, 10);

      expect((result as unknown as { error: boolean }).error).toBe(false);
      expect(cache.set).toHaveBeenCalled();
    });

    it('returns error on retrieval failure', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'client1',
        role: 'client',
      });
      prisma.$transaction.mockRejectedValue(new Error('db fail'));

      const result = await service.findAllReviewsByClient('client1', 1, 10);

      expect(result).toEqual({
        error: true,
        message: 'Une erreur est survenue lors de la récupération des avis.',
      });
    });
  });

  describe('updateReviewVisibility', () => {
    it('returns error when review not found', async () => {
      prisma.salonReview.findUnique.mockResolvedValue(null);

      const result = await service.updateReviewVisibility(
        'review1',
        'salon1',
        true,
      );

      expect(result).toEqual({ error: true, message: 'Avis introuvable.' });
    });

    it('returns error when not authorized (different salon)', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon2',
        authorId: 'client1',
      });

      const result = await service.updateReviewVisibility(
        'review1',
        'salon1',
        true,
      );

      expect(result).toEqual({
        error: true,
        message: "Vous n'êtes pas autorisé à modifier cet avis.",
      });
    });

    it('returns message when no change needed', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon1',
        isVisible: true,
      });

      const result = await service.updateReviewVisibility(
        'review1',
        'salon1',
        true,
      );

      expect(result.error).toBe(false);
      expect((result as unknown as { message: string }).message).toBe(
        'La visibilité est déjà activée.',
      );
    });

    it('updates visibility and invalidates cache', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon1',
        authorId: 'client1',
        isVisible: true,
      });
      prisma.salonReview.update.mockResolvedValue({
        id: 'r1',
        isVisible: false,
      });

      const result = await service.updateReviewVisibility(
        'review1',
        'salon1',
        false,
      );

      expect(result.error).toBe(false);
      expect(cache.del).toHaveBeenCalledWith('salon:reviews:salon1');
      expect(cache.delPattern).toHaveBeenCalledWith('salon:reviews:salon1:*');
    });

    it('returns error on update failure', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon1',
        authorId: 'client1',
        isVisible: true,
      });
      prisma.salonReview.update.mockRejectedValue(new Error('boom'));

      const result = await service.updateReviewVisibility(
        'review1',
        'salon1',
        false,
      );

      expect(result).toEqual({
        error: true,
        message:
          "Une erreur est survenue lors de la mise à jour de la visibilité de l'avis.",
      });
    });
  });

  describe('deleteReviewByClient', () => {
    it('returns error when review not found', async () => {
      prisma.salonReview.findUnique.mockResolvedValue(null);

      const result = await service.deleteReviewByClient('review1', 'client1');

      expect(result).toEqual({ error: true, message: 'Avis introuvable.' });
    });

    it('returns error when not the author', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        authorId: 'client2',
        salonId: 'salon1',
      });

      const result = await service.deleteReviewByClient('review1', 'client1');

      expect(result).toEqual({
        error: true,
        message: "Vous n'êtes pas autorisé à supprimer cet avis.",
      });
    });

    it('deletes review and invalidates cache', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        authorId: 'client1',
        salonId: 'salon1',
      });
      prisma.salonReview.delete.mockResolvedValue({ id: 'r1' });

      const result = await service.deleteReviewByClient('review1', 'client1');

      expect(result).toEqual({
        error: false,
        message: 'Avis supprimé avec succès.',
      });
      expect(cache.del).toHaveBeenCalledWith('salon:reviews:salon1');
      expect(cache.delPattern).toHaveBeenCalled();
    });

    it('returns error on delete failure', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        authorId: 'client1',
        salonId: 'salon1',
      });
      prisma.salonReview.delete.mockRejectedValue(new Error('boom'));

      const result = await service.deleteReviewByClient('review1', 'client1');

      expect(result).toEqual({
        error: true,
        message: "Une erreur est survenue lors de la suppression de l'avis.",
      });
    });
  });

  describe('getRecentReviewsBySalon', () => {
    it('returns cached recent reviews when present', async () => {
      const cached = { error: false, reviews: [] };
      cache.get.mockResolvedValue(cached);

      const result = await service.getRecentReviewsBySalon('salon1', 5);

      expect(result).toEqual(cached);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('returns error when salon not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getRecentReviewsBySalon('salon1', 5);

      expect(result).toEqual({ error: true, message: 'Salon introuvable.' });
    });

    it('fetches recent reviews, caches and returns', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'salon1', role: 'user' });
      prisma.salonReview.findMany.mockResolvedValue([
        {
          id: 'r1',
          rating: 5,
          author: {
            id: 'c1',
            firstName: 'John',
            clientProfile: { pseudo: 'john' },
          },
        },
      ]);

      const result = await service.getRecentReviewsBySalon('salon1', 5);

      expect((result as unknown as { error: boolean }).error).toBe(false);
      expect((result as unknown as { reviews: any[] }).reviews).toBeDefined();
      expect(cache.set).toHaveBeenCalled();
    });

    it('returns error on retrieval failure', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'salon1' });
      prisma.salonReview.findMany.mockRejectedValue(new Error('db fail'));

      const result = await service.getRecentReviewsBySalon('salon1', 5);

      expect(result).toEqual({
        error: true,
        message:
          'Une erreur est survenue lors de la récupération des avis récents.',
      });
    });
  });

  describe('respondToReview', () => {
    it('returns error when review not found', async () => {
      prisma.salonReview.findUnique.mockResolvedValue(null);

      const result = await service.respondToReview(
        'review1',
        'salon1',
        'Thanks!',
      );

      expect(result).toEqual({ error: true, message: 'Avis introuvable.' });
    });

    it('returns error when not authorized', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon2',
        authorId: 'client1',
      });

      const result = await service.respondToReview(
        'review1',
        'salon1',
        'Thanks!',
      );

      expect(result).toEqual({
        error: true,
        message: "Vous n'êtes pas autorisé à répondre à cet avis.",
      });
    });

    it('returns error when response is empty', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon1',
        authorId: 'client1',
      });

      const result = await service.respondToReview('review1', 'salon1', '');

      expect(result).toEqual({
        error: true,
        message: 'La réponse ne peut pas être vide.',
      });
    });

    it('returns error when response too long', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon1',
        authorId: 'client1',
      });

      const longResponse = 'a'.repeat(1001);
      const result = await service.respondToReview(
        'review1',
        'salon1',
        longResponse,
      );

      expect(result).toEqual({
        error: true,
        message: 'La réponse ne peut pas dépasser 1000 caractères.',
      });
    });

    it('adds response and invalidates cache', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon1',
        authorId: 'client1',
        salonResponse: null,
      });
      prisma.salonReview.update.mockResolvedValue({
        id: 'r1',
        salonResponse: 'Thanks for visiting!',
        salonRespondedAt: new Date(),
        author: {
          id: 'c1',
          firstName: 'John',
          clientProfile: { pseudo: 'john' },
        },
      });

      const result = await service.respondToReview(
        'review1',
        'salon1',
        'Thanks for visiting!',
      );

      expect((result as unknown as { error: boolean }).error).toBe(false);
      expect(cache.del).toHaveBeenCalledWith('salon:reviews:salon1');
      expect(cache.delPattern).toHaveBeenCalled();
    });

    it('returns error on update failure', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon1',
        authorId: 'client1',
      });
      prisma.salonReview.update.mockRejectedValue(new Error('boom'));

      const result = await service.respondToReview(
        'review1',
        'salon1',
        'Thanks!',
      );

      expect(result).toEqual({
        error: true,
        message: "Une erreur est survenue lors de l'ajout de la réponse.",
      });
    });
  });

  describe('removeReviewResponse', () => {
    it('returns error when review not found', async () => {
      prisma.salonReview.findUnique.mockResolvedValue(null);

      const result = await service.removeReviewResponse('review1', 'salon1');

      expect(result).toEqual({ error: true, message: 'Avis introuvable.' });
    });

    it('returns error when not authorized', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon2',
        authorId: 'client1',
      });

      const result = await service.removeReviewResponse('review1', 'salon1');

      expect(result).toEqual({
        error: true,
        message: "Vous n'êtes pas autorisé à modifier cet avis.",
      });
    });

    it('returns error when no response to remove', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon1',
        authorId: 'client1',
        salonResponse: null,
      });

      const result = await service.removeReviewResponse('review1', 'salon1');

      expect(result.error).toBe(false);
      expect((result as unknown as { message: string }).message).toBe(
        'Aucune réponse à supprimer.',
      );
    });

    it('removes response and invalidates cache', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon1',
        authorId: 'client1',
        salonResponse: 'Thanks!',
      });
      prisma.salonReview.update.mockResolvedValue({
        id: 'r1',
        salonResponse: null,
        salonRespondedAt: null,
      });

      const result = await service.removeReviewResponse('review1', 'salon1');

      expect((result as unknown as { error: boolean }).error).toBe(false);
      expect((result as unknown as { message: string }).message).toBe(
        'Réponse supprimée avec succès.',
      );
      expect(cache.del).toHaveBeenCalledWith('salon:reviews:salon1');
      expect(cache.delPattern).toHaveBeenCalled();
    });

    it('returns error on delete failure', async () => {
      prisma.salonReview.findUnique.mockResolvedValue({
        id: 'r1',
        salonId: 'salon1',
        authorId: 'client1',
        salonResponse: 'Thanks!',
      });
      prisma.salonReview.update.mockRejectedValue(new Error('boom'));

      const result = await service.removeReviewResponse('review1', 'salon1');

      expect(result).toEqual({
        error: true,
        message:
          'Une erreur est survenue lors de la suppression de la réponse.',
      });
    });
  });
});
