import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentConsumablesService } from './appointment-consumables.service';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';

const createPrismaMock = () => ({
  appointment: {
    findFirst: jest.fn(),
  },
  stockItem: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  appointmentConsumable: {
    create: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
});

const createCacheMock = () => ({
  del: jest.fn(),
  delPattern: jest.fn(),
});

describe('AppointmentConsumablesService', () => {
  let service: AppointmentConsumablesService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let cache: ReturnType<typeof createCacheMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    cache = createCacheMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentConsumablesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<AppointmentConsumablesService>(
      AppointmentConsumablesService,
    );
  });

  it('should create consumable from stock item without decrementing stock quantity', async () => {
    prisma.appointment.findFirst.mockResolvedValue({
      id: 'appt-1',
      prestation: 'TATTOO',
    });

    prisma.$transaction.mockImplementation(
      async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockItem: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'stock-1',
              category: 'Encres',
              name: 'Encre Noir',
              brand: 'Ink',
              reference: 'INK-01',
              pigment: null,
              lotNumber: 'LOT-123',
              expirationDate: null,
              unit: 'ml',
              quantity: 10,
            }),
            update: jest.fn(),
          },
          appointmentConsumable: {
            create: jest.fn().mockResolvedValue({ id: 'cons-1' }),
          },
        };

        const result = await cb(tx);
        expect(tx.stockItem.update).not.toHaveBeenCalled();

        return result;
      },
    );

    const result = await service.createAppointmentConsumable(
      'appt-1',
      'user-1',
      {
        stockItemId: 'stock-1',
        quantity: 2,
      },
    );

    expect(result.error).toBe(false);
    expect(cache.del).toHaveBeenCalledWith('appointment:appt-1');
  });

  it('should allow creating consumable even when stock quantity is low', async () => {
    prisma.appointment.findFirst.mockResolvedValue({
      id: 'appt-1',
      prestation: 'TATTOO',
    });

    prisma.$transaction.mockImplementation(
      async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          stockItem: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'stock-1',
              category: 'Encres',
              name: 'Encre Noir',
              brand: 'Ink',
              reference: 'INK-01',
              pigment: null,
              lotNumber: 'LOT-123',
              expirationDate: null,
              unit: 'ml',
              quantity: 1,
            }),
            update: jest.fn(),
          },
          appointmentConsumable: {
            create: jest.fn(),
          },
        };

        const result = await cb(tx);
        expect(tx.stockItem.update).not.toHaveBeenCalled();
        return result;
      },
    );

    const result = await service.createAppointmentConsumable(
      'appt-1',
      'user-1',
      {
        stockItemId: 'stock-1',
        quantity: 2,
      },
    );

    expect(result.error).toBe(false);
  });
});
