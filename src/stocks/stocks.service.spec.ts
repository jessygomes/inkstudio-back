/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { StocksService } from './stocks.service';
import { PrismaService } from 'src/database/prisma.service';
import { SaasService } from 'src/saas/saas.service';
import { CacheService } from 'src/redis/cache.service';

// Mock factories
const createPrismaMock = () => ({
  stockItem: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
});

const createSaasMock = () => ({
  checkPlan: jest.fn(),
});

const createCacheMock = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
});

// Test data builders
const buildStockItem = (overrides?: Partial<any>) => ({
  id: 'stock-1',
  userId: 'user-1',
  name: 'Encre Noir',
  category: 'Encres',
  quantity: 100,
  unit: 'ml',
  minQuantity: 20,
  pricePerUnit: 15.5,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const buildCreateStockDto = (overrides?: Partial<any>) => ({
  name: 'Encre Couleur',
  category: 'Encres',
  quantity: 50,
  unit: 'ml',
  minQuantity: 10,
  pricePerUnit: 20.0,
  ...overrides,
});

const buildPaginationResult = () => ({
  currentPage: 1,
  totalPages: 2,
  totalStockItems: 15,
  limit: 12,
  hasNextPage: true,
  hasPreviousPage: false,
});

describe('StocksService', () => {
  let service: StocksService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let saas: ReturnType<typeof createSaasMock>;
  let cache: ReturnType<typeof createCacheMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    saas = createSaasMock();
    cache = createCacheMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StocksService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: SaasService,
          useValue: saas,
        },
        {
          provide: CacheService,
          useValue: cache,
        },
      ],
    }).compile();

    service = module.get<StocksService>(StocksService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createItemStock', () => {
    it('should create stock item successfully', async () => {
      const stockDto = buildCreateStockDto();
      const mockStockItem = buildStockItem();
      prisma.stockItem.create.mockResolvedValue(mockStockItem);
      cache.delPattern.mockResolvedValue(undefined);

      const result = await service.createItemStock({
        stockBody: stockDto,
        userId: 'user-1',
      });

      expect(result.error).toBe(false);
      expect(result.message).toContain('créé avec succès');
      expect(result.stockItem).toEqual(mockStockItem);
      expect(prisma.stockItem.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          ...stockDto,
        },
      });
      expect(cache.delPattern).toHaveBeenCalledWith('stocks:salon:user-1:*');
    });

    it('should handle creation error', async () => {
      const stockDto = buildCreateStockDto();
      prisma.stockItem.create.mockRejectedValue(new Error('DB error'));

      const result = await service.createItemStock({
        stockBody: stockDto,
        userId: 'user-1',
      });

      expect(result.error).toBe(true);
      expect(result.message).toContain('DB error');
    });
  });

  describe('getStocksBySalon', () => {
    it('should return stocks from cache when available', async () => {
      const mockStocks = [buildStockItem(), buildStockItem({ id: 'stock-2' })];
      const cachedResult = {
        error: false,
        stockItems: mockStocks,
        pagination: buildPaginationResult(),
      };
      cache.get.mockResolvedValue(cachedResult);

      const result = await service.getStocksBySalon('user-1', 1, 12, '');

      expect(cache.get).toHaveBeenCalled();
      expect(result).toEqual(cachedResult);
      expect(prisma.stockItem.findMany).not.toHaveBeenCalled();
    });

    it('should fetch stocks from database when not in cache', async () => {
      const mockStocks = [buildStockItem(), buildStockItem({ id: 'stock-2' })];
      cache.get.mockResolvedValue(null);
      prisma.stockItem.count.mockResolvedValue(2);
      prisma.stockItem.findMany.mockResolvedValue(mockStocks);
      cache.set.mockResolvedValue(undefined);

      const result = (await service.getStocksBySalon(
        'user-1',
        1,
        12,
        '',
      )) as any;

      expect(result.error).toBe(false);
      expect(result.stockItems.length).toBe(2);
      expect(result.stockItems[0].totalPrice).toBe(1550); // 100 * 15.50
      expect(cache.set).toHaveBeenCalled();
    });

    it('should filter stocks by search query', async () => {
      const mockStocks = [buildStockItem({ name: 'Encre Noir' })];
      cache.get.mockResolvedValue(null);
      prisma.stockItem.count.mockResolvedValue(1);
      prisma.stockItem.findMany.mockResolvedValue(mockStocks);
      cache.set.mockResolvedValue(undefined);

      await service.getStocksBySalon('user-1', 1, 12, 'Encre');

      expect(prisma.stockItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            OR: expect.any(Array),
          }),
        }),
      );
    });

    it('should handle pagination correctly', async () => {
      const mockStocks = [buildStockItem()];
      cache.get.mockResolvedValue(null);
      prisma.stockItem.count.mockResolvedValue(50);
      prisma.stockItem.findMany.mockResolvedValue(mockStocks);
      cache.set.mockResolvedValue(undefined);

      const result = (await service.getStocksBySalon(
        'user-1',
        2,
        12,
        '',
      )) as any;

      expect(result.pagination.currentPage).toBe(2);
      expect(result.pagination.hasNextPage).toBe(true);
      expect(prisma.stockItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 12, take: 12 }),
      );
    });

    it('should return error when no stocks found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.stockItem.count.mockResolvedValue(0);
      prisma.stockItem.findMany.mockResolvedValue([]);

      const result = await service.getStocksBySalon('user-1', 1, 12, '');

      expect((result as unknown as any).error).toBe(true);
      expect((result as unknown as any).message).toContain(
        'Aucun élément de stock trouvé',
      );
    });
  });

  describe('getStockItemById', () => {
    it('should return stock item from cache when available', async () => {
      const mockStockItem = buildStockItem();
      cache.get.mockResolvedValue(mockStockItem);

      const result = await service.getStockItemById('stock-1');

      expect(cache.get).toHaveBeenCalledWith('stockitem:stock-1');
      expect(result).toEqual(mockStockItem);
      expect(prisma.stockItem.findUnique).not.toHaveBeenCalled();
    });

    it('should fetch stock item from database when not in cache', async () => {
      const mockStockItem = buildStockItem();
      cache.get.mockResolvedValue(null);
      prisma.stockItem.findUnique.mockResolvedValue(mockStockItem);
      cache.set.mockResolvedValue(undefined);

      const result = await service.getStockItemById('stock-1');

      expect(result).toEqual(mockStockItem);
      expect(cache.set).toHaveBeenCalledWith(
        'stockitem:stock-1',
        mockStockItem,
        600,
      );
    });

    it('should return error when stock item not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.stockItem.findUnique.mockResolvedValue(null);

      const result = await service.getStockItemById('stock-1');

      expect((result as unknown as any).error).toBe(true);
      expect((result as unknown as any).message).toContain(
        'Élément de stock introuvable',
      );
    });

    it('should handle database error', async () => {
      cache.get.mockResolvedValue(null);
      prisma.stockItem.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await service.getStockItemById('stock-1');

      expect((result as unknown as any).error).toBe(true);
      expect((result as unknown as any).message).toContain('DB error');
    });
  });

  describe('updateStockItem', () => {
    it('should update stock item successfully', async () => {
      const stockDto = buildCreateStockDto({ quantity: 75 });
      const updatedStockItem = buildStockItem({ ...stockDto });
      prisma.stockItem.update.mockResolvedValue(updatedStockItem);
      cache.del.mockResolvedValue(undefined);
      cache.delPattern.mockResolvedValue(undefined);

      const result = await service.updateStockItem('stock-1', stockDto);

      expect(result.error).toBe(false);
      expect(result.message).toContain(
        'Élément de stock mis à jour avec succès',
      );
      expect(result.stockItem).toEqual(updatedStockItem);
      expect(cache.del).toHaveBeenCalledWith('stockitem:stock-1');
      expect(cache.delPattern).toHaveBeenCalledWith(
        `stocks:salon:${updatedStockItem.userId}:*`,
      );
    });

    it('should handle update error', async () => {
      const stockDto = buildCreateStockDto();
      prisma.stockItem.update.mockRejectedValue(new Error('Update failed'));

      const result = await service.updateStockItem('stock-1', stockDto);

      expect(result.error).toBe(true);
      expect(result.message).toContain('Update failed');
    });
  });

  describe('getItemCategories', () => {
    it('should return unique categories for salon', async () => {
      const mockCategories = [
        { category: 'Encres' },
        { category: 'Aiguilles' },
        { category: 'Consommables' },
      ];
      prisma.stockItem.findMany.mockResolvedValue(mockCategories);

      const result = await service.getItemCategories('user-1');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Encres', 'Aiguilles', 'Consommables']);
      expect(prisma.stockItem.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        distinct: ['category'],
        select: { category: true },
      });
    });

    it('should filter out null categories', async () => {
      const mockCategories = [
        { category: 'Encres' },
        { category: null },
        { category: 'Aiguilles' },
      ];
      prisma.stockItem.findMany.mockResolvedValue(mockCategories);

      const result = await service.getItemCategories('user-1');

      expect(result).toEqual(['Encres', 'Aiguilles']);
    });

    it('should handle database error', async () => {
      prisma.stockItem.findMany.mockRejectedValue(new Error('DB error'));

      const result = await service.getItemCategories('user-1');

      expect((result as any).error).toBe(true);
      expect((result as any).message).toContain('DB error');
    });
  });

  describe('updateStockQuantityItem', () => {
    it('should update stock quantity successfully', async () => {
      const mockExistingItem = buildStockItem({ quantity: 100 });
      const updatedItem = buildStockItem({ quantity: 75 });
      prisma.stockItem.findUnique.mockResolvedValue(mockExistingItem);
      prisma.stockItem.update.mockResolvedValue(updatedItem);
      cache.del.mockResolvedValue(undefined);
      cache.delPattern.mockResolvedValue(undefined);

      const result = await service.updateStockQuantityItem('stock-1', 75);

      expect(result.error).toBe(false);
      expect(result.message).toContain('mise à jour avec succès');
      expect(result.stockItem).toEqual(updatedItem);
    });

    it('should reject negative quantity', async () => {
      const result = await service.updateStockQuantityItem('stock-1', -5);

      expect(result.error).toBe(true);
      expect(result.message).toContain('La quantité ne peut pas être négative');
    });

    it('should return error when stock item not found', async () => {
      prisma.stockItem.findUnique.mockResolvedValue(null);

      const result = await service.updateStockQuantityItem('stock-1', 50);

      expect(result.error).toBe(true);
      expect(result.message).toContain('Élément de stock non trouvé');
    });

    it('should invalidate cache after quantity update', async () => {
      const mockExistingItem = buildStockItem();
      const updatedItem = buildStockItem({ quantity: 50 });
      prisma.stockItem.findUnique.mockResolvedValue(mockExistingItem);
      prisma.stockItem.update.mockResolvedValue(updatedItem);
      cache.del.mockResolvedValue(undefined);
      cache.delPattern.mockResolvedValue(undefined);

      await service.updateStockQuantityItem('stock-1', 50);

      expect(cache.del).toHaveBeenCalledWith('stockitem:stock-1');
      expect(cache.delPattern).toHaveBeenCalledWith('stocks:salon:user-1:*');
    });

    it('should handle database error', async () => {
      prisma.stockItem.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await service.updateStockQuantityItem('stock-1', 50);

      expect(result.error).toBe(true);
      expect(result.message).toContain('Erreur lors de la mise à jour');
    });
  });

  describe('deleteStockItem', () => {
    it('should delete stock item successfully', async () => {
      const mockStockItem = buildStockItem();
      prisma.stockItem.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.stockItem.delete.mockResolvedValue(mockStockItem);
      cache.del.mockResolvedValue(undefined);
      cache.delPattern.mockResolvedValue(undefined);

      const result = await service.deleteStockItem('stock-1');

      expect(result.error).toBe(false);
      expect(result.message).toContain('supprimé avec succès');
      expect(result.stockItem).toEqual(mockStockItem);
      expect(prisma.stockItem.delete).toHaveBeenCalledWith({
        where: { id: 'stock-1' },
      });
    });

    it('should return error when stock item not found', async () => {
      prisma.stockItem.findUnique.mockResolvedValue(null);

      const result = await service.deleteStockItem('stock-1');

      expect(result.error).toBe(true);
      expect(result.message).toContain('Élément de stock introuvable');
      expect(prisma.stockItem.delete).not.toHaveBeenCalled();
    });

    it('should invalidate cache after deletion', async () => {
      prisma.stockItem.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.stockItem.delete.mockResolvedValue(buildStockItem());
      cache.del.mockResolvedValue(undefined);
      cache.delPattern.mockResolvedValue(undefined);

      await service.deleteStockItem('stock-1');

      expect(cache.del).toHaveBeenCalledWith('stockitem:stock-1');
      expect(cache.delPattern).toHaveBeenCalledWith('stocks:salon:user-1:*');
    });

    it('should handle deletion error', async () => {
      prisma.stockItem.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.stockItem.delete.mockRejectedValue(new Error('Delete failed'));

      const result = await service.deleteStockItem('stock-1');

      expect(result.error).toBe(true);
      expect(result.message).toContain('Delete failed');
    });
  });
});
