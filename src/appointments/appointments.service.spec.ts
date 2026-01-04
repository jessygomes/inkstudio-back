/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsService } from './appointments.service';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/email/mailer.service';
import { FollowupSchedulerService } from 'src/follow-up/followup-scheduler.service';
import { SaasService } from 'src/saas/saas.service';
import { VideoCallService } from 'src/video-call/video-call.service';
import { CacheService } from 'src/redis/cache.service';

const createPrismaMock = () => ({
  appointment: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
});

const createCacheMock = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
});

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let cache: ReturnType<typeof createCacheMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    cache = createCacheMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: {} },
        { provide: FollowupSchedulerService, useValue: {} },
        { provide: SaasService, useValue: {} },
        { provide: VideoCallService, useValue: {} },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
    jest.clearAllMocks();
  });

  it('returns cached date range appointments when present', async () => {
    const cached = {
      error: false,
      appointments: [{ id: 'a1' }],
      pagination: { currentPage: 1 },
    };
    cache.get.mockResolvedValue(cached);

    const result = await service.getAppointmentsByDateRange(
      'u1',
      '2024-01-01',
      '2024-01-31',
    );

    expect(result).toEqual(cached);
    expect(prisma.appointment.count).not.toHaveBeenCalled();
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('fetches date range appointments and caches them', async () => {
    cache.get.mockResolvedValue(null);
    prisma.appointment.count.mockResolvedValue(2);
    prisma.appointment.findMany.mockResolvedValue([
      { id: 'a1', start: new Date('2024-01-02') },
      { id: 'a2', start: new Date('2024-01-03') },
    ]);

    const result = await service.getAppointmentsByDateRange(
      'u1',
      '2024-01-01',
      '2024-01-31',
      1,
      5,
    );

    expect(result.error).toBe(false);
    const success = result as {
      error: false,
      appointments: any[],
      pagination: any,
    };
    expect(success.appointments).toHaveLength(2);
    expect(success.pagination.totalAppointments).toBe(2);
    expect(success.pagination.totalPages).toBe(1);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), result, 300);
  });

  it('returns cached salon appointments when present', async () => {
    const cached = {
      error: false,
      appointments: [{ id: 's1' }],
      pagination: { currentPage: 1 },
    };
    cache.get.mockResolvedValue(cached);

    const result = await service.getAllAppointmentsBySalon('salon1');

    expect(result).toEqual(cached);
    expect(prisma.appointment.count).not.toHaveBeenCalled();
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('fetches salon appointments and caches them', async () => {
    cache.get.mockResolvedValue(null);
    prisma.appointment.count.mockResolvedValue(1);
    prisma.appointment.findMany.mockResolvedValue([{ id: 's1' }]);

    const result = await service.getAllAppointmentsBySalon('salon1', 1, 5);

    expect(result.error).toBe(false);
    const success = result as {
      error: false,
      appointments: any[],
      pagination: any,
    };
    expect(success.appointments).toHaveLength(1);
    expect(success.pagination.totalAppointments).toBe(1);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), result, 300);
  });

  it('returns empty array when tatoueur appointments query is null', async () => {
    prisma.appointment.findMany.mockResolvedValue(null as any);

    const result = await service.getAppointmentsByTatoueurRange(
      't1',
      '2024-01-01',
      '2024-01-31',
    );

    expect(result).toEqual([]);
  });

  it('returns cached appointment when available', async () => {
    const cached = {
      id: 'a1',
      title: 'Test',
      start: new Date(),
      end: new Date(),
    };
    cache.get.mockResolvedValue(cached);

    const result = await service.getOneAppointment('a1');

    expect(result).toEqual(cached);
    expect(prisma.appointment.findUnique).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('fetches one appointment and caches it when not cached', async () => {
    cache.get.mockResolvedValue(null);
    const appointment = {
      id: 'a2',
      title: 'New',
      start: new Date(),
      end: new Date(),
    };
    prisma.appointment.findUnique.mockResolvedValue(appointment as any);

    const result = await service.getOneAppointment('a2');

    expect(result).toEqual(appointment);
    expect(cache.set).toHaveBeenCalledWith(
      expect.any(String),
      appointment,
      600,
    );
  });
});
