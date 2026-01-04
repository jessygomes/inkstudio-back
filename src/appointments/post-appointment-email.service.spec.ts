import { PostAppointmentEmailService } from './post-appointment-email.service';
import { AppointmentStatus, PrestationType } from '@prisma/client';

describe('PostAppointmentEmailService', () => {
  const prisma = {
    appointment: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  } as any;

  const mailService = {
    sendRetouchesReminder: jest.fn(),
    sendFollowUp: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('envoie le suivi 7 jours pour TATTOO/PIERCING/RETOUCHE complétés et marque followUp7SentAt', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    const appointments = [
      {
        id: 'apt_tattoo',
        status: AppointmentStatus.COMPLETED,
        prestation: PrestationType.TATTOO,
        end: eightDaysAgo,
        followUp7SentAt: null,
        user: { salonName: 'Inkera', email: 'salon@example.com' },
        clientUser: {
          email: 'tattoo@example.com',
          firstName: 'Tat',
          lastName: 'Too',
        },
        client: null,
        tatoueur: null,
      },
      {
        id: 'apt_piercing',
        status: AppointmentStatus.COMPLETED,
        prestation: PrestationType.PIERCING,
        end: eightDaysAgo,
        followUp7SentAt: null,
        user: { salonName: 'Inkera', email: 'salon@example.com' },
        clientUser: null,
        client: {
          email: 'piercing@example.com',
          firstName: 'Pier',
          lastName: 'Cing',
        },
        tatoueur: null,
      },
      {
        id: 'apt_retouche',
        status: AppointmentStatus.COMPLETED,
        prestation: PrestationType.RETOUCHE,
        end: eightDaysAgo,
        followUp7SentAt: null,
        user: { salonName: 'Inkera', email: 'salon@example.com' },
        clientUser: {
          email: 'retouche@example.com',
          firstName: 'Re',
          lastName: 'Touche',
        },
        client: null,
        tatoueur: null,
      },
    ];

    prisma.appointment.findMany
      .mockResolvedValueOnce(appointments) // 7-day batch
      .mockResolvedValueOnce([]); // 30-day batch

    prisma.appointment.update.mockResolvedValue({});
    mailService.sendFollowUp.mockResolvedValue({});

    const service = new PostAppointmentEmailService(prisma, mailService);

    const result = await service.sendDueEmails();

    expect(result.sent7Days).toBe(3);
    expect(result.sent30Days).toBe(0);

    expect(mailService.sendFollowUp).toHaveBeenCalledTimes(3);
    expect(mailService.sendRetouchesReminder).not.toHaveBeenCalled();

    expect(prisma.appointment.update).toHaveBeenCalledTimes(3);
    appointments.forEach((appt) => {
      expect(prisma.appointment.update).toHaveBeenCalledWith({
        where: { id: appt.id },
        data: expect.objectContaining({ followUp7SentAt: expect.any(Date) }),
      });
    });
  });

  it('envoie le rappel retouches à J+30 pour un TATTOO complété et marque followUp30SentAt', async () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

    const appointment = {
      id: 'apt_1',
      status: AppointmentStatus.COMPLETED,
      prestation: PrestationType.TATTOO,
      end: thirtyOneDaysAgo,
      followUp30SentAt: null,
      user: { salonName: 'Inkera', email: 'salon@example.com' },
      clientUser: {
        email: 'client@example.com',
        firstName: 'John',
        lastName: 'Doe',
      },
      client: null,
      tatoueur: { firstName: 'Jane', lastName: 'Artist', nickname: null },
    };

    prisma.appointment.findMany
      .mockResolvedValueOnce([]) // 7-day batch
      .mockResolvedValueOnce([appointment]); // 30-day batch

    prisma.appointment.update.mockResolvedValue(appointment);
    mailService.sendRetouchesReminder.mockResolvedValue({});

    const service = new PostAppointmentEmailService(prisma, mailService);

    const result = await service.sendDueEmails();

    expect(result.sent7Days).toBe(0);
    expect(result.sent30Days).toBe(1);

    expect(mailService.sendRetouchesReminder).toHaveBeenCalledTimes(1);
    expect(mailService.sendRetouchesReminder).toHaveBeenCalledWith(
      'client@example.com',
      expect.objectContaining({
        recipientName: 'John Doe',
        salonName: 'Inkera',
      }),
      'Inkera',
    );

    expect(prisma.appointment.update).toHaveBeenCalledTimes(1);
    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'apt_1' },
      data: expect.objectContaining({ followUp30SentAt: expect.any(Date) }),
    });
  });
});
