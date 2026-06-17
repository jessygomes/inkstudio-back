/* eslint-disable prettier/prettier */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsController', () => {
  let controller: AppointmentsController;
  const appointmentsService = {
    getSkinTones: jest.fn(),
    getAllAppointmentsBySalon: jest.fn(),
    getAppointmentsBySalonRange: jest.fn(),
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

  it('should throw ForbiddenException when salon id does not match authenticated user for salon listing', async () => {
    await expect(
      controller.getAllAppointmentsBySalon(
        { user: { userId: 'auth-salon' } } as any,
        'another-salon',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      appointmentsService.getAllAppointmentsBySalon,
    ).not.toHaveBeenCalled();
  });

  it('should use authenticated user id for salon listing when ids match', async () => {
    appointmentsService.getAllAppointmentsBySalon.mockResolvedValue({
      error: false,
      appointments: [],
    });

    await controller.getAllAppointmentsBySalon(
      { user: { userId: 'auth-salon' } } as any,
      'auth-salon',
      '1',
      '5',
      'CONFIRMED',
      'upcoming',
      'tat-1',
      'TATTOO',
      'john',
    );

    expect(appointmentsService.getAllAppointmentsBySalon).toHaveBeenCalledWith(
      'auth-salon',
      1,
      5,
      'CONFIRMED',
      'upcoming',
      'tat-1',
      'TATTOO',
      'john',
    );
  });

  it('should throw ForbiddenException when salon id does not match authenticated user for range', async () => {
    await expect(
      controller.getAppointmentsBySalonRange(
        { user: { userId: 'auth-salon' } } as any,
        'another-salon',
        '2026-01-01',
        '2026-01-31',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      appointmentsService.getAppointmentsBySalonRange,
    ).not.toHaveBeenCalled();
  });

  it('should use authenticated user id for salon range when ids match', async () => {
    appointmentsService.getAppointmentsBySalonRange.mockResolvedValue([]);

    await controller.getAppointmentsBySalonRange(
      { user: { userId: 'auth-salon' } } as any,
      'auth-salon',
      '2026-01-01',
      '2026-01-31',
    );

    expect(
      appointmentsService.getAppointmentsBySalonRange,
    ).toHaveBeenCalledWith('auth-salon', '2026-01-01', '2026-01-31');
  });
});
