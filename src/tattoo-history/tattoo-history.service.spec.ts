import { Test, TestingModule } from '@nestjs/testing';
import { TattooHistoryService } from './tattoo-history.service';

describe('TattooHistoryService', () => {
  let service: TattooHistoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TattooHistoryService],
    }).compile();

    service = module.get<TattooHistoryService>(TattooHistoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
