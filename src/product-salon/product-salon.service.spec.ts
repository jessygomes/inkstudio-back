import { Test, TestingModule } from '@nestjs/testing';
import { ProductSalonService } from './product-salon.service';

describe('ProductSalonService', () => {
  let service: ProductSalonService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductSalonService],
    }).compile();

    service = module.get<ProductSalonService>(ProductSalonService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
