import { Test, TestingModule } from '@nestjs/testing';
import { TattooHistoryController } from './tattoo-history.controller';

describe('TattooHistoryController', () => {
  let controller: TattooHistoryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TattooHistoryController],
    }).compile();

    controller = module.get<TattooHistoryController>(TattooHistoryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
