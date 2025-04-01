import { Test, TestingModule } from '@nestjs/testing';
import { TatoueursService } from './tatoueurs.service';

describe('TatoueursService', () => {
  let service: TatoueursService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TatoueursService],
    }).compile();

    service = module.get<TatoueursService>(TatoueursService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
