import { Test, TestingModule } from '@nestjs/testing';
import { SalonReviewService } from './salon-review.service';

describe('SalonReviewService', () => {
  let service: SalonReviewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SalonReviewService],
    }).compile();

    service = module.get<SalonReviewService>(SalonReviewService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
