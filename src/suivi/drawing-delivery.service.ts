import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/email/mailer.service';
import { renderDrawingVersionEmail } from 'src/email/drawing-version-email';
import { assertProfessionalCanMessage } from 'src/messaging/plan-access';
import { assertContactCanMessage } from 'src/messaging/contact-access';
import { MessagesGateway } from 'src/messaging/websocket/messages.gateway';
import { MessageNotificationService } from 'src/messaging/notifications/message-notification.service';

@Injectable()
export class DrawingDeliveryService {
  private readonly logger = new Logger(DrawingDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly gateway: MessagesGateway,
    private readonly notifications: MessageNotificationService,
  ) {}

  async send(cardId: string, imageId: string, userId: string) {
    const card = await this.prisma.drawingCard.findUnique({
      where: { id: cardId },
      include: {
        client: true,
        clientUser: true,
        salon: {
          select: {
            salonName: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
    if (!card) throw new NotFoundException('Suivi de dessin introuvable.');
    if (card.salonId !== userId && card.performerUserId !== userId)
      throw new ForbiddenException('Accès refusé à ce suivi de dessin.');
    let image = await this.prisma.drawingCardImage.findFirst({
      where: { id: imageId, cardId },
    });
    if (!image)
      throw new NotFoundException('Version introuvable dans ce suivi.');
    if (!/^https:\/\//i.test(image.url))
      throw new BadRequestException('URL du dessin invalide.');

    // Only reuse this client's existing conversation, preferring the source RDV.
    const clientUserId = card.clientUserId ?? card.client?.linkedUserId;
    const conversation = clientUserId
      ? ((await this.prisma.conversation.findFirst({
          where: {
            salonId: card.salonId,
            clientUserId,
            status: 'ACTIVE',
            appointmentId: card.sourceAppointmentId,
          },
        })) ??
        (await this.prisma.conversation.findFirst({
          where: { salonId: card.salonId, clientUserId, status: 'ACTIVE' },
          orderBy: { lastMessageAt: 'desc' },
        })))
      : null;
    const recipient = card.clientUser?.email || card.client?.email;
    if (!recipient && !conversation)
      throw new BadRequestException(
        'Ce client ne possède ni adresse email ni conversation Inkera.',
      );
    const claimedAt = new Date();
    image = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "DrawingCard" WHERE id = ${cardId} FOR UPDATE`;
      const currentCard = await tx.drawingCard.findUnique({
        where: { id: cardId },
        select: { updatedAt: true },
      });
      if (
        !currentCard ||
        currentCard.updatedAt.getTime() !== card.updatedAt.getTime()
      ) {
        throw new ConflictException(
          'Les liaisons de cette card ont changé. Actualisez-la avant de renvoyer le dessin.',
        );
      }
      const claim = await tx.drawingCardImage.updateMany({
        where: {
          id: imageId,
          cardId,
          OR: [
            { deliveryClaimedAt: null },
            {
              deliveryClaimedAt: {
                lt: new Date(claimedAt.getTime() - 10 * 60_000),
              },
            },
          ],
        },
        data: { deliveryClaimedAt: claimedAt },
      });
      if (!claim.count)
        throw new ConflictException(
          'Un envoi de cette version est déjà en cours.',
        );
      const currentImage = await tx.drawingCardImage.findFirst({
        where: { id: imageId, cardId },
      });
      if (!currentImage)
        throw new NotFoundException('Version introuvable dans ce suivi.');
      return currentImage;
    });

    const salonName =
      card.salon.salonName ||
      [card.salon.firstName, card.salon.lastName].filter(Boolean).join(' ') ||
      'Votre salon';
    const client = card.clientUser ?? card.client;
    const clientName =
      [client?.firstName, client?.lastName].filter(Boolean).join(' ') ||
      'cher client';
    const publicBase = (
      process.env.FRONTEND_PUBLIC_URL ||
      process.env.FRONTENDPUBLIC_URL ||
      'https://theinkera.com'
    ).replace(/\/+$/, '');
    const conversationUrl = conversation
      ? `${publicBase}/mon-profil?tab=messagerie&conversationId=${encodeURIComponent(conversation.id)}`
      : undefined;
    let emailSent = Boolean(image.clientEmailSentAt);
    let messageSent = Boolean(image.clientMessageSentAt);
    let emailError: string | null = null;
    let messageError: string | null = null;
    try {
      if (recipient && !emailSent) {
        try {
          const rendered = renderDrawingVersionEmail({
            clientName,
            salonName,
            title: card.title,
            version: image.version,
            imageUrl: image.url,
            caption: image.caption,
            conversationUrl,
          });
          await this.mail.sendMail(
            recipient,
            rendered.subject,
            rendered.html,
            salonName,
            card.salon.email,
          );
          await this.prisma.drawingCardImage.update({
            where: { id: imageId },
            data: { clientEmailSentAt: new Date() },
          });
          emailSent = true;
        } catch {
          emailError = 'L’email n’a pas pu être envoyé. Réessayez.';
        }
      } else if (!recipient) emailError = 'Ce client n’a pas d’adresse email.';

      if (conversation && !messageSent) {
        try {
          await assertProfessionalCanMessage(this.prisma, card.salonId);
          await assertContactCanMessage(this.prisma, conversation);
          const now = new Date();
          const message = await this.prisma.$transaction(async (tx) => {
            const message = await tx.message.create({
              data: {
                senderId: card.salonId,
                conversationId: conversation.id,
                content: `${salonName} vous partage la version ${image.version} de « ${card.title} ».\n${image.caption ? image.caption + '\n' : ''}Le salon attend votre retour : indiquez si le dessin vous convient ou les modifications souhaitées, ici dans la messagerie Inkera ou par email à ${card.salon.email}.`,
                type: MessageType.IMAGE,
                attachments: {
                  create: [
                    {
                      fileName: `dessin-version-${image.version}`,
                      fileUrl: image.url,
                      fileType:
                        'image/' +
                        (new URL(image.url).pathname
                          .match(/\.(png|gif|webp|jpe?g)$/i)?.[1]
                          ?.replace('jpg', 'jpeg') || 'webp'),
                      fileSize: 0,
                    },
                  ],
                },
              },
              include: {
                sender: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    salonName: true,
                    image: true,
                    role: true,
                  },
                },
                attachments: true,
              },
            });
            await tx.conversation.update({
              where: { id: conversation.id },
              data: { lastMessageAt: now },
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
            await tx.drawingCardImage.update({
              where: { id: imageId },
              data: { clientMessageSentAt: now },
            });
            return message;
          });
          messageSent = true;
          // Delivery is persisted before best-effort real-time notifications.
          try {
            this.gateway.notifyConversation(
              conversation.id,
              'new-message',
              message,
            );
            this.gateway.notifyUser(
              conversation.clientUserId,
              'unread-count-updated',
              {
                totalUnread: await this.notifications.getTotalUnreadCount(
                  conversation.clientUserId,
                ),
              },
            );
          } catch {
            this.logger.warn('Notification temps réel du dessin indisponible.');
          }
        } catch {
          messageError =
            'Le message Inkera n’a pas pu être envoyé (vérifiez les droits de messagerie). Réessayez.';
        }
      }
      return {
        emailSent,
        messageSent,
        conversationExists: Boolean(conversation),
        emailError,
        messageError,
      };
    } finally {
      await this.prisma.drawingCardImage.updateMany({
        where: { id: imageId, deliveryClaimedAt: claimedAt },
        data: { deliveryClaimedAt: null },
      });
    }
  }
}
