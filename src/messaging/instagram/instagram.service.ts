import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ChannelConnectionStatus, ChannelProvider, ExternalMessageDirection,
  ExternalMessageStatus, InboxChannel, Role,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { MessagesGateway } from '../websocket/messages.gateway';
import { InboxReplyDto } from '../inbox/dto/inbox.dto';
import { InstagramApiService } from './instagram-api.service';
import {
  createInstagramState, decryptInstagramToken, encryptInstagramToken,
  requiredInstagramEnv, verifyInstagramState,
} from './instagram-security';

type MetaAttachment = { type?: string; payload?: { url?: string; title?: string } };
type MetaMessageEvent = {
  sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: MetaAttachment[] };
};
type MetaWebhook = { object?: string; entry?: Array<{ id?: string; messaging?: MetaMessageEvent[] }> };
type InstagramReplyThread = {
  id: string; channel: InboxChannel; ownerUserId: string;
  externalConversationId: string | null; assignedUserId: string | null;
};

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: InstagramApiService,
    private readonly gateway: MessagesGateway,
  ) {}

  private async assertProfessional(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || (user.role !== Role.user && user.role !== Role.user_salon && user.role !== Role.user_tatoueur)) {
      throw new ForbiddenException('Seul un compte professionnel peut connecter Instagram');
    }
  }

  async authorization(userId: string) {
    await this.assertProfessional(userId);
    // L'URL dépend exclusivement de la configuration serveur, jamais d'un redirect fourni par le front.
    requiredInstagramEnv('INSTAGRAM_STUDIO_RETURN_URL');
    requiredInstagramEnv('INSTAGRAM_TOKEN_ENCRYPTION_KEY');
    return { authorizationUrl: this.api.buildAuthorizationUrl(createInstagramState(userId)) };
  }

  async connections(userId: string) {
    await this.assertProfessional(userId);
    return this.prisma.channelConnection.findMany({
      where: { ownerUserId: userId, provider: ChannelProvider.INSTAGRAM },
      select: {
        id: true, providerAccountId: true, displayName: true,
        status: true, lastError: true, tokenExpiresAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async callback(code: string, state: string): Promise<void> {
    const { userId } = verifyInstagramState(state);
    await this.assertProfessional(userId);
    const short = await this.api.exchangeCode(code.replace(/#_$/, ''));
    const long = await this.api.exchangeLongLivedToken(short.access_token);
    const profile = await this.api.profile(long.access_token);
    const accountId = String(profile.id || short.user_id || '');
    if (!accountId) throw new BadRequestException('Compte Instagram sans identifiant');

    const existing = await this.prisma.channelConnection.findUnique({
      where: { provider_providerAccountId: { provider: ChannelProvider.INSTAGRAM, providerAccountId: accountId } },
    });
    if (existing && existing.ownerUserId !== userId) {
      throw new ForbiddenException('Ce compte Instagram est déjà connecté à un autre professionnel Inkera');
    }
    const connection = await this.prisma.channelConnection.upsert({
      where: { provider_providerAccountId: { provider: ChannelProvider.INSTAGRAM, providerAccountId: accountId } },
      create: {
        ownerUserId: userId, provider: ChannelProvider.INSTAGRAM, providerAccountId: accountId,
        providerUserId: profile.user_id ? String(profile.user_id) : short.user_id ? String(short.user_id) : null,
        displayName: profile.username || `Instagram ${accountId}`,
        accessTokenEncrypted: encryptInstagramToken(long.access_token),
        tokenExpiresAt: new Date(Date.now() + (long.expires_in ?? 60 * 86400) * 1000),
        scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
        status: ChannelConnectionStatus.ACTIVE, lastError: null,
      },
      update: {
        providerUserId: profile.user_id ? String(profile.user_id) : short.user_id ? String(short.user_id) : null,
        displayName: profile.username || `Instagram ${accountId}`,
        accessTokenEncrypted: encryptInstagramToken(long.access_token),
        tokenExpiresAt: new Date(Date.now() + (long.expires_in ?? 60 * 86400) * 1000),
        scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
        status: ChannelConnectionStatus.ACTIVE, lastError: null,
      },
    });

    // L'abonnement par compte est complémentaire à l'abonnement Webhook global dans Meta.
    try {
      await this.api.subscribeMessages(long.access_token);
    } catch {
      await this.prisma.channelConnection.update({
        where: { id: connection.id },
        data: { status: ChannelConnectionStatus.ERROR, lastError: 'Abonnement aux messages Meta non confirmé. Vérifiez la publication et les Webhooks de l’application.' },
      });
      this.logger.warn(`Abonnement Instagram non confirmé pour la connexion ${connection.id}`);
    }
  }

  studioRedirect(outcome: 'connected' | 'cancelled' | 'error'): string {
    const url = new URL(requiredInstagramEnv('INSTAGRAM_STUDIO_RETURN_URL'));
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) {
      throw new ServiceUnavailableException('URL de retour Instagram non sécurisée');
    }
    url.searchParams.set('instagram', outcome);
    return url.toString();
  }

  async disconnect(userId: string, connectionId: string) {
    await this.assertProfessional(userId);
    const connection = await this.prisma.channelConnection.findFirst({
      where: { id: connectionId, ownerUserId: userId, provider: ChannelProvider.INSTAGRAM },
    });
    if (!connection) throw new NotFoundException('Compte Instagram introuvable');
    // La déconnexion ne doit jamais effacer les conversations et notes CRM conservées dans l'Inbox.
    await this.prisma.channelConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiresAt: null,
        status: ChannelConnectionStatus.DISCONNECTED, lastError: null,
      },
    });
    return { disconnected: true };
  }

  private async validToken(connection: {
    id: string; accessTokenEncrypted: string | null; tokenExpiresAt: Date | null;
  }): Promise<string> {
    if (!connection.accessTokenEncrypted) throw new BadRequestException('Compte Instagram déconnecté');
    const token = decryptInstagramToken(connection.accessTokenEncrypted);
    if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() < Date.now() + 7 * 86400_000) {
      try {
        const refreshed = await this.api.refreshToken(token);
        await this.prisma.channelConnection.update({ where: { id: connection.id }, data: {
          accessTokenEncrypted: encryptInstagramToken(refreshed.access_token),
          tokenExpiresAt: new Date(Date.now() + (refreshed.expires_in ?? 60 * 86400) * 1000),
          status: ChannelConnectionStatus.ACTIVE, lastError: null,
        } });
        return refreshed.access_token;
      } catch {
        await this.prisma.channelConnection.update({ where: { id: connection.id }, data: {
          status: ChannelConnectionStatus.REAUTH_REQUIRED,
          lastError: 'Le compte Instagram doit être reconnecté.',
        } });
        throw new BadRequestException('Reconnectez votre compte Instagram pour répondre');
      }
    }
    return token;
  }

  async sendReply(userId: string, thread: InstagramReplyThread, dto: InboxReplyDto) {
    if (thread.channel !== InboxChannel.INSTAGRAM || !thread.externalConversationId) {
      throw new BadRequestException('Conversation Instagram invalide');
    }
    // L'autorisation de l'opérateur / l'affectation a été vérifiée par InboxService.assertAccess.
    const external = await this.prisma.externalConversation.findUnique({
      where: { id: thread.externalConversationId },
      include: { connection: true, contact: true },
    });
    if (!external || !external.contact || external.connection.ownerUserId !== thread.ownerUserId ||
        external.connection.provider !== ChannelProvider.INSTAGRAM) {
      throw new ForbiddenException('Compte Instagram incompatible avec cette conversation');
    }
    if (external.connection.status !== ChannelConnectionStatus.ACTIVE && external.connection.status !== ChannelConnectionStatus.ERROR) {
      throw new BadRequestException('Reconnectez votre compte Instagram');
    }

    const lastInbound = await this.prisma.externalMessage.findFirst({
      where: { externalConversationId: external.id, direction: ExternalMessageDirection.INBOUND },
      orderBy: [{ providerCreatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const lastAt = lastInbound?.providerCreatedAt || lastInbound?.createdAt;
    if (!lastAt || Date.now() - lastAt.getTime() >= 24 * 60 * 60 * 1000) {
      throw new BadRequestException('La fenêtre Instagram de réponse de 24 h est dépassée. Le client doit renvoyer un message.');
    }

    const text = dto.content?.trim() || '';
    const attachments = dto.attachments || [];
    if (!text && !attachments.length) throw new BadRequestException('Message vide');
    if (text.length > 1000) throw new BadRequestException('Un message Instagram est limité à 1 000 caractères');
    if (attachments.length > 1) throw new BadRequestException('Envoyez une seule image Instagram à la fois');
    for (const attachment of attachments) {
      if (!attachment.fileType.startsWith('image/')) throw new BadRequestException('Instagram accepte une image pour cet envoi');
      try { if (new URL(attachment.fileUrl).protocol !== 'https:') throw new Error(); }
      catch { throw new BadRequestException('L’image doit être disponible sur une URL HTTPS'); }
    }

    const token = await this.validToken(external.connection);
    const outbound: Array<{ message: object; contentText: string | null; attachment?: typeof attachments[number] }> = [];
    if (text && !(attachments.length && text === '📷 Photo')) outbound.push({ message: { text }, contentText: text });
    for (const attachment of attachments) {
      outbound.push({ message: { attachment: { type: 'image', payload: { url: attachment.fileUrl, is_reusable: true } } }, contentText: null, attachment });
    }
    let saved: unknown;
    for (const item of outbound) {
      const mid = await this.api.sendMessage(external.connection.providerAccountId, external.contact.providerContactId, token, item.message);
      saved = await this.prisma.externalMessage.create({
        data: {
          externalConversationId: external.id, providerMessageId: mid,
          direction: ExternalMessageDirection.OUTBOUND, status: ExternalMessageStatus.SENT,
          contentText: item.contentText, senderExternalId: external.connection.providerAccountId,
          sentByUserId: userId, providerCreatedAt: new Date(),
          attachments: item.attachment ? { create: [{
            fileName: item.attachment.fileName, fileUrl: item.attachment.fileUrl,
            mimeType: item.attachment.fileType, fileSize: item.attachment.fileSize,
            storageKey: item.attachment.uploadThingKey,
          }] } : undefined,
        },
        include: { attachments: true },
      });
    }
    const now = new Date();
    await Promise.all([
      this.prisma.externalConversation.update({ where: { id: external.id }, data: { lastMessageAt: now } }),
      this.prisma.inboxThread.update({ where: { id: thread.id }, data: { lastMessageAt: now } }),
      this.prisma.inboxReadState.upsert({
        where: { inboxThreadId_userId: { inboxThreadId: thread.id, userId } },
        update: { forceUnread: false, lastReadAt: now },
        create: { inboxThreadId: thread.id, userId, forceUnread: false, lastReadAt: now },
      }),
    ]);
    this.notifyParticipants(thread.ownerUserId, thread.assignedUserId, thread.id);
    return saved;
  }

  private notifyParticipants(ownerUserId: string, assignedUserId: string | null, threadId: string): void {
    this.gateway.notifyUser(ownerUserId, 'inbox-message-updated', { threadId });
    if (assignedUserId && assignedUserId !== ownerUserId) {
      this.gateway.notifyUser(assignedUserId, 'inbox-message-updated', { threadId });
    }
  }

  /** Événements signés : idempotents par providerMessageId, sans rapprochement CRM automatique. */
  async handleWebhook(payload: MetaWebhook): Promise<void> {
    if (payload?.object !== 'instagram' || !Array.isArray(payload.entry)) return;
    for (const entry of payload.entry) {
      for (const event of entry.messaging || []) {
        if (!event.message?.mid || !event.sender?.id || !event.recipient?.id) continue;
        // Ne jamais chercher une connexion via le contact : deux professionnels
        // Inkera pourraient s'écrire entre eux et voir leur fil mal routé.
        const identities = [entry.id, event.message.is_echo ? event.sender.id : event.recipient.id]
          .filter((id): id is string => Boolean(id));
        const connection = await this.prisma.channelConnection.findFirst({
          where: { provider: ChannelProvider.INSTAGRAM, status: { in: [ChannelConnectionStatus.ACTIVE, ChannelConnectionStatus.ERROR] },
            OR: [{ providerAccountId: { in: identities } }, { providerUserId: { in: identities } }] },
        });
        if (!connection) continue;
        const accountIds = [connection.providerAccountId, connection.providerUserId, entry.id].filter(Boolean);
        const outbound = event.message.is_echo === true || accountIds.includes(event.sender.id);
        const externalContactId = outbound ? event.recipient.id : event.sender.id;
        if (accountIds.includes(externalContactId)) continue;
        const when = event.timestamp && Number.isFinite(event.timestamp) ? new Date(event.timestamp) : new Date();
        const at = Number.isNaN(when.getTime()) ? new Date() : when;
        let contactProfile: { username?: string; name?: string; profile_pic?: string } = {};
        try {
          if (connection.accessTokenEncrypted) {
            contactProfile = await this.api.contactProfile(decryptInstagramToken(connection.accessTokenEncrypted), externalContactId);
          }
        } catch { /* Un profil Instagram inaccessible ne doit pas empêcher la réception du DM. */ }

        try {
          const result = await this.prisma.$transaction(async (tx) => {
            const contact = await tx.externalContact.upsert({
              where: { connectionId_providerContactId: { connectionId: connection.id, providerContactId: externalContactId } },
              create: {
                connectionId: connection.id, providerContactId: externalContactId,
                displayName: contactProfile.name || contactProfile.username || `Instagram ${externalContactId}`,
                username: contactProfile.username || null, profileImageUrl: contactProfile.profile_pic || null,
              },
              update: {
                ...(contactProfile.name && { displayName: contactProfile.name }),
                ...(contactProfile.username && { username: contactProfile.username }),
                ...(contactProfile.profile_pic && { profileImageUrl: contactProfile.profile_pic }),
              },
            });
            const conversation = await tx.externalConversation.upsert({
              where: { connectionId_providerThreadId: { connectionId: connection.id, providerThreadId: externalContactId } },
              create: { connectionId: connection.id, providerThreadId: externalContactId, contactId: contact.id, lastMessageAt: at },
              update: { contactId: contact.id },
            });
            const thread = await tx.inboxThread.upsert({
              where: { externalConversationId: conversation.id },
              create: {
                ownerUserId: connection.ownerUserId, channel: InboxChannel.INSTAGRAM,
                externalConversationId: conversation.id, lastMessageAt: at,
              },
              update: {},
            });
            await tx.externalMessage.create({
              data: {
                externalConversationId: conversation.id, providerMessageId: event.message!.mid,
                direction: outbound ? ExternalMessageDirection.OUTBOUND : ExternalMessageDirection.INBOUND,
                status: outbound ? ExternalMessageStatus.SENT : ExternalMessageStatus.RECEIVED,
                contentText: event.message!.text || null, senderExternalId: event.sender!.id,
                providerCreatedAt: at,
                attachments: event.message!.attachments?.length ? { create: event.message!.attachments
                  .filter((a) => a.payload?.url?.startsWith('https://'))
                  .map((a) => ({ fileName: a.payload?.title || null, fileUrl: a.payload!.url!, mimeType: a.type || null })) } : undefined,
              },
            });
            await Promise.all([
              tx.externalConversation.updateMany({
                where: { id: conversation.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: at } }] },
                data: { lastMessageAt: at },
              }),
              tx.inboxThread.updateMany({
                where: { id: thread.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: at } }] },
                data: { lastMessageAt: at },
              }),
            ]);
            if (!outbound) {
              for (const readerId of [thread.ownerUserId, thread.assignedUserId].filter((id): id is string => Boolean(id))) {
                await tx.inboxReadState.upsert({
                  where: { inboxThreadId_userId: { inboxThreadId: thread.id, userId: readerId } },
                  create: { inboxThreadId: thread.id, userId: readerId, forceUnread: true },
                  update: { forceUnread: true },
                });
              }
            }
            return thread;
          });
          this.notifyParticipants(result.ownerUserId, result.assignedUserId, result.id);
        } catch (error) {
          if ((error as { code?: string }).code === 'P2002') continue; // Webhook Meta rejoué.
          this.logger.error('Échec du traitement d’un événement Instagram');
          throw error; // Meta réessaiera : la contrainte d'unicité évite les doublons.
        }
      }
    }
  }
}
