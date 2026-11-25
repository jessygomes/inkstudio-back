import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ConversationStatus, InboxChannel, MessageType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CacheService } from '../../redis/cache.service';
import { MessageNotificationService } from '../notifications/message-notification.service';
import { MessagesGateway } from '../websocket/messages.gateway';
import { assertProfessionalCanMessage, isProfessionalPlanRestricted } from '../plan-access';
import { clientAliasOf, pseudoOf } from '../client-identity';
import { sameClientEmail } from '../../clients/client-account-link';

const PRO_ROLES = ['user', 'user_salon', 'user_tatoueur'];
/** Après un refus, le professionnel peut redemander l'accès 7 jours plus tard. */
export const ACCESS_REQUEST_RETRY_DAYS = 7;

/**
 * Contact depuis un favori et demande d'accès aux informations du client.
 *
 * 1. Un client met en favori une réalisation ou un flash d'un professionnel : celui-ci est prévenu (pseudo seulement)
 *    et peut lui écrire (`startFromFavorite`). La conversation est créée en `clientAccess = HIDDEN` : il ne voit que
 *    le pseudo du client.
 * 2. Le professionnel envoie une demande d'accès dans la conversation (`requestAccess`, message ACCESS_REQUEST).
 * 3. Le client répond oui ou non (`respond`). Oui : le professionnel voit ses informations et une fiche client
 *    (reliée au compte) est créée ou retrouvée dans son espace, pour lui créer des rendez-vous.
 */
@Injectable()
export class ClientAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unread: MessageNotificationService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly gateway?: MessagesGateway,
    @Optional() private readonly cache?: CacheService,
  ) {}

  private async professional(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, salonName: true, firstName: true, lastName: true } });
    if (!user || !PRO_ROLES.includes(user.role)) throw new ForbiddenException('Compte professionnel requis.');
    return user;
  }

  private proName(user: { salonName: string | null; firstName: string | null; lastName: string | null }) {
    return user.salonName || [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Un professionnel';
  }

  /** Le client a-t-il mis en favori une réalisation ou un flash de ce professionnel ? */
  async hasFavoritedWork(professionalId: string, clientUserId: string): Promise<boolean> {
    const [portfolio, flash] = await Promise.all([
      this.prisma.favoritePortfolio.count({ where: { clientId: clientUserId, portfolio: { userId: professionalId } } }),
      this.prisma.favoriteFlash.count({ where: { clientId: clientUserId, flash: { userId: professionalId } } }),
    ]);
    return portfolio + flash > 0;
  }

  /** Ouvre (ou retrouve) la conversation avec un client qui a mis une réalisation ou un flash en favori. */
  async startFromFavorite(professionalId: string, clientUserId: string) {
    await this.professional(professionalId);
    const client = await this.prisma.user.findUnique({
      where: { id: clientUserId },
      select: { id: true, role: true, nickname: true, clientProfile: { select: { pseudo: true } } },
    });
    if (!client || client.role !== 'client') throw new NotFoundException('Client introuvable.');

    const existing = await this.prisma.conversation.findFirst({
      where: { salonId: professionalId, clientUserId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true },
    });
    if (existing) {
      // Conversation déjà ouverte (par le client ou après un précédent favori) : elle garde son niveau d'accès.
      if (existing.status === ConversationStatus.ARCHIVED) {
        await this.prisma.conversation.update({ where: { id: existing.id }, data: { status: ConversationStatus.ACTIVE } });
      }
      return { conversationId: existing.id, created: false };
    }

    if (!(await this.hasFavoritedWork(professionalId, clientUserId))) {
      throw new ForbiddenException("Ce client n'a pas mis vos réalisations en favori : vous ne pouvez pas lui écrire.");
    }
    const blocked = await this.prisma.professionalBlock.findUnique({
      where: { clientUserId_professionalId: { clientUserId, professionalId } },
    });
    if (blocked) throw new ForbiddenException('Ce client ne souhaite pas être contacté.');
    await assertProfessionalCanMessage(this.prisma, professionalId);

    const alias = pseudoOf(client) || 'Client Inkera';
    const conversation = await this.prisma.$transaction(async (tx) => {
      // Même verrou que les autres créations de conversation (une seule conversation par professionnel et client).
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${professionalId} FOR UPDATE`;
      const again = await tx.conversation.findFirst({ where: { salonId: professionalId, clientUserId }, select: { id: true } });
      if (again) return { id: again.id, created: false };
      const created = await tx.conversation.create({
        data: {
          salonId: professionalId,
          clientUserId,
          status: ConversationStatus.ACTIVE,
          clientAccess: 'HIDDEN',
          clientAlias: alias,
        },
        select: { id: true, lastMessageAt: true },
      });
      await tx.inboxThread.create({
        data: { ownerUserId: professionalId, channel: InboxChannel.INKERA, conversationId: created.id, lastMessageAt: created.lastMessageAt },
      });
      return { id: created.id, created: true };
    });
    return { conversationId: conversation.id, created: conversation.created };
  }

  private async conversationFor(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true, salonId: true, clientUserId: true, clientAccess: true, clientAlias: true,
        clientAccessRespondedAt: true, clientAccessRequestedAt: true,
      },
    });
    if (!conversation) throw new NotFoundException('Conversation introuvable.');
    return conversation;
  }

  private async postMessage(conversationId: string, senderId: string, recipientId: string, type: MessageType, content: string) {
    const message = await this.prisma.message.create({
      data: { conversationId, senderId, type, content },
      include: { sender: { select: { id: true, firstName: true, lastName: true, salonName: true, image: true, role: true } }, attachments: true },
    });
    const now = new Date();
    await Promise.all([
      this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } }),
      this.prisma.inboxThread.updateMany({ where: { conversationId }, data: { lastMessageAt: now, archivedAt: null } }),
    ]);
    await this.unread.incrementUnreadCount(conversationId, recipientId);
    return message;
  }

  /** Émet le message en temps réel ; l'expéditeur client n'apparaît que sous son pseudo si l'accès n'est pas accordé. */
  private emit(conversationId: string, recipientId: string, message: Awaited<ReturnType<ClientAccessService['postMessage']>>, alias?: string) {
    if (!this.gateway) return;
    const payload = alias
      ? { ...message, sender: { ...message.sender, firstName: alias, lastName: null, image: null } }
      : message;
    this.gateway.notifyConversation(conversationId, 'new-message', payload);
    this.gateway.notifyConversation(conversationId, 'client-access-updated', { conversationId });
    void this.unread.getTotalUnreadCount(recipientId).then((totalUnread) =>
      this.gateway?.notifyUser(recipientId, 'unread-count-updated', { totalUnread })).catch(() => undefined);
  }

  /** Le professionnel demande au client l'accès à ses informations. */
  async requestAccess(professionalId: string, conversationId: string) {
    const pro = await this.professional(professionalId);
    const conversation = await this.conversationFor(conversationId);
    if (conversation.salonId !== professionalId) throw new ForbiddenException('Conversation non attribuée à votre compte.');
    if (!conversation.clientAccess || conversation.clientAccess === 'GRANTED') {
      throw new ConflictException('Vous avez déjà accès aux informations de ce client.');
    }
    if (conversation.clientAccess === 'REQUESTED') throw new ConflictException('Une demande est déjà en attente de réponse.');
    if (conversation.clientAccess === 'DECLINED' && conversation.clientAccessRespondedAt) {
      const retryAt = conversation.clientAccessRespondedAt.getTime() + ACCESS_REQUEST_RETRY_DAYS * 86_400_000;
      if (Date.now() < retryAt) {
        throw new ConflictException(
          `Le client a refusé votre demande : vous pourrez la renouveler à partir du ${new Date(retryAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}.`,
        );
      }
    }
    if (await isProfessionalPlanRestricted(this.prisma, professionalId)) {
      throw new ForbiddenException('La messagerie est réservée aux professionnels abonnés.');
    }
    const blocked = await this.prisma.professionalBlock.findUnique({
      where: { clientUserId_professionalId: { clientUserId: conversation.clientUserId, professionalId } },
    });
    if (blocked) throw new ForbiddenException('Ce contact est bloqué.');

    const claimed = await this.prisma.conversation.updateMany({
      where: { id: conversationId, clientAccess: { in: ['HIDDEN', 'DECLINED'] } },
      data: { clientAccess: 'REQUESTED', clientAccessRequestedAt: new Date(), clientAccessRespondedAt: null },
    });
    if (!claimed.count) throw new ConflictException('La demande a déjà été envoyée.');

    const name = this.proName(pro);
    const message = await this.postMessage(
      conversationId,
      professionalId,
      conversation.clientUserId,
      MessageType.ACCESS_REQUEST,
      `${name} souhaite accéder à vos informations (prénom, nom, e-mail, téléphone, date de naissance) pour créer votre fiche client et pouvoir vous proposer des rendez-vous. Acceptez-vous ?`,
    );
    this.emit(conversationId, conversation.clientUserId, message);
    void this.notifications?.notify({
      userId: conversation.clientUserId,
      type: 'client.access_request',
      title: `${name} demande l'accès à vos informations`,
      body: 'Répondez dans la conversation : vos informations ne sont partagées que si vous acceptez.',
      data: { conversationId },
    });
    return { clientAccess: 'REQUESTED' as const, messageId: message.id };
  }

  /** Réponse du client : oui = accès accordé et fiche client reliée à son compte ; non = le pseudo reste seul visible. */
  async respond(clientUserId: string, conversationId: string, accept: boolean) {
    const conversation = await this.conversationFor(conversationId);
    if (conversation.clientUserId !== clientUserId) throw new ForbiddenException('Seul le client concerné peut répondre.');
    if (conversation.clientAccess !== 'REQUESTED') throw new ConflictException("Aucune demande d'accès en attente.");

    const claimed = await this.prisma.conversation.updateMany({
      where: { id: conversationId, clientAccess: 'REQUESTED' },
      data: { clientAccess: accept ? 'GRANTED' : 'DECLINED', clientAccessRespondedAt: new Date() },
    });
    if (!claimed.count) throw new ConflictException('La demande a déjà reçu une réponse.');

    const alias = clientAliasOf(conversation);
    let clientId: string | null = null;
    if (accept) clientId = await this.linkClientRecord(conversation.salonId, clientUserId, conversationId);

    const message = await this.postMessage(
      conversationId,
      clientUserId,
      conversation.salonId,
      MessageType.SYSTEM,
      accept
        ? 'Le client a accepté de partager ses informations.'
        : "Le client a refusé de partager ses informations. Vous pouvez continuer à échanger avec lui.",
    );
    // Message de refus : le client reste sous son pseudo.
    this.emit(conversationId, conversation.salonId, message, accept ? undefined : alias);

    const account = accept
      ? await this.prisma.user.findUnique({ where: { id: clientUserId }, select: { firstName: true, lastName: true } })
      : null;
    const name = account ? [account.firstName, account.lastName].filter(Boolean).join(' ') || alias : alias;
    void this.notifications?.notify({
      userId: conversation.salonId,
      type: 'contact.access_reply',
      title: accept ? `${name} a accepté votre demande` : `${alias} a refusé votre demande`,
      body: accept
        ? 'Ses informations sont visibles et sa fiche client est prête : vous pouvez lui créer un rendez-vous.'
        : 'Ses informations restent privées. Vous pouvez continuer à échanger avec lui dans la conversation.',
      data: { conversationId, ...(clientId ? { clientId } : {}) },
    });
    return { clientAccess: accept ? ('GRANTED' as const) : ('DECLINED' as const), clientId };
  }

  /**
   * Accès accordé : retrouve la fiche du salon au même e-mail (sinon la crée) et la relie au compte du client et au fil
   * de messagerie. Ne lève pas d'erreur : l'accès est accordé même si la fiche ne peut pas être créée (plan FREE…).
   */
  private async linkClientRecord(salonId: string, clientUserId: string, conversationId: string): Promise<string | null> {
    try {
      const account = await this.prisma.user.findUnique({
        where: { id: clientUserId },
        select: { firstName: true, lastName: true, email: true, phone: true, clientProfile: { select: { birthDate: true, pseudo: true } } },
      });
      if (!account) return null;
      let record = await this.prisma.client.findFirst({
        where: { userId: salonId, OR: [{ linkedUserId: clientUserId }, { email: { equals: account.email, mode: 'insensitive' } }] },
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true, linkedUserId: true },
      });
      if (record && record.linkedUserId && record.linkedUserId !== clientUserId) record = null;
      if (!record) {
        if (await isProfessionalPlanRestricted(this.prisma, salonId)) return null;
        record = await this.prisma.client.create({
          data: {
            userId: salonId,
            firstName: account.firstName?.trim() || account.clientProfile?.pseudo || 'Client',
            lastName: account.lastName?.trim() || '',
            email: account.email.trim(),
            phone: account.phone?.trim() || '',
            birthDate: account.clientProfile?.birthDate ?? null,
            linkedUserId: clientUserId,
            tags: [],
          },
          select: { id: true, email: true, linkedUserId: true },
        });
      } else if (!record.linkedUserId && sameClientEmail(record.email, account.email)) {
        // Même règle que partout : une fiche ne rejoint un compte que si l'e-mail est le même.
        await this.prisma.client.updateMany({ where: { id: record.id, linkedUserId: null }, data: { linkedUserId: clientUserId } });
      }
      await this.prisma.inboxThread.updateMany({ where: { conversationId, linkedClientId: null }, data: { linkedClientId: record.id } });
      if (this.cache) {
        await this.cache.delPattern(`clients:salon:${salonId}:*`);
        await this.cache.delPattern(`clients:search:${salonId}:*`);
      }
      return record.id;
    } catch {
      return null;
    }
  }

  assertBody(accept: unknown): boolean {
    if (typeof accept !== 'boolean') throw new BadRequestException('Réponse attendue : oui ou non.');
    return accept;
  }
}
