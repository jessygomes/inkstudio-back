import { Test, TestingModule } from '@nestjs/testing';
import { AftercareService } from './aftercare.service';

describe('AftercareService', () => {
  let service: AftercareService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AftercareService],
    }).compile();

    service = module.get<AftercareService>(AftercareService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
