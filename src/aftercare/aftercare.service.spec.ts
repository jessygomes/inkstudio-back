import { Test, TestingModule } from '@nestjs/testing';
import { AftercareService } from './aftercare.service';
import { PrismaService } from '../database/prisma.service';

describe('AftercareService', () => {
  let service: AftercareService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AftercareService, { provide: PrismaService, useValue: {} }],
    }).compile();

    service = module.get<AftercareService>(AftercareService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
