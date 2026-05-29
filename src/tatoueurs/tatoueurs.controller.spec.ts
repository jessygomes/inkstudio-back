import { Test, TestingModule } from '@nestjs/testing';
import { TatoueursController } from './tatoueurs.controller';
import { TatoueursService } from './tatoueurs.service';

describe('TatoueursController', () => {
  let controller: TatoueursController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TatoueursController],
      providers: [
        {
          provide: TatoueursService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<TatoueursController>(TatoueursController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
