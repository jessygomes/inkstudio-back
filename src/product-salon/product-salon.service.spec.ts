import { Test, TestingModule } from '@nestjs/testing';
import { ProductSalonService } from './product-salon.service';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { CreateProductDto } from './dto/create-product.dto';

const createPrismaMock = () => ({
  user: {
    findUnique: jest.fn(),
  },
  productSalon: {
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

const buildProductDto = (
  overrides: Partial<CreateProductDto> = {},
): CreateProductDto => ({
  name: 'Product1',
  description: 'desc',
  price: 50,
  imageUrl: 'http://img',
  ...overrides,
});

describe('ProductSalonService', () => {
  let service: ProductSalonService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let cache: ReturnType<typeof createCacheMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    cache = createCacheMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductSalonService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<ProductSalonService>(ProductSalonService);
    jest.clearAllMocks();
  });

  describe('createProduct', () => {
    it('returns error when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.createProduct(buildProductDto(), 'u1');

      expect(result).toEqual({
        error: true,
        message: 'Utilisateur non trouvé',
      });
      expect(prisma.productSalon.create).not.toHaveBeenCalled();
    });

    it('creates product, invalidates cache, returns payload', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.productSalon.create.mockResolvedValue({ id: 'pr1', userId: 'u1' });

      const result = await service.createProduct(buildProductDto(), 'u1');

      expect(result).toMatchObject({ error: false, product: { id: 'pr1' } });
      expect(prisma.productSalon.create).toHaveBeenCalled();
      expect(cache.del).toHaveBeenCalledWith('products:salon:u1');
    });

    it('returns error message when creation throws', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.productSalon.create.mockRejectedValue(new Error('boom'));

      const result = await service.createProduct(buildProductDto(), 'u1');

      expect(result).toEqual({ error: true, message: 'boom' });
    });
  });

  describe('getAllProducts', () => {
    it('returns cached products when present', async () => {
      const cached = [{ id: 'pr1' }];
      cache.get.mockResolvedValue(cached);

      const result = await service.getAllProducts('u1');

      expect(result).toEqual(cached);
      expect(prisma.productSalon.findMany).not.toHaveBeenCalled();
    });

    it('fetches products, caches them, and returns list', async () => {
      cache.get.mockResolvedValue(null);
      prisma.productSalon.findMany.mockResolvedValue([
        { id: 'pr1' },
        { id: 'pr2' },
      ]);

      const result = await service.getAllProducts('u1');

      expect(result).toHaveLength(2);
      expect(cache.set).toHaveBeenCalledWith('products:salon:u1', result, 1200);
    });

    it('returns error on retrieval failure', async () => {
      cache.get.mockResolvedValue(null);
      prisma.productSalon.findMany.mockRejectedValue(new Error('db fail'));

      const result = await service.getAllProducts('u1');

      expect(result).toEqual({ error: true, message: 'db fail' });
    });
  });

  describe('updateProduct', () => {
    it('returns error when product not found', async () => {
      prisma.productSalon.findUnique.mockResolvedValue(null);

      const result = await service.updateProduct('pr1', { name: 'New' });

      expect(result).toEqual({ error: true, message: 'Produit non trouvé' });
      expect(prisma.productSalon.update).not.toHaveBeenCalled();
    });

    it('updates product, invalidates cache, and returns payload', async () => {
      prisma.productSalon.findUnique.mockResolvedValue({
        id: 'pr1',
        userId: 'u1',
      });
      prisma.productSalon.update.mockResolvedValue({ id: 'pr1', name: 'New' });

      const result = await service.updateProduct('pr1', { name: 'New' });

      expect(result).toEqual({
        error: false,
        message: 'Produit mis à jour avec succès',
        product: { id: 'pr1', name: 'New' },
      });
      expect(cache.del).toHaveBeenCalledWith('products:salon:u1');
    });

    it('returns error message when update throws', async () => {
      prisma.productSalon.findUnique.mockResolvedValue({
        id: 'pr1',
        userId: 'u1',
      });
      prisma.productSalon.update.mockRejectedValue(new Error('boom'));

      const result = await service.updateProduct('pr1', { name: 'New' });

      expect(result).toEqual({ error: true, message: 'boom' });
    });
  });

  describe('deleteProduct', () => {
    it('returns error when product not found', async () => {
      prisma.productSalon.findUnique.mockResolvedValue(null);

      const result = await service.deleteProduct('pr1');

      expect(result).toEqual({ error: true, message: 'Produit non trouvé' });
      expect(prisma.productSalon.delete).not.toHaveBeenCalled();
    });

    it('deletes product, invalidates cache, and returns success message', async () => {
      prisma.productSalon.findUnique.mockResolvedValue({
        id: 'pr1',
        userId: 'u1',
      });
      prisma.productSalon.delete.mockResolvedValue({});

      const result = await service.deleteProduct('pr1');

      expect(result).toEqual({
        error: false,
        message: 'Produit supprimé avec succès',
      });
      expect(cache.del).toHaveBeenCalledWith('products:salon:u1');
    });

    it('returns error message on delete failure', async () => {
      prisma.productSalon.findUnique.mockResolvedValue({
        id: 'pr1',
        userId: 'u1',
      });
      prisma.productSalon.delete.mockRejectedValue(new Error('boom'));

      const result = await service.deleteProduct('pr1');

      expect(result).toEqual({ error: true, message: 'boom' });
    });
  });
});
