/* eslint-disable prettier/prettier */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { SaasLimitGuard } from 'src/saas/saas-limit.guard';
import { SaasService } from 'src/saas/saas.service';

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
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn().mockReturnValue(true) },
        },
        {
          provide: SaasLimitGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: SaasService,
          useValue: {
            enforceSaasAccess: jest.fn().mockResolvedValue(undefined),
          },
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

  it('should allow public salon range access and return only occupied slot bounds', async () => {
    appointmentsService.getAppointmentsBySalonRange.mockResolvedValue([
      {
        id: 'apt-1',
        start: new Date('2026-01-10T09:00:00.000Z'),
        end: new Date('2026-01-10T09:30:00.000Z'),
        title: 'Should be hidden',
      },
    ]);

    const result = await controller.getAppointmentsBySalonRange(
      {} as any,
      'public-salon',
      '2026-01-01',
      '2026-01-31',
    );

    expect(
      appointmentsService.getAppointmentsBySalonRange,
    ).toHaveBeenCalledWith('public-salon', '2026-01-01', '2026-01-31');
    expect(result).toEqual([
      {
        start: new Date('2026-01-10T09:00:00.000Z'),
        end: new Date('2026-01-10T09:30:00.000Z'),
      },
    ]);
  });
});
