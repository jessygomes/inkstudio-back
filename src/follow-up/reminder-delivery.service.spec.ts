import { ReminderDeliveryService } from './reminder-delivery.service';
import {
  DEFAULT_FOLLOW_UP_MESSAGE,
  DEFAULT_RETOUCH_MESSAGE,
  renderReminderMessage,
} from './reminder-settings';
import { EmailTemplateService } from '../email/email-template.service';

describe('Appointment reminder delivery', () => {
  let prisma: any;
  let service: ReminderDeliveryService;
  let appointment: any;
  let records: Map<string, any>;
  let mail: any;
  const previousWebUrl = process.env.WEB_URL;
  const previousFollowUpUrl = process.env.FOLLOW_UP_FRONTEND_URL;
  beforeEach(() => {
    process.env.WEB_URL = 'https://client.example.com';
    process.env.FOLLOW_UP_FRONTEND_URL = 'https://studio.example.com';
    records = new Map();
    appointment = {
      id: 'appointment',
      userId: 'professional',
      performerUserId: null,
      clientId: 'crm-client',
      clientUserId: null,
      prestation: 'TATTOO',
      status: 'COMPLETED',
      start: new Date('2025-01-01'),
      end: new Date('2025-01-01'),
      completedAt: new Date('2025-01-01'),
      followUp7SentAt: null,
      followUp30SentAt: null,
      user: {
        id: 'professional',
        salonName: 'Studio',
        followUpEmailDelayDays: 7,
        retouchEmailDelayDays: 30,
        followUpDeliveryChannel: 'EMAIL',
        retouchDeliveryChannel: 'EMAIL',
        followUpMessage: DEFAULT_FOLLOW_UP_MESSAGE,
        retouchMessage: DEFAULT_RETOUCH_MESSAGE,
      },
      performerUser: null,
      clientUser: null,
      tatoueur: { name: 'Artiste' },
      client: {
        firstName: 'Camille',
        lastName: 'Client',
        email: 'client@example.com',
        linkedUserId: 'client-user',
      },
    };
    prisma = {
      appointment: {
        findUnique: jest.fn(async () => appointment),
        update: jest.fn(async ({ data }) => Object.assign(appointment, data)),
      },
      appointmentReminderDelivery: {
        upsert: jest.fn(async ({ where, create }) => {
          if (!records.has(where.id))
            records.set(where.id, { status: 'PENDING', ...create });
          return records.get(where.id);
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const record = records.get(where.id);
          if (
            !record ||
            record.status !== where.status ||
            (data.claimedAt && record.claimedAt)
          )
            return { count: 0 };
          Object.assign(record, data);
          return { count: 1 };
        }),
        findUnique: jest.fn(async ({ where }) => records.get(where.id)),
        update: jest.fn(async ({ where, data }) =>
          Object.assign(records.get(where.id), data),
        ),
      },
      followUpRequest: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => ({ token: 'token' })),
        update: jest.fn(),
      },
      conversation: {
        findFirst: jest.fn(async () => ({
          id: 'conversation',
          salonId: 'professional',
          clientUserId: 'client-user',
        })),
        update: jest.fn(),
      },
      professionalBlock: { findUnique: jest.fn(async () => null) },
      user: {
        findUnique: jest.fn(async () => ({
          role: 'user_tatoueur',
          saasPlan: 'PRO',
          saasPlanDetails: { currentPlan: 'PRO', planStatus: 'ACTIVE' },
        })),
      },
      message: {
        create: jest.fn(async ({ data }) => ({ id: 'message', ...data })),
      },
      inboxThread: { upsert: jest.fn(async () => ({ id: 'thread' })) },
      messageNotification: { upsert: jest.fn() },
      $transaction: jest.fn(async (callback) => callback(prisma)),
    };
    mail = { sendAppointmentReminder: jest.fn() };
    service = new ReminderDeliveryService(
      prisma,
      mail,
      { notifyUser: jest.fn(), notifyConversation: jest.fn() } as any,
      { getTotalUnreadCount: jest.fn(async () => 1) } as any,
    );
  });
  afterAll(() => {
    if (previousFollowUpUrl === undefined) delete process.env.FOLLOW_UP_FRONTEND_URL;
    else process.env.FOLLOW_UP_FRONTEND_URL = previousFollowUpUrl;
    if (previousWebUrl === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = previousWebUrl;
  });

  it('keeps the persisted email-only default and adds the usable follow-up link', async () => {
    await service.deliver('appointment', 'FOLLOW_UP');
    expect(mail.sendAppointmentReminder).toHaveBeenCalledWith(
      'client@example.com',
      'FOLLOW_UP',
      expect.stringContaining('https://studio.example.com/suivi/token'),
      'Studio',
      expect.any(String),
    );
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(
      prisma.followUpRequest.upsert.mock.calls[0][0].create.expiresAt.getTime(),
    ).toBeGreaterThan(Date.now() + 13 * 86_400_000);
  });
  it('does not send before the current configured delay even if an old queue job runs early', async () => {
    appointment.completedAt = new Date(Date.now() - 2 * 86_400_000);
    appointment.user.followUpEmailDelayDays = 12;
    await expect(service.deliver('appointment', 'FOLLOW_UP')).resolves.toBe(
      false,
    );
    expect(mail.sendAppointmentReminder).not.toHaveBeenCalled();
    appointment.user.followUpEmailDelayDays = 1;
    await expect(service.deliver('appointment', 'FOLLOW_UP')).resolves.toBe(
      true,
    );
  });
  it('uses the independent performer settings instead of venue/salon settings', async () => {
    appointment.performerUser = {
      ...appointment.user,
      id: 'artist',
      followUpMessage: 'Bonjour {prenom}, message artiste',
      followUpDeliveryChannel: 'INKERA',
    };
    await service.deliver('appointment', 'FOLLOW_UP');
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          salonId: 'artist',
          clientUserId: 'client-user',
          projectContactPending: false,
        }),
      }),
    );
    expect(mail.sendAppointmentReminder).not.toHaveBeenCalled();
  });
  it('chat-only delivery requires an existing conversation and never falls back to email', async () => {
    appointment.user.followUpDeliveryChannel = 'INKERA';
    prisma.conversation.findFirst.mockResolvedValue(null);
    await service.deliver('appointment', 'FOLLOW_UP');
    expect(mail.sendAppointmentReminder).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(records.get('appointment:FOLLOW_UP:INKERA').status).toBe('SKIPPED');
  });
  it('sends the same rendered text on both channels and increments unread chat atomically', async () => {
    appointment.user.followUpDeliveryChannel = 'BOTH';
    appointment.user.followUpMessage =
      'Bonjour {prenom},\nUn message de {salon}';
    await service.deliver('appointment', 'FOLLOW_UP');
    expect(prisma.message.create.mock.calls[0][0].data.content).toBe(
      mail.sendAppointmentReminder.mock.calls[0][2],
    );
    expect(prisma.messageNotification.upsert).toHaveBeenCalled();
    await service.deliver('appointment', 'FOLLOW_UP');
    expect(mail.sendAppointmentReminder).toHaveBeenCalledTimes(1);
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
  });
  it('does not repeat successful email when chat fails and the job retries', async () => {
    appointment.user.followUpDeliveryChannel = 'BOTH';
    prisma.$transaction.mockRejectedValueOnce(
      new Error('temporary chat failure'),
    );
    await expect(service.deliver('appointment', 'FOLLOW_UP')).rejects.toThrow(
      'temporary chat failure',
    );
    await service.deliver('appointment', 'FOLLOW_UP');
    expect(mail.sendAppointmentReminder).toHaveBeenCalledTimes(1);
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
  });
  it('does not repeat successful chat when email fails and the job retries', async () => {
    appointment.user.followUpDeliveryChannel = 'BOTH';
    mail.sendAppointmentReminder.mockRejectedValueOnce(
      new Error('temporary email failure'),
    );
    await expect(service.deliver('appointment', 'FOLLOW_UP')).rejects.toThrow(
      'temporary email failure',
    );
    await service.deliver('appointment', 'FOLLOW_UP');
    expect(mail.sendAppointmentReminder).toHaveBeenCalledTimes(2);
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
  });
  it.each(['CANCELED', 'PENDING', 'NO_SHOW'])(
    'does not send for status %s',
    async (status) => {
      appointment.status = status;
      await service.deliver('appointment', 'FOLLOW_UP');
      expect(mail.sendAppointmentReminder).not.toHaveBeenCalled();
    },
  );
  it('retouch reminders apply to completed tattoos only', async () => {
    appointment.prestation = 'PIERCING';
    await service.deliver('appointment', 'RETOUCH');
    expect(mail.sendAppointmentReminder).not.toHaveBeenCalled();
  });
  it('honors blocks and restricted professional plans for chat', async () => {
    appointment.user.followUpDeliveryChannel = 'INKERA';
    prisma.professionalBlock.findUnique.mockResolvedValue({ id: 'blocked' });
    await service.deliver('appointment', 'FOLLOW_UP');
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
  it('escapes personalized email text instead of executing HTML', () => {
    const html = new EmailTemplateService().generateAppointmentReminderEmail(
      'Suivi',
      '<script>alert(1)</script>\nBonjour',
      'Studio',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<br>Bonjour');
  });
  it('substitutes variables once, preserves newlines and appends a missing follow-up URL', () => {
    expect(
      renderReminderMessage(
        'Bonjour {prenom}\n{salon}',
        {
          prenom: 'Camille',
          salon: '{prenom}',
          lien_suivi: 'https://test/suivi',
        },
        'FOLLOW_UP',
      ),
    ).toBe(
      'Bonjour Camille\n{prenom}\n\nEnvoyer mon suivi : https://test/suivi',
    );
  });
});
