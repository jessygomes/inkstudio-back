import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

describe('PortfolioController', () => {
  let controller: PortfolioController;
  let service: { getInspirationPortfolioPhotos: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortfolioController],
      providers: [
        {
          provide: PortfolioService,
          useValue: {
            getInspirationPortfolioPhotos: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PortfolioController>(PortfolioController);
    service = module.get(PortfolioService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return inspiration portfolio photos through service', async () => {
    service.getInspirationPortfolioPhotos.mockResolvedValue({ photos: [] });

    const result = await controller.getInspirationPortfolioPhotos('2', '24');

    expect(service.getInspirationPortfolioPhotos).toHaveBeenCalledWith({
      page: 2,
      limit: 24,
      city: undefined,
      style: undefined,
    });
    expect(result).toEqual({ photos: [] });
  });
});
