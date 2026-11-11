import { BookingLinkNotificationsService } from './booking-link-notifications.service';

describe('Booking link confirmation side effects', () => {
  const appointment = {
    id: 'rdv',
    userId: 'salon',
    clientUserId: 'client',
    prestation: 'RETOUCHE',
    start: new Date('2027-07-01T08:00:00Z'),
    end: new Date('2027-07-01T09:00:00Z'),
    title: 'Retouche',
  };
  const payload = {
    appointment,
    client: {
      email: 'client@example.test',
      firstName: 'A',
      lastName: 'B',
      phone: '',
    },
    owner: { email: 'salon@example.test', salonName: 'Salon' },
    associatedThreadId: 'thread',
  } as any;
  it('uses existing confirmation notifications, email methods and cache invalidation', async () => {
    const mail = {
      sendAutoConfirmedAppointment: jest.fn(),
      sendNewAppointmentNotification: jest.fn(),
    };
    const notifications = { notifyMany: jest.fn(), notify: jest.fn() };
    const conversations = { createConversation: jest.fn() };
    const cache = { delPattern: jest.fn() };
    const service = new BookingLinkNotificationsService(
      mail as any,
      notifications as any,
      conversations as any,
      cache as any,
    );
    await service.afterConfirmation(payload);
    expect(mail.sendAutoConfirmedAppointment).toHaveBeenCalledWith(
      'client@example.test',
      expect.objectContaining({
        appointmentDetails: expect.objectContaining({ time: '10:00 - 11:00' }),
      }),
      'Salon',
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'client',
        type: 'client.appointment_confirmed',
      }),
    );
    expect(notifications.notifyMany).toHaveBeenCalledTimes(1);
    expect(conversations.createConversation).not.toHaveBeenCalled();
    expect(cache.delPattern).toHaveBeenCalledWith('client:appointments:*');
  });
  it('isolates failures after commit and creates an Inkera conversation when needed', async () => {
    const mail = {
      sendAutoConfirmedAppointment: jest
        .fn()
        .mockRejectedValue(new Error('mail offline')),
      sendNewAppointmentNotification: jest.fn(),
    };
    const notifications = { notifyMany: jest.fn(), notify: jest.fn() };
    const conversations = { createConversation: jest.fn() };
    const service = new BookingLinkNotificationsService(
      mail as any,
      notifications as any,
      conversations as any,
      { delPattern: jest.fn() } as any,
    );
    await expect(
      service.afterConfirmation({ ...payload, associatedThreadId: null }),
    ).resolves.toBeUndefined();
    expect(conversations.createConversation).toHaveBeenCalledWith(
      'salon',
      expect.objectContaining({ appointmentId: 'rdv', clientUserId: 'client' }),
    );
    expect(mail.sendNewAppointmentNotification).toHaveBeenCalledTimes(1);
  });
});
