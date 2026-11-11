import { Injectable, Logger } from '@nestjs/common';
import { Appointment, Client, User } from '@prisma/client';
import { MailService } from '../email/mailer.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  notifyClientConfirmed,
  notifyNewBooking,
} from '../notifications/appointment-notifications';
import { ConversationsService } from '../messaging/conversations/conversations.service';
import { CacheService } from '../redis/cache.service';

@Injectable()
export class BookingLinkNotificationsService {
  private readonly logger = new Logger(BookingLinkNotificationsService.name);
  constructor(
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly conversations: ConversationsService,
    private readonly cache: CacheService,
  ) {}

  /** All existing side effects run after commit; an email failure cannot consume a second link. */
  async afterConfirmation({
    appointment,
    client,
    owner,
    associatedThreadId,
  }: {
    appointment: Appointment;
    client: Client;
    owner: User;
    associatedThreadId: string | null;
  }) {
    const recipientName = `${client.firstName} ${client.lastName}`;
    const time = (d: Date) =>
      d.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Paris',
      });
    const details = {
      venue: [
        appointment.venueName,
        appointment.venueAddress,
        appointment.venuePostalCode,
        appointment.venueCity,
      ]
        .filter(Boolean)
        .join(', '),
      date: appointment.start.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Paris',
      }),
      time: `${time(appointment.start)} - ${time(appointment.end)}`,
      service: appointment.prestation,
      title: appointment.title,
      clientEmail: client.email,
      clientPhone: client.phone,
    };
    const tasks: (() => unknown)[] = [
      () =>
        notifyNewBooking(this.notifications, appointment, recipientName, false),
      () =>
        notifyClientConfirmed(this.notifications, appointment, owner.salonName),
      () =>
        this.mail.sendAutoConfirmedAppointment(
          client.email,
          { recipientName, appointmentDetails: details },
          owner.salonName || undefined,
        ),
      () =>
        this.mail.sendNewAppointmentNotification(
          owner.email,
          { recipientName, appointmentDetails: details },
          owner.salonName || undefined,
        ),
      ...[
        'appointment:*',
        'appointments:*',
        'client:appointments:*',
        'dashboard:*',
      ].map((pattern) => () => this.cache.delPattern(pattern)),
    ];
    if (appointment.clientUserId && !associatedThreadId)
      tasks.push(() =>
        this.conversations.createConversation(appointment.userId, {
          clientUserId: appointment.clientUserId!,
          appointmentId: appointment.id,
          subject: `RDV ${appointment.prestation} - ${details.date}`,
          firstMessage: `Bonjour ${client.firstName}, votre rendez-vous est confirmé.`,
        }),
      );
    const results = await Promise.allSettled(
      tasks.map((task) => Promise.resolve().then(task)),
    );
    if (results.some((result) => result.status === 'rejected'))
      this.logger.warn(
        'Booking link committed; some existing notification/cache services failed.',
      );
  }
}
