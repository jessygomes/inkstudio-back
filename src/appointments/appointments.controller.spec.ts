/* eslint-disable prettier/prettier */
import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsController', () => {
  let controller: AppointmentsController;
  const appointmentsService = {
    getSkinTones: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [
        {
          provide: AppointmentsService,
          useValue: appointmentsService,
        },
      ],
    }).compile();

    controller = module.get<AppointmentsController>(AppointmentsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return skin tone options from the service', () => {
    const skinTones = [
      { value: 'claire', label: 'Claire', previewHex: '#EAC8AF' },
    ];
    appointmentsService.getSkinTones.mockReturnValue(skinTones);

    expect(controller.getSkinTones()).toBe(skinTones);
    expect(appointmentsService.getSkinTones).toHaveBeenCalled();
  });
});
