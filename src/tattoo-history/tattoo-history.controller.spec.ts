import { Test, TestingModule } from '@nestjs/testing';
import { TattooHistoryController } from './tattoo-history.controller';
import { TattooHistoryService } from './tattoo-history.service';

describe('TattooHistoryController', () => {
  let controller: TattooHistoryController;
  let service: {
    updateHistory: jest.Mock,
    deleteHistory: jest.Mock,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TattooHistoryController],
      providers: [
        {
          provide: TattooHistoryService,
          useValue: {
            updateHistory: jest.fn(),
            deleteHistory: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<TattooHistoryController>(TattooHistoryController);
    service = module.get(TattooHistoryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('forwards authenticated userId to updateHistory', async () => {
    const req = { user: { userId: 'salon-1' } };
    service.updateHistory.mockResolvedValue({ error: false });

    await controller.updateHistory(req as any, 'history-1', {
      clientId: 'client-1',
      tatoueurId: 'tatoueur-1',
      date: '2026-01-15T10:00:00Z',
      description: 'desc',
      zone: 'arm',
      size: 'small',
      price: 100,
      inkUsed: 'black',
      healingTime: '10 days',
      careProducts: 'cream',
    });

    expect(service.updateHistory).toHaveBeenCalledWith(
      'history-1',
      expect.any(Object),
      'salon-1',
    );
  });

  it('forwards authenticated userId to deleteHistory', async () => {
    const req = { user: { userId: 'salon-1' } };
    service.deleteHistory.mockResolvedValue({ error: false });

    await controller.deleteHistory(req as any, 'history-1');

    expect(service.deleteHistory).toHaveBeenCalledWith('history-1', 'salon-1');
  });
});
