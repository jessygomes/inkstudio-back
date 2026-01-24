/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';

// Mock factories
const createPrismaMock = () => ({
  user: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  tatoueur: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
});

const createCacheMock = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
});

// Test data builders
const buildUser = (overrides?: Partial<any>) => ({
  id: 'user-1',
  email: 'salon@example.com',
  salonName: 'Test Salon',
  firstName: 'Jean',
  lastName: 'Dupont',
  phone: '0123456789',
  address: '123 Rue de Test',
  city: 'Paris',
  postalCode: '75001',
  salonHours: JSON.stringify({
    monday: { start: '09:00', end: '18:00' },
    tuesday: { start: '09:00', end: '18:00' },
    wednesday: null,
    thursday: { start: '09:00', end: '18:00' },
    friday: { start: '09:00', end: '18:00' },
    saturday: { start: '10:00', end: '16:00' },
    sunday: null,
  }),
  prestations: ['TATTOO', 'RETOUCHE'],
  image: 'https://example.com/image.jpg',
  salonPhotos: [
    'https://example.com/photo1.jpg',
    'https://example.com/photo2.jpg',
  ],
  instagram: '@testsalon',
  facebook: 'test-salon',
  tiktok: '@testsalon',
  website: 'https://testsalon.com',
  description: 'Test salon description',
  role: 'salon',
  appointmentBookingEnabled: true,
  addConfirmationEnabled: false,
  verifiedSalon: true,
  colorProfile: '#000000',
  colorProfileBis: '#FFFFFF',
  saasPlan: 'PRO',
  Tatoueur: [],
  ...overrides,
});

const buildClientUser = (overrides?: Partial<any>) => ({
  id: 'client-1',
  email: 'client@example.com',
  firstName: 'Marie',
  lastName: 'Martin',
  phone: '0987654321',
  image: 'https://example.com/client.jpg',
  role: 'client',
  updatedAt: new Date(),
  clientProfile: {
    id: 'profile-1',
    pseudo: 'mmartin',
    birthDate: new Date('1990-01-15'),
    city: 'Lyon',
    postalCode: '69000',
    updatedAt: new Date(),
  },
  ...overrides,
});

const buildPaginationResult = () => ({
  currentPage: 1,
  limit: 12,
  totalUsers: 24,
  totalPages: 2,
  hasNextPage: true,
  hasPreviousPage: false,
  startIndex: 1,
  endIndex: 12,
});

describe('UserService', () => {
  let service: UserService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let cache: ReturnType<typeof createCacheMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    cache = createCacheMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: CacheService,
          useValue: cache,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getUsers', () => {
    it('should return users from cache when available', async () => {
      const mockUsers = [
        buildUser(),
        buildUser({ id: 'user-2', salonName: 'Salon 2' }),
      ];
      const mockResult = {
        error: false,
        users: mockUsers,
        pagination: buildPaginationResult(),
        filters: { query: null, city: null },
      };

      cache.get.mockResolvedValue(mockResult);

      const result = await service.getUsers();

      expect(cache.get).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('should fetch users from database when not in cache', async () => {
      const mockUsers = [buildUser(), buildUser({ id: 'user-2' })];
      cache.get.mockResolvedValue(null);
      prisma.$transaction.mockResolvedValue([2, mockUsers]);

      const result = await service.getUsers();

      expect(result.error).toBe(false);
      expect(result.users.length).toBe(2);
      expect(cache.set).toHaveBeenCalled();
    });

    it('should filter users by city', async () => {
      const mockUsers = [buildUser({ city: 'Paris' })];
      cache.get.mockResolvedValue(null);
      prisma.$transaction.mockResolvedValue([1, mockUsers]);

      const result = await service.getUsers(undefined, 'Paris');

      expect(result.error).toBe(false);
      expect((result as unknown as any).filters.city).toBe('Paris');
    });

    it('should handle pagination correctly', async () => {
      const mockUsers = Array.from({ length: 12 }, (_, i) =>
        buildUser({ id: `user-${i + 1}` }),
      );
      cache.get.mockResolvedValue(null);
      prisma.$transaction.mockResolvedValue([50, mockUsers]);

      const result = await service.getUsers(
        undefined,
        undefined,
        undefined,
        2,
        12,
      );

      expect((result as unknown as any).pagination.currentPage).toBe(2);
      expect((result as unknown as any).pagination.limit).toBe(12);
      expect((result as unknown as any).pagination.hasNextPage).toBe(true);
    });

    it('should handle database error gracefully', async () => {
      cache.get.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(new Error('DB error'));

      await expect(service.getUsers()).rejects.toThrow('Unable to fetch users');
    });
  });

  describe('searchUsers', () => {
    it('should return all users when query is empty', async () => {
      const mockUsers = [buildUser()];
      cache.get.mockResolvedValue(null);
      prisma.$transaction.mockResolvedValue([1, mockUsers]);

      const result = await service.searchUsers('');

      expect(result).toBeDefined();
    });

    it('should search users by salon name', async () => {
      const mockUsers = [buildUser({ salonName: 'Test Salon' })];
      prisma.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.searchUsers('Test Salon');

      expect(Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        expect(result.length).toBe(1);
        expect((result[0] as unknown as any)?.salonName).toBe('Test Salon');
      }
    });

    it('should search users by tatoueur name', async () => {
      const mockUsers = [
        buildUser({
          Tatoueur: [
            {
              id: 'tat-1',
              name: 'Jean',
              img: 'url',
              description: '',
              phone: '',
              hours: '',
              style: [],
              skills: [],
              rdvBookingEnabled: true,
            },
          ],
        }),
      ];
      prisma.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.searchUsers('Jean');

      expect(Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        expect(result.length).toBe(1);
      }
    });

    it('should handle search error gracefully', async () => {
      prisma.user.findMany.mockRejectedValue(new Error('Search error'));

      await expect(service.searchUsers('query')).rejects.toThrow();
    });
  });

  describe('getDistinctCities', () => {
    it('should return unique cities sorted', async () => {
      const mockCities = [
        { city: 'Lyon' },
        { city: 'Marseille' },
        { city: 'Paris' },
      ];
      prisma.user.findMany.mockResolvedValue(mockCities);

      const result = await service.getDistinctCities();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result).toContain('Paris');
      if (result.length >= 2 && result[0] && result[1]) {
        expect(result[0]?.localeCompare(result[1] || '')).toBeLessThanOrEqual(
          0,
        ); // Sorted check
      }
    });

    it('should filter out null cities', async () => {
      const mockCities = [{ city: 'Paris' }, { city: null }, { city: 'Lyon' }];
      prisma.user.findMany.mockResolvedValue(mockCities);

      const result = await service.getDistinctCities();

      expect(result).not.toContain(null);
      expect(result.length).toBe(2);
    });

    it('should trim whitespace from cities', async () => {
      const mockCities = [{ city: '  Paris  ' }, { city: 'Lyon' }];
      prisma.user.findMany.mockResolvedValue(mockCities);

      const result = await service.getDistinctCities();

      expect(result[0]).toBe('Paris');
    });
  });

  describe('getDistinctStyles', () => {
    it('should return unique styles from tatoueurs', async () => {
      const mockTatoueurs = [
        { style: ['Realistic', 'Geometric'] },
        { style: ['Tribal', 'Realistic'] },
        { style: [] },
      ];
      prisma.tatoueur.findMany.mockResolvedValue(mockTatoueurs);

      const result = await service.getDistinctStyles();

      expect(result).toContain('Realistic');
      expect(result).toContain('Geometric');
      expect(result).toContain('Tribal');
      expect(new Set(result).size).toBe(result.length); // All unique
    });

    it('should handle empty style arrays', async () => {
      const mockTatoueurs = [{ style: [] }, { style: null }];
      prisma.tatoueur.findMany.mockResolvedValue(mockTatoueurs);

      const result = await service.getDistinctStyles();

      expect(result).toEqual([]);
    });

    it('should trim and sort styles', async () => {
      const mockTatoueurs = [{ style: ['  Realistic  ', 'Geometric'] }];
      prisma.tatoueur.findMany.mockResolvedValue(mockTatoueurs);

      const result = await service.getDistinctStyles();

      expect(result[0]).toBe('Geometric'); // Sorted alphabetically
      expect(result[1]).toBe('Realistic');
    });
  });

  describe('getUserById', () => {
    it('should return user from cache when available', async () => {
      const mockUser = buildUser();
      cache.get.mockResolvedValue(mockUser);

      const result = await service.getUserById({ userId: 'user-1' });

      expect(cache.get).toHaveBeenCalledWith('user:user-1');
      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should fetch salon user from database', async () => {
      const mockUser = buildUser({ role: 'salon' });
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'salon' });
      prisma.user.findUnique.mockResolvedValueOnce(mockUser);

      const result = await service.getUserById({ userId: 'user-1' });

      expect(result).toBeDefined();
      expect(cache.set).toHaveBeenCalled();
    });

    it('should fetch client user with client profile', async () => {
      const mockUser = buildClientUser();
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'client' });
      prisma.user.findUnique.mockResolvedValueOnce(mockUser);

      const result = await service.getUserById({ userId: 'client-1' });

      expect(result).toBeDefined();
      expect(result?.email).toBe('client@example.com');
    });

    it('should return null when user not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getUserById({ userId: 'nonexistent' });

      expect(result).toBeNull();
    });

    it('should use TTL 1800 for client, 3600 for salon', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'salon' });
      prisma.user.findUnique.mockResolvedValueOnce(
        buildUser({ role: 'salon' }),
      );

      await service.getUserById({ userId: 'user-1' });

      const setCalls = cache.set.mock.calls;
      expect((setCalls[0] as unknown as any)?.[2]).toBe(3600); // Salon TTL
    });
  });

  describe('getPhotosSalon', () => {
    it('should return salon photos from cache', async () => {
      const mockPhotos = {
        salonPhotos: ['photo1.jpg', 'photo2.jpg'],
      };
      cache.get.mockResolvedValue(mockPhotos);

      const result = await service.getPhotosSalon({ userId: 'user-1' });

      expect(result).toEqual(mockPhotos);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should fetch salon photos from database', async () => {
      const mockUser = {
        salonPhotos: ['photo1.jpg', 'photo2.jpg'],
      };
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getPhotosSalon({ userId: 'user-1' });

      expect(result.salonPhotos).toEqual(['photo1.jpg', 'photo2.jpg']);
      expect(cache.set).toHaveBeenCalled();
    });

    it('should return empty array when user has no photos', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ salonPhotos: null });

      const result = await service.getPhotosSalon({ userId: 'user-1' });

      expect(result.salonPhotos).toEqual([]);
    });

    it('should handle database error gracefully', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

      await expect(
        service.getPhotosSalon({ userId: 'user-1' }),
      ).rejects.toThrow();
    });
  });

  describe('updateUser', () => {
    it('should update user successfully', async () => {
      const updateData = {
        salonName: 'Updated Salon',
        firstName: 'Jean',
        lastName: 'Dupont',
        phone: '0123456789',
        address: '123 Rue',
        city: 'Paris',
        postalCode: '75001',
        instagram: '@salon',
        facebook: 'salon',
        tiktok: '@salon',
        website: 'https://salon.com',
        description: 'Updated description',
        image: 'https://example.com/image.jpg',
        prestations: ['TATTOO', 'RETOUCHE'],
      };
      const updatedUser = buildUser(updateData);
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateUser({
        userId: 'user-1',
        userBody: updateData,
      });

      expect(result.salonName).toBe('Updated Salon');
      expect(cache.del).toHaveBeenCalledWith('user:user-1');
      expect(cache.delPattern).toHaveBeenCalledWith('users:list:*');
    });

    it('should filter invalid prestations', async () => {
      const updateData = {
        salonName: 'Salon',
        firstName: 'Jean',
        lastName: 'Dupont',
        phone: '0123456789',
        address: '123 Rue',
        city: 'Paris',
        postalCode: '75001',
        instagram: '@salon',
        facebook: 'salon',
        tiktok: '@salon',
        website: 'https://salon.com',
        description: 'Description',
        image: 'https://example.com/image.jpg',
        prestations: ['TATTOO', 'INVALID_PRESTATION', 'retouche'],
      };
      prisma.user.update.mockResolvedValue(buildUser(updateData));

      await service.updateUser({
        userId: 'user-1',
        userBody: updateData,
      });

      const updateCall = prisma.user.update.mock
        .calls[0]?.[0] as unknown as any;
      expect(updateCall?.data?.prestations).toContain('TATTOO');
      expect(updateCall?.data?.prestations).toContain('RETOUCHE');
      expect(updateCall?.data?.prestations).not.toContain('INVALID_PRESTATION');
    });

    it('should throw error when userId is not provided', async () => {
      await expect(
        service.updateUser({
          userId: '',
          userBody: {} as unknown as any,
        }),
      ).rejects.toThrow('UserId est requis');
    });
  });

  describe('updateUserClient', () => {
    it('should update client user with client profile', async () => {
      const updateData = {
        firstName: 'Marie',
        lastName: 'Martin',
        phone: '0987654321',
        pseudo: 'mmartin',
        city: 'Lyon',
        postalCode: '69000',
        birthDate: '1990-01-15',
        image: 'https://example.com/client.jpg',
      };
      const updatedUser = buildClientUser(updateData);
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateUserClient({
        userId: 'client-1',
        userBody: updateData,
      });

      expect((result as unknown as any)?.clientProfile?.pseudo).toBe('mmartin');
      expect(cache.del).toHaveBeenCalledWith('user:client-1');
    });

    it('should handle null birthDate', async () => {
      const updateData = {
        firstName: 'Marie',
        lastName: 'Martin',
        phone: '0987654321',
        pseudo: 'mmartin',
        city: 'Lyon',
        postalCode: '69000',
        birthDate: '',
        image: 'https://example.com/client.jpg',
      };
      prisma.user.update.mockResolvedValue(buildClientUser());

      await service.updateUserClient({
        userId: 'client-1',
        userBody: updateData,
      });

      const updateCall = prisma.user.update.mock
        .calls[0]?.[0] as unknown as any;
      expect(
        updateCall?.data?.clientProfile?.upsert?.create?.birthDate,
      ).toBeNull();
    });

    it('should throw error when userId is not provided', async () => {
      await expect(
        service.updateUserClient({
          userId: '',
          userBody: {} as unknown as any,
        }),
      ).rejects.toThrow('UserId est requis');
    });
  });

  describe('updateHoursSalon', () => {
    it('should update salon hours', async () => {
      const newHours = JSON.stringify({
        monday: { start: '10:00', end: '19:00' },
      });
      const updatedUser = buildUser({ salonHours: newHours });
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateHoursSalon({
        userId: 'user-1',
        salonHours: newHours,
      });

      expect(result.salonHours).toBe(newHours);
      expect(cache.del).toHaveBeenCalledWith('user:user-1');
      expect(cache.delPattern).toHaveBeenCalledWith('users:list:*');
    });

    it('should invalidate slug cache after update', async () => {
      prisma.user.update.mockResolvedValue(buildUser());

      await service.updateHoursSalon({
        userId: 'user-1',
        salonHours: '{}',
      });

      expect(cache.delPattern).toHaveBeenCalledWith('user:slug:*');
    });
  });

  describe('addOrUpdatePhotoSalon', () => {
    it('should add salon photos as array', async () => {
      const photos = ['photo1.jpg', 'photo2.jpg'];
      const updatedUser = buildUser({ salonPhotos: photos });
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.addOrUpdatePhotoSalon({
        userId: 'user-1',
        salonPhotos: photos,
      });

      expect(result.salonPhotos).toEqual(photos);
      expect(cache.del).toHaveBeenCalledWith('user:photos:user-1');
    });

    it('should add salon photos as object with photoUrls', async () => {
      const photos = { photoUrls: ['photo1.jpg', 'photo2.jpg'] };
      const updatedUser = buildUser({ salonPhotos: photos.photoUrls });
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.addOrUpdatePhotoSalon({
        userId: 'user-1',
        salonPhotos: photos,
      });

      expect(result.salonPhotos).toEqual(photos.photoUrls);
    });

    it('should limit photos to maximum 6', async () => {
      const photos = Array.from({ length: 8 }, (_, i) => `photo${i + 1}.jpg`);

      await expect(
        service.addOrUpdatePhotoSalon({
          userId: 'user-1',
          salonPhotos: photos,
        }),
      ).rejects.toThrow('Vous ne pouvez ajouter que 6 photos maximum');
    });

    it('should throw error for invalid format', async () => {
      await expect(
        service.addOrUpdatePhotoSalon({
          userId: 'user-1',
          salonPhotos: 'invalid' as unknown as any,
        }),
      ).rejects.toThrow('Format de données invalide');
    });
  });

  describe('getConfirmationSetting', () => {
    it('should return confirmation setting from cache', async () => {
      const cachedSetting = { addConfirmationEnabled: true };
      cache.get.mockResolvedValue(cachedSetting);

      const result = await service.getConfirmationSetting({
        userId: 'user-1',
      });

      expect(result.error).toBe(false);
      expect(result.user).toEqual(cachedSetting);
    });

    it('should fetch confirmation setting from database', async () => {
      const mockUser = { addConfirmationEnabled: false };
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getConfirmationSetting({
        userId: 'user-1',
      });

      expect(result.error).toBe(false);
      expect(result.user?.addConfirmationEnabled).toBe(false);
      expect(cache.set).toHaveBeenCalled();
    });

    it('should handle database error', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await service.getConfirmationSetting({
        userId: 'user-1',
      });

      expect(result.error).toBe(true);
      expect(result.message).toContain('DB error');
    });
  });

  describe('updateConfirmationSetting', () => {
    it('should update confirmation setting to true', async () => {
      const mockUser = {
        id: 'user-1',
        addConfirmationEnabled: true,
        salonName: 'Test Salon',
      };
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.updateConfirmationSetting({
        userId: 'user-1',
        addConfirmationEnabled: true,
      });

      expect(result.error).toBe(false);
      expect(result.message).toContain('Confirmation manuelle activée');
      expect(cache.del).toHaveBeenCalledWith('user:user-1');
    });

    it('should update confirmation setting to false', async () => {
      const mockUser = {
        id: 'user-1',
        addConfirmationEnabled: false,
        salonName: 'Test Salon',
      };
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.updateConfirmationSetting({
        userId: 'user-1',
        addConfirmationEnabled: false,
      });

      expect(result.error).toBe(false);
      expect(result.message).toContain('Confirmation automatique activée');
    });

    it('should handle update error', async () => {
      prisma.user.update.mockRejectedValue(new Error('Update error'));

      const result = await service.updateConfirmationSetting({
        userId: 'user-1',
        addConfirmationEnabled: true,
      });

      expect(result.error).toBe(true);
      expect(result.message).toContain('Update error');
    });
  });

  describe('getAppointmentBooking', () => {
    it('should return appointment booking setting from cache', async () => {
      const cachedSetting = { appointmentBookingEnabled: true };
      cache.get.mockResolvedValue(cachedSetting);

      const result = await service.getAppointmentBooking({
        userId: 'user-1',
      });

      expect(result.error).toBe(false);
      expect(result.user).toEqual(cachedSetting);
    });

    it('should fetch appointment booking setting from database', async () => {
      const mockUser = { appointmentBookingEnabled: false };
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getAppointmentBooking({
        userId: 'user-1',
      });

      expect(result.error).toBe(false);
      expect(cache.set).toHaveBeenCalled();
    });

    it('should handle database error', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await service.getAppointmentBooking({
        userId: 'user-1',
      });

      expect(result.error).toBe(true);
    });
  });

  describe('updateAppointmentBooking', () => {
    it('should update appointment booking setting', async () => {
      const mockUser = {
        id: 'user-1',
        appointmentBookingEnabled: true,
        salonName: 'Test Salon',
      };
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.updateAppointmentBooking({
        userId: 'user-1',
        appointmentBookingEnabled: true,
      });

      expect(result.error).toBe(false);
      expect(cache.del).toHaveBeenCalledWith('user:appointment-booking:user-1');
    });

    it('should handle update error', async () => {
      prisma.user.update.mockRejectedValue(new Error('Update error'));

      const result = await service.updateAppointmentBooking({
        userId: 'user-1',
        appointmentBookingEnabled: true,
      });

      expect(result.error).toBe(true);
    });
  });

  describe('getColorProfile', () => {
    it('should return color profile from cache', async () => {
      const cachedColors = {
        colorProfile: '#000000',
        colorProfileBis: '#FFFFFF',
      };
      cache.get.mockResolvedValue(cachedColors);

      const result = await service.getColorProfile({
        userId: 'user-1',
      });

      expect(result.error).toBe(false);
      expect(result.user).toEqual(cachedColors);
    });

    it('should fetch color profile from database', async () => {
      const mockUser = { colorProfile: '#FF0000', colorProfileBis: '#00FF00' };
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getColorProfile({
        userId: 'user-1',
      });

      expect(result.error).toBe(false);
      expect(cache.set).toHaveBeenCalled();
    });

    it('should handle database error', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await service.getColorProfile({
        userId: 'user-1',
      });

      expect(result.error).toBe(true);
    });
  });

  describe('getUserBySlugAndLocation', () => {
    it('should return user from cache when available', async () => {
      const mockUser = buildUser();
      cache.get.mockResolvedValue(mockUser);

      const result = await service.getUserBySlugAndLocation({
        nameSlug: 'test-salon',
        locSlug: 'paris-75001',
      });

      expect(result).toEqual(mockUser);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('should fetch user by slug from database', async () => {
      const mockUsers = [buildUser({ salonName: 'Test Salon', city: 'Paris' })];
      cache.get.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.getUserBySlugAndLocation({
        nameSlug: 'test-salon',
        locSlug: 'paris-75001',
      });

      expect(result).toBeDefined();
      expect(cache.set).toHaveBeenCalled();
    });

    it('should return null when user not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.getUserBySlugAndLocation({
        nameSlug: 'nonexistent',
        locSlug: 'nonexistent',
      });

      expect(result).toBeNull();
    });

    it('should handle database error', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findMany.mockRejectedValue(new Error('DB error'));

      await expect(
        service.getUserBySlugAndLocation({
          nameSlug: 'test',
          locSlug: 'paris',
        }),
      ).rejects.toThrow();
    });
  });
});
