import { Test, TestingModule } from '@nestjs/testing';
import { TimeSlotController } from './time-slot.controller';
import { TimeSlotService } from './time-slot.service';
import { PrismaService } from '../database/prisma.service';

describe('TimeSlotController', () => {
  let controller: TimeSlotController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TimeSlotController],
      providers: [
        {
          provide: TimeSlotService,
          useValue: {
            getAvailableSlots: jest.fn(),
            getOccupiedSlots: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            appointment: {
              findMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    controller = module.get<TimeSlotController>(TimeSlotController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
