import { Test, TestingModule } from '@nestjs/testing';
import { ProductSalonController } from './product-salon.controller';

describe('ProductSalonController', () => {
  let controller: ProductSalonController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductSalonController],
    }).compile();

    controller = module.get<ProductSalonController>(ProductSalonController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
