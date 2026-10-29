import { Test, TestingModule } from '@nestjs/testing';
import { AftercareController } from './aftercare.controller';
import { AftercareService } from './aftercare.service';

describe('AftercareController', () => {
  let controller: AftercareController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AftercareController],
      providers: [{ provide: AftercareService, useValue: {} }],
    }).compile();

    controller = module.get<AftercareController>(AftercareController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
