import { Test, TestingModule } from '@nestjs/testing';
import { ProductSalonController } from './product-salon.controller';
import { ProductSalonService } from './product-salon.service';

describe('ProductSalonController', () => {
  let controller: ProductSalonController;
  let service: {
    createProduct: jest.Mock,
    getAllProducts: jest.Mock,
    updateProduct: jest.Mock,
    deleteProduct: jest.Mock,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductSalonController],
      providers: [
        {
          provide: ProductSalonService,
          useValue: {
            createProduct: jest.fn(),
            getAllProducts: jest.fn(),
            updateProduct: jest.fn(),
            deleteProduct: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ProductSalonController>(ProductSalonController);
    service = module.get(ProductSalonService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('forwards authenticated userId to updateProduct', async () => {
    const req = { user: { userId: 'u1' } };
    service.updateProduct.mockResolvedValue({ error: false });

    await controller.updateProduct(req as any, 'pr1', { name: 'New' });

    expect(service.updateProduct).toHaveBeenCalledWith(
      'pr1',
      { name: 'New' },
      'u1',
    );
  });

  it('forwards authenticated userId to deleteProduct', async () => {
    const req = { user: { userId: 'u1' } };
    service.deleteProduct.mockResolvedValue({ error: false });

    await controller.deleteProduct(req as any, 'pr1');

    expect(service.deleteProduct).toHaveBeenCalledWith('pr1', 'u1');
  });
});
