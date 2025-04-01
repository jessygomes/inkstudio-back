import { Test, TestingModule } from '@nestjs/testing';
import { TatoueursController } from './tatoueurs.controller';

describe('TatoueursController', () => {
  let controller: TatoueursController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TatoueursController],
    }).compile();

    controller = module.get<TatoueursController>(TatoueursController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
