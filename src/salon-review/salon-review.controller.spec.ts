import { Test, TestingModule } from '@nestjs/testing';
import { SalonReviewController } from './salon-review.controller';
import { SalonReviewService } from './salon-review.service';

describe('SalonReviewController', () => {
  let controller: SalonReviewController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalonReviewController],
      providers: [SalonReviewService],
    }).compile();

    controller = module.get<SalonReviewController>(SalonReviewController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
