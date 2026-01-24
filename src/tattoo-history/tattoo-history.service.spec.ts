/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { TattooHistoryService } from './tattoo-history.service';
import { PrismaService } from 'src/database/prisma.service';

// Mock factory
const createPrismaMock = () => ({
  client: {
    findUnique: jest.fn(),
  },
  tattooHistory: {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
});

// DTO and data builders
const buildCreateTattooHistoryDto = (overrides?: Partial<any>) => ({
  clientId: 'client-1',
  tatoueurId: 'tatoueur-1',
  date: '2026-01-15T10:00:00Z',
  description: 'Dragon tattoo on back',
  photo: 'http://example.com/photo.jpg',
  zone: 'back',
  size: 'large',
  price: 200,
  inkUsed: 'black',
  healingTime: '14 days',
  careProducts: 'sunscreen and lotion',
  ...overrides,
});

const buildClient = (overrides?: Partial<any>) => ({
  id: 'client-1',
  firstName: 'Jean',
  lastName: 'Dupont',
  email: 'jean@example.com',
  userId: 'salon-1',
  ...overrides,
});

const buildTattooHistory = (overrides?: Partial<any>) => ({
  id: 'history-1',
  clientId: 'client-1',
  date: new Date('2026-01-15T10:00:00Z'),
  description: 'Dragon tattoo on back',
  photo: 'http://example.com/photo.jpg',
  zone: 'back',
  size: 'large',
  price: 200,
  inkUsed: 'black',
  healingTime: '14 days',
  careProducts: 'sunscreen and lotion',
  createdAt: new Date('2026-01-15T10:00:00Z'),
  updatedAt: new Date('2026-01-15T10:00:00Z'),
  ...overrides,
});

describe('TattooHistoryService', () => {
  let service: TattooHistoryService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = createPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TattooHistoryService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<TattooHistoryService>(TattooHistoryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createHistory', () => {
    it('should create a tattoo history successfully', async () => {
      const createDto = buildCreateTattooHistoryDto();
      const client = buildClient();
      const history = buildTattooHistory();

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockResolvedValue(history);

      const result = await service.createHistory(createDto);

      expect(result.error).toBe(false);
      expect(result.message).toContain('succès');
      expect(result.history).toEqual(history);
      expect(prismaMock.client.findUnique).toHaveBeenCalledWith({
        where: { id: createDto.clientId },
      });
    });

    it('should return error when client not found', async () => {
      const createDto = buildCreateTattooHistoryDto();
      prismaMock.client.findUnique.mockResolvedValue(null);

      const result = await service.createHistory(createDto);

      expect(result.error).toBe(true);
      expect(result.message).toContain('Client introuvable');
      expect(result.history).toBeUndefined();
      expect(prismaMock.tattooHistory.create).not.toHaveBeenCalled();
    });

    it('should convert date string to Date object', async () => {
      const createDto = buildCreateTattooHistoryDto({
        date: '2026-02-20T15:30:00Z',
      });
      const client = buildClient();
      const history = buildTattooHistory();

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockResolvedValue(history);

      await service.createHistory(createDto);

      const callArgs = prismaMock.tattooHistory.create.mock.calls[0][0];
      expect(callArgs.data.date).toEqual(new Date('2026-02-20T15:30:00Z'));
    });

    it('should include all provided fields in created history', async () => {
      const createDto = buildCreateTattooHistoryDto({
        zone: 'shoulder',
        size: 'medium',
        price: 150,
        healingTime: 10,
      });
      const client = buildClient();
      const history = buildTattooHistory();

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockResolvedValue(history);

      await service.createHistory(createDto);

      const callArgs = prismaMock.tattooHistory.create.mock.calls[0][0];
      expect(callArgs.data).toMatchObject({
        zone: 'shoulder',
        size: 'medium',
        price: 150,
        healingTime: 10,
      });
    });

    it('should handle database errors gracefully', async () => {
      const createDto = buildCreateTattooHistoryDto();
      const client = buildClient();

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockRejectedValue(
        new Error('Database error'),
      );

      const result = await service.createHistory(createDto);

      expect(result.error).toBe(true);
      expect(result.message).toContain('Database error');
    });

    it('should handle null photo gracefully', async () => {
      const createDto = buildCreateTattooHistoryDto({ photo: null });
      const client = buildClient();
      const history = buildTattooHistory({ photo: null });

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockResolvedValue(history);

      const result = await service.createHistory(createDto);

      expect(result.error).toBe(false);
      expect(result.history?.photo).toBeNull();
    });

    it('should handle missing optional fields', async () => {
      const createDto = buildCreateTattooHistoryDto({
        photo: undefined,
        careProducts: undefined,
      });
      const client = buildClient();
      const history = buildTattooHistory();

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockResolvedValue(history);

      const result = await service.createHistory(createDto);

      expect(result.error).toBe(false);
      expect(result.history).toBeDefined();
    });

    it('should preserve all fields through create operation', async () => {
      const createDto = buildCreateTattooHistoryDto();
      const client = buildClient();
      const history = buildTattooHistory(createDto);

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockResolvedValue(history);

      const result = await service.createHistory(createDto);

      expect(result.history?.description).toBe(createDto.description);
      expect(result.history?.zone).toBe(createDto.zone);
      expect(result.history?.price).toBe(createDto.price);
    });
  });

  describe('updateHistory', () => {
    it('should update a tattoo history successfully', async () => {
      const updateDto = buildCreateTattooHistoryDto({
        description: 'Updated dragon tattoo',
      });
      const updatedHistory = buildTattooHistory({
        description: 'Updated dragon tattoo',
      });

      prismaMock.tattooHistory.update.mockResolvedValue(updatedHistory);

      const result = await service.updateHistory('history-1', updateDto);

      expect(result.error).toBe(false);
      expect(result.message).toContain('mis à jour');
      expect(result.history).toEqual(updatedHistory);
      expect(prismaMock.tattooHistory.update).toHaveBeenCalledWith({
        where: { id: 'history-1' },
        data: expect.objectContaining({
          description: 'Updated dragon tattoo',
        }),
      });
    });

    it('should convert date string to Date object on update', async () => {
      const updateDto = buildCreateTattooHistoryDto({
        date: '2026-03-10T09:00:00Z',
      });
      const history = buildTattooHistory();

      prismaMock.tattooHistory.update.mockResolvedValue(history);

      await service.updateHistory('history-1', updateDto);

      const callArgs = prismaMock.tattooHistory.update.mock.calls[0][0];
      expect(callArgs.data.date).toEqual(new Date('2026-03-10T09:00:00Z'));
    });

    it('should handle update errors gracefully', async () => {
      const updateDto = buildCreateTattooHistoryDto();
      prismaMock.tattooHistory.update.mockRejectedValue(
        new Error('Update failed'),
      );

      const result = await service.updateHistory('history-1', updateDto);

      expect(result.error).toBe(true);
      expect(result.message).toContain('Update failed');
    });

    it('should allow updating only specific fields', async () => {
      const updateDto = buildCreateTattooHistoryDto({
        description: 'New description',
        price: 250,
      });
      const history = buildTattooHistory();

      prismaMock.tattooHistory.update.mockResolvedValue(history);

      const result = await service.updateHistory('history-1', updateDto);

      expect(result.error).toBe(false);
      const callArgs = prismaMock.tattooHistory.update.mock.calls[0][0];
      expect(callArgs.data.description).toBe('New description');
      expect(callArgs.data.price).toBe(250);
    });

    it('should handle null values in update', async () => {
      const updateDto = buildCreateTattooHistoryDto({ careProducts: null });
      const history = buildTattooHistory({ careProducts: null });

      prismaMock.tattooHistory.update.mockResolvedValue(history);

      const result = await service.updateHistory('history-1', updateDto);

      expect(result.error).toBe(false);
      expect(result.history?.careProducts).toBeNull();
    });
  });

  describe('deleteHistory', () => {
    it('should delete a tattoo history successfully', async () => {
      const history = buildTattooHistory();
      prismaMock.tattooHistory.delete.mockResolvedValue(history);

      const result = await service.deleteHistory('history-1');

      expect(result.error).toBe(false);
      expect(result.message).toContain('supprimé');
      expect(result.history).toEqual(history);
      expect(prismaMock.tattooHistory.delete).toHaveBeenCalledWith({
        where: { id: 'history-1' },
      });
    });

    it('should handle delete errors gracefully', async () => {
      prismaMock.tattooHistory.delete.mockRejectedValue(
        new Error('Delete failed'),
      );

      const result = await service.deleteHistory('history-1');

      expect(result.error).toBe(true);
      expect(result.message).toContain('Delete failed');
    });

    it('should handle non-existent history deletion', async () => {
      prismaMock.tattooHistory.delete.mockRejectedValue(
        new Error('Record not found'),
      );

      const result = await service.deleteHistory('non-existent-id');

      expect(result.error).toBe(true);
      expect(result.message).toContain('Record not found');
    });
  });

  describe('getSalonTattooHistories', () => {
    it('should retrieve all tattoo histories for a salon', async () => {
      const histories = [
        buildTattooHistory(),
        buildTattooHistory({ id: 'history-2', description: 'Phoenix tattoo' }),
      ];
      prismaMock.tattooHistory.findMany.mockResolvedValue(histories);

      const result = await service.getSalonTattooHistories('salon-1');

      expect(result.error).toBe(false);
      expect(result.message).toContain('succès');
      expect(result.histories).toEqual(histories);
      expect(result.histories).toHaveLength(2);
    });

    it('should order histories by date descending', async () => {
      const histories = [buildTattooHistory()];
      prismaMock.tattooHistory.findMany.mockResolvedValue(histories);

      await service.getSalonTattooHistories('salon-1');

      const callArgs = prismaMock.tattooHistory.findMany.mock.calls[0][0];
      expect(callArgs.orderBy).toEqual({ date: 'desc' });
    });

    it('should filter by salon user ID', async () => {
      const histories = [buildTattooHistory()];
      prismaMock.tattooHistory.findMany.mockResolvedValue(histories);

      await service.getSalonTattooHistories('salon-1');

      const callArgs = prismaMock.tattooHistory.findMany.mock.calls[0][0];
      expect(callArgs.where).toEqual({
        client: {
          userId: 'salon-1',
        },
      });
    });

    it('should return empty array when no histories found', async () => {
      prismaMock.tattooHistory.findMany.mockResolvedValue([]);

      const result = await service.getSalonTattooHistories('salon-1');

      expect(result.error).toBe(false);
      expect(result.histories).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      prismaMock.tattooHistory.findMany.mockRejectedValue(
        new Error('Database error'),
      );

      const result = await service.getSalonTattooHistories('salon-1');

      expect(result.error).toBe(true);
      expect(result.message).toContain('Database error');
    });

    it('should retrieve histories for different salons separately', async () => {
      const salon1Histories = [buildTattooHistory({ clientId: 'client-1' })];
      const salon2Histories = [
        buildTattooHistory({ clientId: 'client-2', id: 'history-3' }),
      ];

      prismaMock.tattooHistory.findMany
        .mockResolvedValueOnce(salon1Histories)
        .mockResolvedValueOnce(salon2Histories);

      const result1 = await service.getSalonTattooHistories('salon-1');
      const result2 = await service.getSalonTattooHistories('salon-2');

      expect(result1.histories).toHaveLength(1);
      expect(result2.histories).toHaveLength(1);
    });

    it('should include complete tattoo history data', async () => {
      const history = buildTattooHistory({
        description: 'Tiger tattoo',
        zone: 'arm',
        size: 'large',
        price: 300,
      });
      prismaMock.tattooHistory.findMany.mockResolvedValue([history]);

      const result = await service.getSalonTattooHistories('salon-1');

      expect(result.histories?.[0]).toMatchObject({
        description: 'Tiger tattoo',
        zone: 'arm',
        size: 'large',
        price: 300,
      });
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle multiple create operations sequentially', async () => {
      const dto1 = buildCreateTattooHistoryDto();
      const dto2 = buildCreateTattooHistoryDto({
        description: 'Second tattoo',
      });
      const client = buildClient();
      const history1 = buildTattooHistory();
      const history2 = buildTattooHistory({
        id: 'history-2',
        description: 'Second tattoo',
      });

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create
        .mockResolvedValueOnce(history1)
        .mockResolvedValueOnce(history2);

      const result1 = await service.createHistory(dto1);
      const result2 = await service.createHistory(dto2);

      expect(result1.error).toBe(false);
      expect(result2.error).toBe(false);
      expect(result1.history?.id).not.toBe(result2.history?.id);
    });

    it('should preserve data integrity across create-update-delete', async () => {
      const createDto = buildCreateTattooHistoryDto();
      const client = buildClient();
      const history = buildTattooHistory();
      const updatedHistory = buildTattooHistory({ description: 'Updated' });

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockResolvedValue(history);
      prismaMock.tattooHistory.update.mockResolvedValue(updatedHistory);
      prismaMock.tattooHistory.delete.mockResolvedValue(updatedHistory);

      const createResult = await service.createHistory(createDto);
      const updateResult = await service.updateHistory(history.id, createDto);
      const deleteResult = await service.deleteHistory(history.id);

      expect(createResult.error).toBe(false);
      expect(updateResult.error).toBe(false);
      expect(deleteResult.error).toBe(false);
    });

    it('should handle very large price values', async () => {
      const createDto = buildCreateTattooHistoryDto({ price: 999999 });
      const client = buildClient();
      const history = buildTattooHistory({ price: 999999 });

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockResolvedValue(history);

      const result = await service.createHistory(createDto);

      expect(result.error).toBe(false);
      expect(result.history?.price).toBe(999999);
    });

    it('should handle very long descriptions', async () => {
      const longDescription = 'A'.repeat(1000);
      const createDto = buildCreateTattooHistoryDto({
        description: longDescription,
      });
      const client = buildClient();
      const history = buildTattooHistory({ description: longDescription });

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockResolvedValue(history);

      const result = await service.createHistory(createDto);

      expect(result.error).toBe(false);
      expect(result.history?.description?.length).toBe(1000);
    });

    it('should handle special characters in description', async () => {
      const specialDescription = 'Dragon & Phoenix @ 50% sale! #art';
      const createDto = buildCreateTattooHistoryDto({
        description: specialDescription,
      });
      const client = buildClient();
      const history = buildTattooHistory({ description: specialDescription });

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockResolvedValue(history);

      const result = await service.createHistory(createDto);

      expect(result.error).toBe(false);
      expect(result.history?.description).toBe(specialDescription);
    });

    it('should handle zero price', async () => {
      const createDto = buildCreateTattooHistoryDto({ price: 0 });
      const client = buildClient();
      const history = buildTattooHistory({ price: 0 });

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockResolvedValue(history);

      const result = await service.createHistory(createDto);

      expect(result.error).toBe(false);
      expect(result.history?.price).toBe(0);
    });

    it('should handle very long healing time', async () => {
      const createDto = buildCreateTattooHistoryDto({
        healingTime: 'Complete healing takes 365 days for optimal results',
      });
      const client = buildClient();
      const history = buildTattooHistory({
        healingTime: 'Complete healing takes 365 days for optimal results',
      });

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create.mockResolvedValue(history);

      const result = await service.createHistory(createDto);

      expect(result.error).toBe(false);
      expect(result.history?.healingTime).toContain('365');
    });

    it('should return consistent error messages', async () => {
      const createDto = buildCreateTattooHistoryDto();
      const errorMessage = 'Specific database error';

      prismaMock.client.findUnique.mockResolvedValue(buildClient());
      prismaMock.tattooHistory.create.mockRejectedValue(
        new Error(errorMessage),
      );

      const result1 = await service.createHistory(createDto);
      const result2 = await service.createHistory(createDto);

      expect(result1.message).toContain(errorMessage);
      expect(result2.message).toContain(errorMessage);
    });

    it('should handle concurrent operations', async () => {
      const dto = buildCreateTattooHistoryDto();
      const client = buildClient();
      const history1 = buildTattooHistory();
      const history2 = buildTattooHistory({ id: 'history-2' });

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create
        .mockResolvedValueOnce(history1)
        .mockResolvedValueOnce(history2);

      const [result1, result2] = await Promise.all([
        service.createHistory(dto),
        service.createHistory(dto),
      ]);

      expect(result1.error).toBe(false);
      expect(result2.error).toBe(false);
      expect(result1.history?.id).not.toBe(result2.history?.id);
    });

    it('should maintain error objects properly', async () => {
      const createDto = buildCreateTattooHistoryDto();
      prismaMock.client.findUnique.mockResolvedValue(null);

      const result = await service.createHistory(createDto);

      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('message');
      expect(result.error).toBe(true);
      expect(typeof result.message).toBe('string');
    });

    it('should handle date edge cases', async () => {
      const minDate = '1970-01-01T00:00:00Z';
      const maxDate = '2099-12-31T23:59:59Z';

      const createDto1 = buildCreateTattooHistoryDto({ date: minDate });
      const createDto2 = buildCreateTattooHistoryDto({ date: maxDate });

      const client = buildClient();
      const history1 = buildTattooHistory({ date: new Date(minDate) });
      const history2 = buildTattooHistory({ date: new Date(maxDate) });

      prismaMock.client.findUnique.mockResolvedValue(client);
      prismaMock.tattooHistory.create
        .mockResolvedValueOnce(history1)
        .mockResolvedValueOnce(history2);

      const result1 = await service.createHistory(createDto1);
      const result2 = await service.createHistory(createDto2);

      expect(result1.error).toBe(false);
      expect(result2.error).toBe(false);
    });
  });
});
