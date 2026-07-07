import { Test, TestingModule } from '@nestjs/testing';
import { TatoueursController } from './tatoueurs.controller';
import { TatoueursService } from './tatoueurs.service';

describe('TatoueursController', () => {
  let controller: TatoueursController;
  let service: {
    updateTatoueur: jest.Mock,
    deleteTatoueur: jest.Mock,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TatoueursController],
      providers: [
        {
          provide: TatoueursService,
          useValue: {
            updateTatoueur: jest.fn(),
            deleteTatoueur: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<TatoueursController>(TatoueursController);
    service = module.get(TatoueursService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('forwards authenticated userId to updateTatoueur', async () => {
    const req = { user: { userId: 'u1' } };
    service.updateTatoueur.mockResolvedValue({ error: false });

    await controller.updateTatoueur(req as any, 't1', {
      name: 'John',
      img: 'img.jpg',
      description: 'desc',
      phone: '123',
      instagram: '@john',
      hours: 'Mon-Fri',
      style: ['fine line'],
      skills: ['linework'],
      rdvBookingEnabled: true,
    });

    expect(service.updateTatoueur).toHaveBeenCalledWith(
      't1',
      expect.any(Object),
      'u1',
    );
  });

  it('forwards authenticated userId to deleteTatoueur', async () => {
    const req = { user: { userId: 'u1' } };
    service.deleteTatoueur.mockResolvedValue({ error: false });

    await controller.deleteTatoueur(req as any, 't1');

    expect(service.deleteTatoueur).toHaveBeenCalledWith('t1', 'u1');
  });
});
