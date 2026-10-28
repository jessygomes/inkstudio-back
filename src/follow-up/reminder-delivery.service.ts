import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { addDays } from 'date-fns';
import { Prisma, PrestationType } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/email/mailer.service';
import { MessagesGateway } from 'src/messaging/websocket/messages.gateway';
import { MessageNotificationService } from 'src/messaging/notifications/message-notification.service';
import { isProfessionalPlanRestricted } from 'src/messaging/plan-access';
import {
  DEFAULT_FOLLOW_UP_MESSAGE,
  DEFAULT_RETOUCH_MESSAGE,
  ReminderKind,
  renderReminderMessage,
} from './reminder-settings';

@Injectable()
export class ReminderDeliveryService {
  private readonly logger = new Logger(ReminderDeliveryService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly gateway: MessagesGateway,
    private readonly notifications: MessageNotificationService,
  ) {}

  async deliver(appointmentId: string, kind: ReminderKind): Promise<boolean> {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        client: true,
        clientUser: true,
        user: true,
        performerUser: true,
        tatoueur: true,
      },
    });
    if (
      !appt ||
      appt.status !== 'COMPLETED' ||
      !(['TATTOO', 'PIERCING', 'RETOUCHE'] as PrestationType[]).includes(
        appt.prestation,
      ) ||
      (kind === 'RETOUCH' && appt.prestation !== 'TATTOO')
    )
      return false;
    const sentField =
      kind === 'FOLLOW_UP' ? 'followUp7SentAt' : 'followUp30SentAt';
    if (appt[sentField]) return false;
    const owner = appt.performerUser || appt.user;
    const days =
      kind === 'FOLLOW_UP'
        ? owner.followUpEmailDelayDays
        : owner.retouchEmailDelayDays;
    const dueAt = new Date(
      (appt.completedAt || appt.end).getTime() + days * 86_400_000,
    );
    if (dueAt.getTime() > Date.now()) return false;
    const channel =
      kind === 'FOLLOW_UP'
        ? owner.followUpDeliveryChannel
        : owner.retouchDeliveryChannel;
    const channels = channel === 'BOTH' ? ['EMAIL', 'INKERA'] : [channel];
    const recipient = appt.clientUser || appt.client;
    if (!recipient) return false;
    let followUrl = '';
    if (kind === 'FOLLOW_UP') {
      const existing = await this.prisma.followUpRequest.findUnique({
        where: { appointmentId },
        include: { submission: true },
      });
      if (existing?.submission) {
        await this.prisma.appointment.update({
          where: { id: appointmentId },
          data: { followUp7SentAt: existing.sentAt || new Date() },
        });
        return false;
      }
      const request = await this.prisma.followUpRequest.upsert({
        where: { appointmentId },
        update: { expiresAt: addDays(new Date(), 14) },
        create: {
          appointmentId,
          userId: appt.userId,
          token: randomUUID(),
          expiresAt: addDays(new Date(), 14),
        },
      });
      const base = (
        process.env.FOLLOW_UP_FRONTEND_URL ||
        process.env.FRONTEND_URL ||
        process.env.WEB_URL ||
        ''
      ).replace(/\/+$/, '');
      if (!base) throw new Error('FRONTEND_URL est requis pour les liens de suivi.');
      followUrl = `${base}/suivi/${encodeURIComponent(request.token)}`;
      // Already sent by the legacy worker before this release: do not send that email again.
      if (existing?.sentAt && channels.includes('EMAIL')) {
        await this.prisma.appointmentReminderDelivery.upsert({
          where: { id: `${appointmentId}:${kind}:EMAIL` },
          create: {
            id: `${appointmentId}:${kind}:EMAIL`,
            appointmentId,
            kind,
            channel: 'EMAIL',
            status: 'SENT',
            sentAt: existing.sentAt,
          },
          update: {},
        });
      }
    }
    const template =
      kind === 'FOLLOW_UP'
        ? owner.followUpMessage || DEFAULT_FOLLOW_UP_MESSAGE
        : owner.retouchMessage || DEFAULT_RETOUCH_MESSAGE;
    const content = renderReminderMessage(
      template,
      {
        prenom: recipient.firstName || 'bonjour',
        salon: owner.salonName || owner.firstName || 'Votre studio',
        artiste:
          appt.tatoueur?.name ||
          appt.performerUser?.firstName ||
          'votre artiste',
        date_rdv: appt.start.toLocaleDateString('fr-FR', {
          timeZone: 'Europe/Paris',
        }),
        lien_suivi: followUrl,
      },
      kind,
    );
    let complete = true;
    const failures: unknown[] = [];
    // Each channel commits independently. A retry never repeats a successful channel.
    for (const destination of channels) {
      const id = `${appointmentId}:${kind}:${destination}`;
      await this.prisma.appointmentReminderDelivery.upsert({
        where: { id },
        create: { id, appointmentId, kind, channel: destination },
        update: {},
      });
      const claimed = await this.prisma.appointmentReminderDelivery.updateMany({
        where: {
          id,
          status: 'PENDING',
          OR: [
            { claimedAt: null },
            { claimedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
          ],
        },
        data: { claimedAt: new Date() },
      });
      if (!claimed.count) {
        const record = await this.prisma.appointmentReminderDelivery.findUnique(
          { where: { id } },
        );
        if (record?.status === 'PENDING') complete = false;
        continue;
      }
      try {
        if (destination === 'EMAIL') {
          if (!recipient.email) {
            await this.skip(id);
            continue;
          }
          await this.mail.sendAppointmentReminder(
            recipient.email,
            kind,
            content,
            owner.salonName || owner.firstName || 'Votre studio',
            followUrl,
          );
          await this.prisma.appointmentReminderDelivery.update({
            where: { id },
            data: { status: 'SENT', sentAt: new Date(), claimedAt: null },
          });
          if (kind === 'FOLLOW_UP')
            await this.prisma.followUpRequest.update({
              where: { appointmentId },
              data: { sentAt: new Date() },
            });
        } else {
          const clientUserId = appt.clientUserId || appt.client?.linkedUserId;
          const matches: Prisma.ConversationWhereInput[] = [
            { appointmentId },
            { inboxThread: { appointments: { some: { appointmentId } } } },
          ];
          if (clientUserId) matches.push({ clientUserId });
          if (appt.clientId)
            matches.push({ inboxThread: { linkedClientId: appt.clientId } });
          // Restrict every candidate to this professional; never create a conversation.
          const conversation = await this.prisma.conversation.findFirst({
            where: {
              salonId: owner.id,
              status: 'ACTIVE',
              projectContactPending: false,
              OR: matches,
              ...(clientUserId ? { clientUserId } : {}),
            },
            orderBy: { lastMessageAt: 'desc' },
          });
          if (
            !conversation ||
            (await isProfessionalPlanRestricted(this.prisma, owner.id)) ||
            (await this.prisma.professionalBlock.findUnique({
              where: {
                clientUserId_professionalId: {
                  clientUserId: conversation.clientUserId,
                  professionalId: owner.id,
                },
              },
            }))
          ) {
            await this.skip(id);
            continue;
          }
          const now = new Date();
          const result = await this.prisma.$transaction(async (tx) => {
            const message = await tx.message.create({
              data: {
                conversationId: conversation.id,
                senderId: owner.id,
                content,
                type: 'TEXT',
              },
              include: { sender: true, attachments: true },
            });
            await tx.conversation.update({
              where: { id: conversation.id },
              data: { lastMessageAt: now },
            });
            const thread = await tx.inboxThread.upsert({
              where: { conversationId: conversation.id },
              create: {
                ownerUserId: owner.id,
                channel: 'INKERA',
                conversationId: conversation.id,
                lastMessageAt: now,
              },
              update: { lastMessageAt: now },
            });
            await tx.messageNotification.upsert({
              where: {
                conversationId_userId: {
                  conversationId: conversation.id,
                  userId: conversation.clientUserId,
                },
              },
              create: {
                conversationId: conversation.id,
                userId: conversation.clientUserId,
                unreadCount: 1,
                lastUnreadAt: now,
              },
              update: { unreadCount: { increment: 1 }, lastUnreadAt: now },
            });
            await tx.appointmentReminderDelivery.update({
              where: { id },
              data: { status: 'SENT', sentAt: now, claimedAt: null },
            });
            return { message, thread };
          });
          // Chat reminders intentionally do not enter the email-notification queue.
          try {
            this.gateway.notifyConversation(
              conversation.id,
              'new-message',
              result.message,
            );
            this.gateway.notifyUser(owner.id, 'inbox-message-updated', {
              threadId: result.thread.id,
            });
            this.gateway.notifyUser(
              conversation.clientUserId,
              'unread-count-updated',
              {
                totalUnread: await this.notifications.getTotalUnreadCount(
                  conversation.clientUserId,
                ),
              },
            );
          } catch (error) {
            this.logger.warn(
              `Notification temps réel différée : ${String(error)}`,
            );
          }
        }
      } catch (error) {
        await this.prisma.appointmentReminderDelivery.updateMany({
          where: { id, status: 'PENDING' },
          data: { claimedAt: null },
        });
        failures.push(error);
        complete = false;
      }
    }
    if (complete)
      await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { [sentField]: new Date() },
      });
    if (failures.length) throw failures[0];
    return complete;
  }

  private async skip(id: string) {
    await this.prisma.appointmentReminderDelivery.update({
      where: { id },
      data: { status: 'SKIPPED', claimedAt: null },
    });
  }
}
