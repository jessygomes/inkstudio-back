import { Test, TestingModule } from '@nestjs/testing';
import { AftercareController } from './aftercare.controller';

describe('AftercareController', () => {
  let controller: AftercareController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AftercareController],
    }).compile();

    controller = module.get<AftercareController>(AftercareController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
