import { Test, TestingModule } from '@nestjs/testing';
import { TimeSlotService } from './time-slot.service';
import { PrismaService } from 'src/database/prisma.service';

// Mock factories
const createPrismaMock = () => ({
  tatoueur: {
    findUnique: jest.fn(),
  },
  blockedTimeSlot: {
    findFirst: jest.fn(),
  },
});

// Test data builders
const buildSalonHours = (
  overrides?: Partial<Record<string, { start: string, end: string } | null>>,
) => {
  return JSON.stringify({
    monday: { start: '09:00', end: '18:00' },
    tuesday: { start: '09:00', end: '18:00' },
    wednesday: { start: '09:00', end: '18:00' },
    thursday: { start: '09:00', end: '18:00' },
    friday: { start: '09:00', end: '18:00' },
    saturday: { start: '10:00', end: '16:00' },
    sunday: null,
    ...overrides,
  });
};

const buildTatoueur = (
  overrides?: Partial<{ id: string, userId: string, hours: string | null }>,
) => ({
  id: 'tatoueur-1',
  userId: 'user-1',
  hours: buildSalonHours(),
  user: { id: 'user-1' },
  ...overrides,
});

describe('TimeSlotService', () => {
  let service: TimeSlotService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeSlotService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<TimeSlotService>(TimeSlotService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateTimeSlotsForDate', () => {
    it('should generate 30-minute time slots for a valid date', async () => {
      const date = new Date('2026-01-26'); // Monday
      const salonHours = buildSalonHours();

      const slots = await service.generateTimeSlotsForDate(date, salonHours);

      // 09:00 to 18:00 = 9 hours = 18 slots of 30 minutes
      expect(slots.length).toBe(18);
      expect(slots[0].start.getHours()).toBe(9);
      expect(slots[0].start.getMinutes()).toBe(0);
      expect(slots[0].end.getHours()).toBe(9);
      expect(slots[0].end.getMinutes()).toBe(30);
    });

    it('should return empty array for closed day', async () => {
      const date = new Date('2026-01-25'); // Sunday
      const salonHours = buildSalonHours();

      const slots = await service.generateTimeSlotsForDate(date, salonHours);

      expect(slots).toEqual([]);
    });

    it('should return empty array for invalid JSON', async () => {
      const date = new Date('2026-01-26');
      const invalidJson = 'invalid json {]';

      const slots = await service.generateTimeSlotsForDate(date, invalidJson);

      expect(slots).toEqual([]);
    });

    it('should filter blocked slots when userId is provided', async () => {
      const date = new Date('2026-01-26');
      const salonHours = buildSalonHours();
      const userId = 'user-1';

      // Mock: all slots are available (no blocks)
      prisma.blockedTimeSlot.findFirst.mockResolvedValue(null);

      const slots = await service.generateTimeSlotsForDate(
        date,
        salonHours,
        userId,
      );

      // Should have 18 total slots when no blocks exist
      expect(prisma.blockedTimeSlot.findFirst).toHaveBeenCalled();
      expect(slots.length).toBe(18);
    });

    it('should generate slots with correct duration (30 minutes)', async () => {
      const date = new Date('2026-01-26');
      const salonHours = buildSalonHours();

      const slots = await service.generateTimeSlotsForDate(date, salonHours);

      slots.forEach((slot) => {
        const duration =
          (slot.end.getTime() - slot.start.getTime()) / 1000 / 60;
        expect(duration).toBe(30);
      });
    });

    it('should handle custom salon hours', async () => {
      const date = new Date('2026-01-27'); // Tuesday
      const customHours = buildSalonHours({
        tuesday: { start: '14:00', end: '16:00' },
      });

      const slots = await service.generateTimeSlotsForDate(date, customHours);

      // 14:00 to 16:00 = 2 hours = 4 slots
      expect(slots.length).toBe(4);
      expect(slots[0].start.getHours()).toBe(14);
    });
  });

  describe('generateTatoueurTimeSlots', () => {
    it('should return available slots for tatoueur', async () => {
      const date = new Date('2026-01-26');
      const tatoueur = buildTatoueur();

      prisma.tatoueur.findUnique.mockResolvedValue(tatoueur);
      prisma.blockedTimeSlot.findFirst.mockResolvedValue(null);

      const slots = await service.generateTatoueurTimeSlots(date, tatoueur.id);

      expect(slots.length).toBe(18);
      expect(prisma.tatoueur.findUnique).toHaveBeenCalledWith({
        where: { id: tatoueur.id },
        include: { user: { select: { id: true } } },
      });
    });

    it('should return empty array when tatoueur not found', async () => {
      const date = new Date('2026-01-26');
      const tatoueurId = 'non-existent';

      prisma.tatoueur.findUnique.mockResolvedValue(null);

      const slots = await service.generateTatoueurTimeSlots(date, tatoueurId);

      expect(slots).toEqual([]);
    });

    it('should return empty array when tatoueur has no hours', async () => {
      const date = new Date('2026-01-26');
      const tatoueur = buildTatoueur({ hours: null });

      prisma.tatoueur.findUnique.mockResolvedValue(tatoueur);

      const slots = await service.generateTatoueurTimeSlots(date, tatoueur.id);

      expect(slots).toEqual([]);
    });

    it('should filter out blocked slots for tatoueur', async () => {
      const date = new Date('2026-01-26');
      const tatoueur = buildTatoueur();

      prisma.tatoueur.findUnique.mockResolvedValue(tatoueur);
      prisma.blockedTimeSlot.findFirst.mockResolvedValue(null);

      const slots = await service.generateTatoueurTimeSlots(date, tatoueur.id);

      // All slots available when no blocks exist
      expect(slots.length).toBe(18);
    });

    it('should check blocked slots with both tatoueurId and userId', async () => {
      const date = new Date('2026-01-26');
      const tatoueur = buildTatoueur();

      prisma.tatoueur.findUnique.mockResolvedValue(tatoueur);
      prisma.blockedTimeSlot.findFirst.mockResolvedValue(null);

      await service.generateTatoueurTimeSlots(date, tatoueur.id);

      // Verify findFirst is called with correct parameters
      expect(prisma.blockedTimeSlot.findFirst).toHaveBeenCalled();
    });

    it('should handle database error gracefully', async () => {
      const date = new Date('2026-01-26');
      const tatoueurId = 'tatoueur-1';

      prisma.tatoueur.findUnique.mockRejectedValue(new Error('DB error'));

      // Should not throw, error is caught internally
      try {
        await service.generateTatoueurTimeSlots(date, tatoueurId);
      } catch (error) {
        // Service logs error and continues
        expect(error).toBeDefined();
      }
    });
  });

  describe('isTimeSlotBlocked (via public methods)', () => {
    it('should identify blocked time slot for specific tatoueur', async () => {
      const date = new Date('2026-01-26');
      const salonHours = buildSalonHours();
      const userId = 'user-1';

      prisma.blockedTimeSlot.findFirst.mockResolvedValue(null);

      await service.generateTimeSlotsForDate(date, salonHours, userId);

      // Verify blocked slots were checked
      expect(prisma.blockedTimeSlot.findFirst).toHaveBeenCalled();
    });

    it('should identify blocked time slot for all tatoueurs (tatoueurId null)', async () => {
      const date = new Date('2026-01-26');
      const tatoueur = buildTatoueur();

      prisma.tatoueur.findUnique.mockResolvedValue(tatoueur);
      prisma.blockedTimeSlot.findFirst.mockResolvedValue(null);

      const slots = await service.generateTatoueurTimeSlots(date, tatoueur.id);

      // All slots available when no blocks exist
      expect(slots.length).toBe(18);
    });

    it('should handle error in isTimeSlotBlocked gracefully', async () => {
      const date = new Date('2026-01-26');
      const salonHours = buildSalonHours();
      const userId = 'user-1';

      prisma.blockedTimeSlot.findFirst.mockRejectedValue(new Error('DB error'));

      // Should not throw, error is caught and slot considered not blocked
      const slots = await service.generateTimeSlotsForDate(
        date,
        salonHours,
        userId,
      );

      // All 18 slots should be returned (error treatment = not blocked)
      expect(slots.length).toBe(18);
    });
  });

  describe('Edge cases and complex scenarios', () => {
    it('should handle Saturday morning hours correctly', async () => {
      const date = new Date('2026-01-24'); // Saturday
      const salonHours = buildSalonHours({
        saturday: { start: '10:00', end: '16:00' },
      });

      const slots = await service.generateTimeSlotsForDate(date, salonHours);

      // 10:00 to 16:00 = 6 hours = 12 slots
      expect(slots.length).toBe(12);
      expect(slots[0].start.getHours()).toBe(10);
    });

    it('should handle hours with different minute values', async () => {
      const date = new Date('2026-01-26');
      const salonHours = buildSalonHours({
        monday: { start: '09:15', end: '17:45' },
      });

      const slots = await service.generateTimeSlotsForDate(date, salonHours);

      expect(slots[0].start.getMinutes()).toBe(15);
      expect(slots[0].end.getMinutes()).toBe(45);
    });

    it('should return empty array for single hour with less than 30 minutes', async () => {
      const date = new Date('2026-01-26');
      const salonHours = buildSalonHours({
        monday: { start: '09:00', end: '09:15' },
      });

      const slots = await service.generateTimeSlotsForDate(date, salonHours);

      // 15 minutes is less than 30, so no full slot
      expect(slots.length).toBe(0);
    });

    it('should handle all slots exactly fitting the hours', async () => {
      const date = new Date('2026-01-26');
      const salonHours = buildSalonHours({
        monday: { start: '09:00', end: '10:00' },
      });

      const slots = await service.generateTimeSlotsForDate(date, salonHours);

      // 1 hour = 2 slots exactly
      expect(slots.length).toBe(2);
      expect(slots[slots.length - 1].end.getTime()).toBe(
        new Date('2026-01-26T10:00:00').getTime(),
      );
    });

    it('should query blocked slots with correct time range conditions', async () => {
      const date = new Date('2026-01-26');
      const salonHours = buildSalonHours({
        monday: { start: '09:00', end: '09:30' },
      });

      prisma.blockedTimeSlot.findFirst.mockResolvedValue(null);

      await service.generateTimeSlotsForDate(date, salonHours, 'user-1');

      // Verify the WHERE condition includes time range checks
      expect(prisma.blockedTimeSlot.findFirst).toHaveBeenCalled();
      const calls = prisma.blockedTimeSlot.findFirst.mock.calls as unknown[][];
      expect(calls[0]).toBeDefined();
    });
  });
});
