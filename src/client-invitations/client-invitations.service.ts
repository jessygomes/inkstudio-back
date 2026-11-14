import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { ClientInvitation, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../email/mailer.service';
import { renderClientInvitationEmail } from '../email/client-invitation-email';
import { sameClientEmail } from '../clients/client-account-link';
import { peopleOrigin } from '../config/people-url';

const VALID_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Au plus un e-mail d'invitation par fiche et par 24 h, et 10 liens créés par fiche et par 24 h. */
const EMAIL_COOLDOWN_MS = DAY_MS;
const MAX_LINKS_PER_DAY = 10;

export type InvitationStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'ACCEPTED';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const fail = (status: HttpStatus, code: string, message: string) => new HttpException({ code, message }, status);


function salonDisplayName(user: { salonName?: string | null; firstName?: string | null; lastName?: string | null } | null) {
  return user?.salonName?.trim() || [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Votre salon';
}

export function invitationStatus(invitation: Pick<ClientInvitation, 'acceptedAt' | 'revokedAt' | 'expiresAt'>, now = new Date()): InvitationStatus {
  if (invitation.acceptedAt) return 'ACCEPTED';
  if (invitation.revokedAt) return 'REVOKED';
  if (invitation.expiresAt <= now) return 'EXPIRED';
  return 'ACTIVE';
}

@Injectable()
export class ClientInvitationsService {
  private readonly logger = new Logger(ClientInvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private async ownedClient(proUserId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, userId: proUserId },
      select: { id: true, userId: true, email: true, firstName: true, lastName: true, linkedUserId: true },
    });
    if (!client) throw new NotFoundException('Fiche client introuvable.');
    return client;
  }

  private professionalView(invitation: ClientInvitation | null) {
    if (!invitation) return null;
    return {
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      emailSentAt: invitation.emailSentAt,
      acceptedAt: invitation.acceptedAt,
      status: invitationStatus(invitation),
    };
  }

  /** État de l'invitation d'une fiche (pour le salon). */
  async status(proUserId: string, clientId: string) {
    const client = await this.ownedClient(proUserId, clientId);
    const latest = await this.prisma.clientInvitation.findFirst({
      where: { clientId: client.id },
      orderBy: { createdAt: 'desc' },
    });
    return { linked: !!client.linkedUserId, invitation: this.professionalView(latest) };
  }

  /**
   * Crée un nouveau lien d'invitation (les précédents sont annulés) et l'envoie par e-mail si demandé.
   * Le lien n'est renvoyé qu'ici : seule son empreinte est stockée.
   */
  async create(proUserId: string, clientId: string, options: { sendEmail?: boolean } = {}) {
    const client = await this.ownedClient(proUserId, clientId);
    if (client.linkedUserId)
      throw fail(HttpStatus.CONFLICT, 'CLIENT_ALREADY_LINKED', 'Cette fiche est déjà reliée à un compte Inkera.');
    const email = client.email?.trim().toLowerCase();
    if (!email)
      throw fail(HttpStatus.BAD_REQUEST, 'CLIENT_EMAIL_REQUIRED', 'Ajoutez l’e-mail du client à sa fiche pour l’inviter.');

    const now = new Date();
    const since = new Date(now.getTime() - DAY_MS);
    const [recentLinks, recentEmail] = await Promise.all([
      this.prisma.clientInvitation.count({ where: { clientId: client.id, createdAt: { gt: since } } }),
      options.sendEmail
        ? this.prisma.clientInvitation.findFirst({
            where: { clientId: client.id, emailSentAt: { gt: new Date(now.getTime() - EMAIL_COOLDOWN_MS) } },
            select: { id: true },
          })
        : null,
    ]);
    if (recentLinks >= MAX_LINKS_PER_DAY)
      throw fail(HttpStatus.TOO_MANY_REQUESTS, 'INVITATION_LIMIT', 'Trop de liens créés pour ce client aujourd’hui. Réessayez demain.');
    if (recentEmail)
      throw fail(HttpStatus.TOO_MANY_REQUESTS, 'INVITATION_EMAIL_COOLDOWN', 'Une invitation a déjà été envoyée par e-mail à ce client il y a moins de 24 h. Vous pouvez copier ou partager le lien.');

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + VALID_DAYS * DAY_MS);
    // Les liens déjà envoyés restent valables (e-mail puis copie, par ex.) ; ils sont annulés quand l'un d'eux est accepté.
    const invitation = await this.prisma.clientInvitation.create({
      data: { clientId: client.id, salonId: proUserId, email, tokenHash: digest(token), expiresAt },
    });
    const url = `${peopleOrigin()}/invitation/${token}`;

    let emailSent = false;
    if (options.sendEmail) {
      const salon = await this.prisma.user.findUnique({
        where: { id: proUserId },
        select: { salonName: true, firstName: true, lastName: true },
      });
      const salonName = salonDisplayName(salon);
      try {
        const { subject, html } = renderClientInvitationEmail({
          clientFirstName: client.firstName || '',
          salonName,
          invitationUrl: url,
          expiresAt,
        });
        await this.mail.sendMail(email, subject, html, salonName);
        emailSent = true;
        await this.prisma.clientInvitation.update({ where: { id: invitation.id }, data: { emailSentAt: new Date() } });
      } catch (error) {
        this.logger.warn(`Invitation client : e-mail non envoyé (${error instanceof Error ? error.message : 'erreur inconnue'})`);
      }
    }

    const saved = await this.prisma.clientInvitation.findUnique({ where: { id: invitation.id } });
    return { url, emailSent, invitation: this.professionalView(saved) };
  }

  /** Annule l'invitation en cours d'une fiche. */
  async revoke(proUserId: string, clientId: string) {
    const client = await this.ownedClient(proUserId, clientId);
    await this.prisma.clientInvitation.updateMany({
      where: { clientId: client.id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return this.status(proUserId, clientId);
  }

  private async findByToken(db: Prisma.TransactionClient | PrismaService, token: string) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    return db.clientInvitation.findUnique({
      where: { tokenHash: digest(token) },
      include: { client: { select: { id: true, userId: true, email: true, firstName: true, lastName: true, linkedUserId: true } } },
    });
  }

  /** Lecture publique d'un lien : le nom du salon, et le prénom / nom / e-mail de la fiche tant que le lien est valable. */
  async publicInfo(token: string) {
    const invitation = await this.findByToken(this.prisma, token);
    if (!invitation) throw fail(HttpStatus.NOT_FOUND, 'INVITATION_NOT_FOUND', 'Ce lien d’invitation n’existe pas.');
    const salon = await this.prisma.user.findUnique({
      where: { id: invitation.salonId },
      select: { salonName: true, firstName: true, lastName: true, profileImage: true, image: true },
    });
    const status = invitationStatus(invitation);
    return {
      status,
      salonName: salonDisplayName(salon),
      salonImage: salon?.profileImage || salon?.image || null,
      expiresAt: invitation.expiresAt,
      ...(status === 'ACTIVE'
        ? { firstName: invitation.client.firstName, lastName: invitation.client.lastName, email: invitation.email }
        : {}),
    };
  }

  /** Le client connecté accepte l'invitation : sa fiche est reliée à son compte si l'e-mail correspond. */
  async accept(token: string, userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const found = await this.findByToken(tx, token);
      if (!found) throw fail(HttpStatus.NOT_FOUND, 'INVITATION_NOT_FOUND', 'Ce lien d’invitation n’existe pas.');
      await tx.$queryRaw`SELECT id FROM "ClientInvitation" WHERE id = ${found.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${found.clientId} FOR UPDATE`;
      const invitation = await this.findByToken(tx, token);
      if (!invitation) throw fail(HttpStatus.NOT_FOUND, 'INVITATION_NOT_FOUND', 'Ce lien d’invitation n’existe pas.');
      return { ...(await this.acceptLocked(tx, invitation, userId)), invitation };
    });
    if (result.linkedNow) await this.notifySalon(result.invitation, 'accepted');
    return { linked: true, salonName: result.salonName };
  }

  /** Prévient le salon que son client a rejoint Inkera (après validation de la transaction ; ne lève jamais d'erreur). */
  private async notifySalon(
    invitation: { salonId: string; client: { id: string; email: string | null; firstName: string | null; lastName: string | null } },
    how: 'accepted' | 'signup',
  ) {
    if (!this.notifications) return;
    const name = [invitation.client.firstName, invitation.client.lastName].filter(Boolean).join(' ').trim() || 'Votre client';
    await this.notifications.notify({
      userId: invitation.salonId,
      type: 'client.account_linked',
      title: how === 'signup' ? `${name} a rejoint Inkera` : `${name} a accepté votre invitation`,
      body: 'Ses rendez-vous apparaissent maintenant dans son espace Inkera. Vous pouvez lui écrire dans la messagerie.',
      data: { clientId: invitation.client.id, clientEmail: invitation.client.email },
      dedupeKey: `client.account_linked:${invitation.client.id}`,
    });
  }

  /** `linkedNow` : la fiche vient d'être reliée (faux si l'invitation avait déjà été acceptée par ce compte). */
  private async acceptLocked(
    tx: Prisma.TransactionClient,
    invitation: NonNullable<Awaited<ReturnType<ClientInvitationsService['findByToken']>>>,
    userId: string,
  ): Promise<{ salonName: string; linkedNow: boolean }> {
    const { client } = invitation;
    const status = invitationStatus(invitation);
    if (status === 'ACCEPTED' && invitation.acceptedUserId === userId && client.linkedUserId === userId)
      return { salonName: await this.salonName(tx, invitation.salonId), linkedNow: false };
    if (status === 'ACCEPTED') throw fail(HttpStatus.GONE, 'INVITATION_USED', 'Ce lien d’invitation a déjà été utilisé.');
    if (status === 'REVOKED') throw fail(HttpStatus.GONE, 'INVITATION_REVOKED', 'Ce lien n’est plus valable. Demandez un nouveau lien à votre salon.');
    if (status === 'EXPIRED') throw fail(HttpStatus.GONE, 'INVITATION_EXPIRED', 'Ce lien d’invitation a expiré. Demandez-en un nouveau à votre salon.');

    const account = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, email: true, emailVerified: true },
    });
    if (!account || account.role !== 'client')
      throw fail(HttpStatus.FORBIDDEN, 'CLIENT_ACCOUNT_REQUIRED', 'Connectez-vous avec un compte client Inkera.');
    if (!account.emailVerified)
      throw fail(HttpStatus.FORBIDDEN, 'EMAIL_NOT_VERIFIED', 'Confirmez d’abord votre adresse e-mail (lien reçu à l’inscription).');
    if (!sameClientEmail(account.email, invitation.email) || !sameClientEmail(account.email, client.email))
      throw fail(HttpStatus.FORBIDDEN, 'EMAIL_MISMATCH', 'Ce compte n’utilise pas l’adresse e-mail à laquelle l’invitation a été envoyée.');
    if (client.linkedUserId && client.linkedUserId !== userId)
      throw fail(HttpStatus.CONFLICT, 'CLIENT_ALREADY_LINKED', 'Cette fiche est déjà reliée à un autre compte.');
    const otherLinked = await tx.client.findFirst({
      where: { userId: client.userId, linkedUserId: userId, NOT: { id: client.id } },
      select: { id: true },
    });
    if (otherLinked)
      throw fail(HttpStatus.CONFLICT, 'ACCOUNT_ALREADY_LINKED', 'Votre compte est déjà relié à une autre fiche chez ce salon.');

    const linkedNow = client.linkedUserId !== userId;
    const now = new Date();
    await tx.client.updateMany({
      where: { id: client.id, userId: client.userId, OR: [{ linkedUserId: null }, { linkedUserId: userId }] },
      data: { linkedUserId: userId },
    });
    await tx.clientInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: now, acceptedUserId: userId, pendingUserId: null },
    });
    await tx.clientInvitation.updateMany({
      where: { clientId: client.id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    return { salonName: await this.salonName(tx, invitation.salonId), linkedNow };
  }

  private async salonName(db: Prisma.TransactionClient, salonId: string) {
    const salon = await db.user.findUnique({ where: { id: salonId }, select: { salonName: true, firstName: true, lastName: true } });
    return salonDisplayName(salon);
  }

  /**
   * Inscription faite depuis le lien : le compte (même e-mail) est noté sur l'invitation, qui sera acceptée
   * automatiquement à la vérification de l'e-mail. Ne lève jamais d'erreur (l'inscription ne doit pas échouer pour ça).
   */
  async rememberSignup(token: string | undefined, account: { id: string; email: string }) {
    if (!token) return;
    try {
      const invitation = await this.findByToken(this.prisma, token);
      if (!invitation || invitationStatus(invitation) !== 'ACTIVE' || !sameClientEmail(account.email, invitation.email)) return;
      await this.prisma.clientInvitation.update({ where: { id: invitation.id }, data: { pendingUserId: account.id } });
    } catch (error) {
      this.logger.warn(`Invitation client : inscription non rattachée (${error instanceof Error ? error.message : 'erreur inconnue'})`);
    }
  }

  /** Après la vérification de l'e-mail : accepte les invitations dont l'inscription vient de ce compte. Ne lève jamais d'erreur. */
  async acceptPendingForEmail(email: string) {
    try {
      const account = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!account) return;
      const pending = await this.prisma.clientInvitation.findMany({
        where: { pendingUserId: account.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, clientId: true },
      });
      for (const { id, clientId } of pending) {
        try {
          const accepted = await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "ClientInvitation" WHERE id = ${id} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
            const invitation = await tx.clientInvitation.findUnique({
              where: { id },
              include: { client: { select: { id: true, userId: true, email: true, firstName: true, lastName: true, linkedUserId: true } } },
            });
            return invitation ? { ...(await this.acceptLocked(tx, invitation, account.id)), invitation } : null;
          });
          if (accepted?.linkedNow) await this.notifySalon(accepted.invitation, 'signup');
        } catch (error) {
          this.logger.warn(`Invitation client ${id} non acceptée (${error instanceof Error ? error.message : 'erreur inconnue'})`);
        }
      }
    } catch (error) {
      this.logger.warn(`Invitations client en attente non traitées (${error instanceof Error ? error.message : 'erreur inconnue'})`);
    }
  }
}
