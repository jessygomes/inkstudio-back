/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { BlockedTimeSlotsService } from './blocked-time-slots.service';
import { PrismaService } from 'src/database/prisma.service';

// Mock factories
const createPrismaMock = () => ({
  blockedTimeSlot: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  proposedSlot: {
    findMany: jest.fn(),
  },
});

// DTO and data builders
const buildCreateBlockedSlotDto = (overrides?: Partial<any>) => ({
  startDate: '2026-02-15T10:00:00Z',
  endDate: '2026-02-15T12:00:00Z',
  reason: 'Personal appointment',
  tatoueurId: 'tatoueur-1',
  ...overrides,
});

const buildUpdateBlockedSlotDto = (overrides?: Partial<any>) => ({
  startDate: '2026-02-16T14:00:00Z',
  endDate: '2026-02-16T16:00:00Z',
  reason: 'Updated reason',
  tatoueurId: 'tatoueur-2',
  ...overrides,
});

const buildBlockedSlot = (overrides?: Partial<any>) => ({
  id: 'blocked-slot-1',
  startDate: new Date('2026-02-15T10:00:00Z'),
  endDate: new Date('2026-02-15T12:00:00Z'),
  reason: 'Personal appointment',
  tatoueurId: 'tatoueur-1',
  userId: 'salon-1',
  tatoueur: {
    id: 'tatoueur-1',
    name: 'Jean Dupont',
  },
  ...overrides,
});

const buildProposedSlot = (overrides?: Partial<any>) => ({
  id: 'proposed-slot-1',
  tatoueurId: 'tatoueur-1',
  status: 'PENDING',
  from: new Date('2026-02-20T10:00:00Z'),
  to: new Date('2026-02-20T12:00:00Z'),
  appointmentRequest: {
    id: 'request-1',
    clientFirstname: 'Alice',
    clientLastname: 'Martin',
    clientEmail: 'alice@example.com',
    status: 'PENDING',
    prestation: 'Tattoo Design',
    createdAt: new Date('2026-02-10T00:00:00Z'),
  },
  ...overrides,
});

describe('BlockedTimeSlotsService', () => {
  let service: BlockedTimeSlotsService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = createPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockedTimeSlotsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<BlockedTimeSlotsService>(BlockedTimeSlotsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createBlockedSlot', () => {
    it('should create a blocked slot successfully', async () => {
      const createDto = buildCreateBlockedSlotDto();
      const expectedSlot = buildBlockedSlot();

      prismaMock.blockedTimeSlot.create.mockResolvedValue(expectedSlot);

      const result = await service.createBlockedSlot(createDto, 'salon-1');

      expect(result.error).toBe(false);
      expect(result.message).toBe('Créneau bloqué créé avec succès.');
      expect(result.blockedSlot).toEqual(expectedSlot);
      expect(prismaMock.blockedTimeSlot.create).toHaveBeenCalledWith({
        data: {
          startDate: new Date('2026-02-15T10:00:00Z'),
          endDate: new Date('2026-02-15T12:00:00Z'),
          reason: 'Personal appointment',
          tatoueurId: 'tatoueur-1',
          userId: 'salon-1',
        },
        include: {
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });

    it('should create blocked slot without reason', async () => {
      const createDto = buildCreateBlockedSlotDto({ reason: undefined });
      const expectedSlot = buildBlockedSlot({ reason: null });

      prismaMock.blockedTimeSlot.create.mockResolvedValue(expectedSlot);

      const result = await service.createBlockedSlot(createDto, 'salon-1');

      expect(result.error).toBe(false);
      expect(result.blockedSlot).toBeDefined();
      expect(result.blockedSlot?.reason).toBeNull();
    });

    it('should create blocked slot without tatoueurId', async () => {
      const createDto = buildCreateBlockedSlotDto({ tatoueurId: undefined });
      const expectedSlot = buildBlockedSlot({ tatoueurId: null });

      prismaMock.blockedTimeSlot.create.mockResolvedValue(expectedSlot);

      const result = await service.createBlockedSlot(createDto, 'salon-1');

      expect(result.error).toBe(false);
      expect(result.blockedSlot).toBeDefined();
      expect(result.blockedSlot?.tatoueurId).toBeNull();
    });

    it('should return error when startDate is missing', async () => {
      const createDto = buildCreateBlockedSlotDto({ startDate: undefined });

      const result = await service.createBlockedSlot(createDto, 'salon-1');

      expect(result.error).toBe(true);
      expect(result.message).toBe(
        'Les champs startDate, endDate et userId sont requis.',
      );
    });

    it('should return error when endDate is missing', async () => {
      const createDto = buildCreateBlockedSlotDto({ endDate: undefined });

      const result = await service.createBlockedSlot(createDto, 'salon-1');

      expect(result.error).toBe(true);
      expect(result.message).toBe(
        'Les champs startDate, endDate et userId sont requis.',
      );
    });

    it('should return error when userId is missing', async () => {
      const createDto = buildCreateBlockedSlotDto();

      const result = await service.createBlockedSlot(createDto, '');

      expect(result.error).toBe(true);
      expect(result.message).toBe(
        'Les champs startDate, endDate et userId sont requis.',
      );
    });

    it('should return error for invalid startDate format', async () => {
      const createDto = buildCreateBlockedSlotDto({
        startDate: 'invalid-date',
      });

      const result = await service.createBlockedSlot(createDto, 'salon-1');

      expect(result.error).toBe(true);
      expect(result.message).toBe('Les dates fournies ne sont pas valides.');
    });

    it('should return error for invalid endDate format', async () => {
      const createDto = buildCreateBlockedSlotDto({ endDate: 'not-a-date' });

      const result = await service.createBlockedSlot(createDto, 'salon-1');

      expect(result.error).toBe(true);
      expect(result.message).toBe('Les dates fournies ne sont pas valides.');
    });

    it('should return error when startDate is after endDate', async () => {
      const createDto = buildCreateBlockedSlotDto({
        startDate: '2026-02-15T14:00:00Z',
        endDate: '2026-02-15T12:00:00Z',
      });

      const result = await service.createBlockedSlot(createDto, 'salon-1');

      expect(result.error).toBe(true);
      expect(result.message).toBe(
        'La date de fin doit être postérieure à la date de début.',
      );
    });

    it('should return error when startDate equals endDate', async () => {
      const createDto = buildCreateBlockedSlotDto({
        startDate: '2026-02-15T12:00:00Z',
        endDate: '2026-02-15T12:00:00Z',
      });

      const result = await service.createBlockedSlot(createDto, 'salon-1');

      expect(result.error).toBe(true);
      expect(result.message).toBe(
        'La date de fin doit être postérieure à la date de début.',
      );
    });

    it('should handle database errors gracefully', async () => {
      const createDto = buildCreateBlockedSlotDto();
      prismaMock.blockedTimeSlot.create.mockRejectedValue(
        new Error('Database error'),
      );

      const result = await service.createBlockedSlot(createDto, 'salon-1');

      expect(result.error).toBe(true);
      expect(result.message).toBe('Database error');
    });
  });

  describe('getBlockedSlotsBySalon', () => {
    it('should retrieve all blocked slots for a salon', async () => {
      const slots = [
        buildBlockedSlot(),
        buildBlockedSlot({ id: 'blocked-slot-2' }),
      ];
      prismaMock.blockedTimeSlot.findMany.mockResolvedValue(slots);

      const result = await service.getBlockedSlotsBySalon('salon-1');

      expect(result.error).toBe(false);
      expect(result.blockedSlots).toEqual(slots);
      expect(result.blockedSlots).toHaveLength(2);
      expect(prismaMock.blockedTimeSlot.findMany).toHaveBeenCalledWith({
        where: { userId: 'salon-1' },
        include: {
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { startDate: 'asc' },
      });
    });

    it('should return empty array when no blocked slots exist', async () => {
      prismaMock.blockedTimeSlot.findMany.mockResolvedValue([]);

      const result = await service.getBlockedSlotsBySalon('salon-1');

      expect(result.error).toBe(false);
      expect(result.blockedSlots).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      prismaMock.blockedTimeSlot.findMany.mockRejectedValue(
        new Error('Database error'),
      );

      const result = await service.getBlockedSlotsBySalon('salon-1');

      expect(result.error).toBe(true);
      expect(result.message).toBe('Database error');
    });

    it('should order slots by startDate ascending', async () => {
      const slots = [
        buildBlockedSlot({ startDate: new Date('2026-02-15T10:00:00Z') }),
        buildBlockedSlot({
          startDate: new Date('2026-02-14T10:00:00Z'),
          id: 'blocked-slot-2',
        }),
        buildBlockedSlot({
          startDate: new Date('2026-02-16T10:00:00Z'),
          id: 'blocked-slot-3',
        }),
      ];
      prismaMock.blockedTimeSlot.findMany.mockResolvedValue(slots);

      const result = await service.getBlockedSlotsBySalon('salon-1');

      expect(result.blockedSlots).toHaveLength(3);
    });
  });

  describe('getBlockedSlotsByTatoueur', () => {
    it('should retrieve all blocked slots for a tattoo artist', async () => {
      const slots = [
        buildBlockedSlot(),
        buildBlockedSlot({ id: 'blocked-slot-2' }),
      ];
      prismaMock.blockedTimeSlot.findMany.mockResolvedValue(slots);

      const result = await service.getBlockedSlotsByTatoueur('tatoueur-1');

      expect(result.error).toBe(false);
      expect(result.blockedSlots).toEqual(slots);
      expect(prismaMock.blockedTimeSlot.findMany).toHaveBeenCalledWith({
        where: { tatoueurId: 'tatoueur-1' },
        include: {
          tatoueur: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { startDate: 'asc' },
      });
    });

    it('should return empty array when tattoo artist has no blocked slots', async () => {
      prismaMock.blockedTimeSlot.findMany.mockResolvedValue([]);

      const result = await service.getBlockedSlotsByTatoueur('tatoueur-1');

      expect(result.error).toBe(false);
      expect(result.blockedSlots).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      prismaMock.blockedTimeSlot.findMany.mockRejectedValue(
        new Error('Database error'),
      );

      const result = await service.getBlockedSlotsByTatoueur('tatoueur-1');

      expect(result.error).toBe(true);
      expect(result.message).toBe('Database error');
    });
  });

  describe('isTimeSlotBlocked', () => {
    it('should return true when time slot is blocked for specific tatoueur', async () => {
      const blockedSlot = buildBlockedSlot();
      prismaMock.blockedTimeSlot.findFirst.mockResolvedValue(blockedSlot);

      const isBlocked = await service.isTimeSlotBlocked(
        new Date('2026-02-15T10:30:00Z'),
        new Date('2026-02-15T11:30:00Z'),
        'tatoueur-1',
        'salon-1',
      );

      expect(isBlocked).toBe(true);
      expect(prismaMock.blockedTimeSlot.findFirst).toHaveBeenCalled();
    });

    it('should return false when time slot is not blocked', async () => {
      prismaMock.blockedTimeSlot.findFirst.mockResolvedValue(null);

      const isBlocked = await service.isTimeSlotBlocked(
        new Date('2026-02-15T14:00:00Z'),
        new Date('2026-02-15T16:00:00Z'),
        'tatoueur-1',
        'salon-1',
      );

      expect(isBlocked).toBe(false);
    });

    it('should check for salon-wide blocks (tatoueurId: null)', async () => {
      const blockedSlot = buildBlockedSlot({ tatoueurId: null });
      prismaMock.blockedTimeSlot.findFirst.mockResolvedValue(blockedSlot);

      const isBlocked = await service.isTimeSlotBlocked(
        new Date('2026-02-15T10:30:00Z'),
        new Date('2026-02-15T11:30:00Z'),
        'tatoueur-1',
        'salon-1',
      );

      expect(isBlocked).toBe(true);
    });

    it('should check for salon-level blocks when no tatoueur specified', async () => {
      const blockedSlot = buildBlockedSlot();
      prismaMock.blockedTimeSlot.findFirst.mockResolvedValue(blockedSlot);

      const isBlocked = await service.isTimeSlotBlocked(
        new Date('2026-02-15T10:00:00Z'),
        new Date('2026-02-15T12:00:00Z'),
        undefined,
        'salon-1',
      );

      expect(isBlocked).toBe(true);
    });

    it('should handle overlapping blocked slots correctly', async () => {
      const blockedSlot = buildBlockedSlot({
        startDate: new Date('2026-02-15T10:00:00Z'),
        endDate: new Date('2026-02-15T12:00:00Z'),
      });
      prismaMock.blockedTimeSlot.findFirst.mockResolvedValue(blockedSlot);

      // Requested slot overlaps with blocked slot
      const isBlocked = await service.isTimeSlotBlocked(
        new Date('2026-02-15T11:00:00Z'),
        new Date('2026-02-15T13:00:00Z'),
        'tatoueur-1',
        'salon-1',
      );

      expect(isBlocked).toBe(true);
    });

    it('should return false when database error occurs', async () => {
      prismaMock.blockedTimeSlot.findFirst.mockRejectedValue(
        new Error('Database error'),
      );

      const isBlocked = await service.isTimeSlotBlocked(
        new Date('2026-02-15T10:00:00Z'),
        new Date('2026-02-15T12:00:00Z'),
        'tatoueur-1',
        'salon-1',
      );

      expect(isBlocked).toBe(false);
    });
  });

  describe('updateBlockedSlot', () => {
    it('should update a blocked slot successfully', async () => {
      const existingSlot = buildBlockedSlot();
      const updateDto = buildUpdateBlockedSlotDto();
      const updatedSlot = buildBlockedSlot({
        ...updateDto,
        startDate: new Date(updateDto.startDate),
        endDate: new Date(updateDto.endDate),
      });

      prismaMock.blockedTimeSlot.findUnique.mockResolvedValue(existingSlot);
      prismaMock.blockedTimeSlot.update.mockResolvedValue(updatedSlot);

      const result = await service.updateBlockedSlot(
        'blocked-slot-1',
        updateDto,
      );

      expect(result.error).toBe(false);
      expect(result.message).toBe('Créneau bloqué mis à jour avec succès.');
      expect(result.blockedSlot).toEqual(updatedSlot);
    });

    it('should return error when blocked slot does not exist', async () => {
      const updateDto = buildUpdateBlockedSlotDto();
      prismaMock.blockedTimeSlot.findUnique.mockResolvedValue(null);

      const result = await service.updateBlockedSlot(
        'nonexistent-id',
        updateDto,
      );

      expect(result.error).toBe(true);
      expect(result.message).toBe('Créneau bloqué introuvable.');
    });

    it('should update only startDate when provided', async () => {
      const existingSlot = buildBlockedSlot({
        startDate: new Date('2026-02-15T10:00:00Z'),
        endDate: new Date('2026-02-15T12:00:00Z'),
      });
      const updateDto = buildUpdateBlockedSlotDto({
        startDate: '2026-02-15T09:00:00Z', // Earlier than original
        endDate: undefined,
        reason: undefined,
        tatoueurId: undefined,
      });
      const updatedSlot = buildBlockedSlot({
        startDate: new Date('2026-02-15T09:00:00Z'),
        endDate: new Date('2026-02-15T12:00:00Z'),
      });

      prismaMock.blockedTimeSlot.findUnique.mockResolvedValue(existingSlot);
      prismaMock.blockedTimeSlot.update.mockResolvedValue(updatedSlot);

      const result = await service.updateBlockedSlot(
        'blocked-slot-1',
        updateDto,
      );

      expect(result.error).toBe(false);
    });

    it('should return error when new dates make startDate >= endDate', async () => {
      const existingSlot = buildBlockedSlot();
      const updateDto = buildUpdateBlockedSlotDto({
        startDate: '2026-02-16T16:00:00Z',
        endDate: '2026-02-16T14:00:00Z',
      });

      prismaMock.blockedTimeSlot.findUnique.mockResolvedValue(existingSlot);

      const result = await service.updateBlockedSlot(
        'blocked-slot-1',
        updateDto,
      );

      expect(result.error).toBe(true);
      expect(result.message).toBe(
        'La date de fin doit être postérieure à la date de début.',
      );
    });

    it('should allow updating reason to null', async () => {
      const existingSlot = buildBlockedSlot();
      const updateDto = buildUpdateBlockedSlotDto({ reason: null });
      const updatedSlot = buildBlockedSlot({ reason: null });

      prismaMock.blockedTimeSlot.findUnique.mockResolvedValue(existingSlot);
      prismaMock.blockedTimeSlot.update.mockResolvedValue(updatedSlot);

      const result = await service.updateBlockedSlot(
        'blocked-slot-1',
        updateDto,
      );

      expect(result.error).toBe(false);
    });

    it('should handle database errors gracefully', async () => {
      const updateDto = buildUpdateBlockedSlotDto();
      prismaMock.blockedTimeSlot.findUnique.mockRejectedValue(
        new Error('Database error'),
      );

      const result = await service.updateBlockedSlot(
        'blocked-slot-1',
        updateDto,
      );

      expect(result.error).toBe(true);
      expect(result.message).toBe('Database error');
    });
  });

  describe('deleteBlockedSlot', () => {
    it('should delete a blocked slot successfully', async () => {
      const existingSlot = buildBlockedSlot();
      prismaMock.blockedTimeSlot.findUnique.mockResolvedValue(existingSlot);
      prismaMock.blockedTimeSlot.delete.mockResolvedValue(existingSlot);

      const result = await service.deleteBlockedSlot('blocked-slot-1');

      expect(result.error).toBe(false);
      expect(result.message).toBe('Créneau bloqué supprimé avec succès.');
      expect(prismaMock.blockedTimeSlot.delete).toHaveBeenCalledWith({
        where: { id: 'blocked-slot-1' },
      });
    });

    it('should return error when blocked slot does not exist', async () => {
      prismaMock.blockedTimeSlot.findUnique.mockResolvedValue(null);

      const result = await service.deleteBlockedSlot('nonexistent-id');

      expect(result.error).toBe(true);
      expect(result.message).toBe('Créneau bloqué introuvable.');
      expect(prismaMock.blockedTimeSlot.delete).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      const existingSlot = buildBlockedSlot();
      prismaMock.blockedTimeSlot.findUnique.mockResolvedValue(existingSlot);
      prismaMock.blockedTimeSlot.delete.mockRejectedValue(
        new Error('Database error'),
      );

      const result = await service.deleteBlockedSlot('blocked-slot-1');

      expect(result.error).toBe(true);
      expect(result.message).toBe('Database error');
    });
  });

  describe('getProposedSlotsForSalon', () => {
    it('should retrieve proposed slots for a tattoo artist within date range', async () => {
      const slots = [
        buildProposedSlot(),
        buildProposedSlot({ id: 'proposed-slot-2' }),
      ];
      prismaMock.proposedSlot.findMany.mockResolvedValue(slots);

      const result = await service.getProposedSlotsForSalon(
        'tatoueur-1',
        '2026-02-20T00:00:00Z',
        '2026-02-28T23:59:59Z',
      );

      expect(result).toEqual(slots);
      expect(result).toHaveLength(2);
      expect(prismaMock.proposedSlot.findMany).toHaveBeenCalledWith({
        where: {
          tatoueurId: 'tatoueur-1',
          status: 'PENDING',
          from: {
            gte: new Date('2026-02-20T00:00:00Z'),
          },
          to: {
            lte: new Date('2026-02-28T23:59:59Z'),
          },
        },
        include: {
          appointmentRequest: {
            select: {
              id: true,
              clientFirstname: true,
              clientLastname: true,
              clientEmail: true,
              status: true,
              prestation: true,
              createdAt: true,
            },
          },
        },
        orderBy: { from: 'asc' },
      });
    });

    it('should return empty array when no proposed slots exist', async () => {
      prismaMock.proposedSlot.findMany.mockResolvedValue([]);

      const result = await service.getProposedSlotsForSalon(
        'tatoueur-1',
        '2026-02-20T00:00:00Z',
        '2026-02-28T23:59:59Z',
      );

      expect(result).toEqual([]);
    });

    it('should only fetch PENDING proposed slots', async () => {
      prismaMock.proposedSlot.findMany.mockResolvedValue([]);

      await service.getProposedSlotsForSalon(
        'tatoueur-1',
        '2026-02-20T00:00:00Z',
        '2026-02-28T23:59:59Z',
      );

      const callArgs = prismaMock.proposedSlot.findMany.mock.calls[0][0];
      expect(callArgs.where.status).toBe('PENDING');
    });

    it('should include appointment request details', async () => {
      const slots = [buildProposedSlot()];
      prismaMock.proposedSlot.findMany.mockResolvedValue(slots);

      const result = await service.getProposedSlotsForSalon(
        'tatoueur-1',
        '2026-02-20T00:00:00Z',
        '2026-02-28T23:59:59Z',
      );

      expect(result[0].appointmentRequest).toBeDefined();
      expect(result[0].appointmentRequest.clientFirstname).toBe('Alice');
      expect(result[0].appointmentRequest.clientEmail).toBe(
        'alice@example.com',
      );
    });

    it('should throw error on database failure', async () => {
      prismaMock.proposedSlot.findMany.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        service.getProposedSlotsForSalon(
          'tatoueur-1',
          '2026-02-20T00:00:00Z',
          '2026-02-28T23:59:59Z',
        ),
      ).rejects.toThrow('Erreur lors de la récupération des créneaux proposés');
    });

    it('should order proposed slots by from date ascending', async () => {
      const slots = [
        buildProposedSlot({ from: new Date('2026-02-20T10:00:00Z') }),
        buildProposedSlot({
          from: new Date('2026-02-19T10:00:00Z'),
          id: 'proposed-slot-2',
        }),
        buildProposedSlot({
          from: new Date('2026-02-21T10:00:00Z'),
          id: 'proposed-slot-3',
        }),
      ];
      prismaMock.proposedSlot.findMany.mockResolvedValue(slots);

      const result = await service.getProposedSlotsForSalon(
        'tatoueur-1',
        '2026-02-19T00:00:00Z',
        '2026-02-21T23:59:59Z',
      );

      expect(result).toHaveLength(3);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle multiple blocked slot operations sequentially', async () => {
      const slot1 = buildBlockedSlot();
      const slot2 = buildBlockedSlot({ id: 'blocked-slot-2' });

      prismaMock.blockedTimeSlot.findMany.mockResolvedValue([slot1, slot2]);

      const result1 = await service.getBlockedSlotsBySalon('salon-1');
      const result2 = await service.getBlockedSlotsBySalon('salon-1');

      expect(result1.blockedSlots).toHaveLength(2);
      expect(result2.blockedSlots).toHaveLength(2);
      expect(prismaMock.blockedTimeSlot.findMany).toHaveBeenCalledTimes(2);
    });

    it('should handle date boundaries correctly', async () => {
      prismaMock.blockedTimeSlot.findFirst.mockResolvedValue(null);

      const startDate = new Date('2026-02-15T00:00:00Z');
      const endDate = new Date('2026-02-15T23:59:59Z');

      const isBlocked = await service.isTimeSlotBlocked(
        startDate,
        endDate,
        'tatoueur-1',
        'salon-1',
      );

      expect(isBlocked).toBe(false);
    });

    it('should preserve data integrity across operations', async () => {
      const slot = buildBlockedSlot();
      prismaMock.blockedTimeSlot.findUnique.mockResolvedValue(slot);
      prismaMock.blockedTimeSlot.findMany.mockResolvedValue([slot]);

      const result1 = await service.getBlockedSlotsBySalon('salon-1');
      const result2 = await service.deleteBlockedSlot('blocked-slot-1');

      expect(result1.blockedSlots).toBeDefined();
      expect(result1.blockedSlots?.[0].id).toBe(slot.id);
      expect(result2.error).toBe(false);
    });

    it('should handle null values in optional fields', async () => {
      const slotWithNulls = buildBlockedSlot({
        reason: null,
        tatoueurId: null,
      });
      prismaMock.blockedTimeSlot.findMany.mockResolvedValue([slotWithNulls]);

      const result = await service.getBlockedSlotsBySalon('salon-1');

      expect(result.blockedSlots).toBeDefined();
      expect(result.blockedSlots?.[0].reason).toBeNull();
      expect(result.blockedSlots?.[0].tatoueurId).toBeNull();
    });

    it('should handle empty proposed slots list', async () => {
      prismaMock.proposedSlot.findMany.mockResolvedValue([]);

      const result = await service.getProposedSlotsForSalon(
        'tatoueur-1',
        '2026-02-20T00:00:00Z',
        '2026-02-28T23:59:59Z',
      );

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle complex date range scenarios', async () => {
      prismaMock.blockedTimeSlot.findFirst.mockResolvedValue(null);

      // Query slot after blocked period
      const isBlocked = await service.isTimeSlotBlocked(
        new Date('2026-02-15T13:00:00Z'),
        new Date('2026-02-15T14:00:00Z'),
        'tatoueur-1',
        'salon-1',
      );

      expect(isBlocked).toBe(false);
    });
  });
});
