import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingLink, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { ResidenciesService } from '../residencies/residencies.service';
import { InboxService } from '../messaging/inbox/inbox.service';
import { SaasService } from '../saas/saas.service';
import { dateOnly } from './desired-tattoo-period';
import { parisDate, parisTime } from '../residencies/presence';
import {
  publicDisplayName,
  publicNameSlug,
} from '../user/public-profile.utils';
import { bookingLinkCandidates } from './booking-link-time';
import {
  BookingLinkAvailabilityDto,
  ConfirmBookingLinkDto,
  CreateBookingLinkDto,
  ListBookingLinksDto,
} from './dto/booking-link.dto';
import { BookingLinkNotificationsService } from './booking-link-notifications.service';

type Tx = Prisma.TransactionClient;
type Target = Pick<
  BookingLink,
  'userId' | 'tatoueurId' | 'performerUserId' | 'venueSalonId'
>;
const fail = (code: string, message: string) =>
  new BadRequestException({ code, message });
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
export const tokenDigest = (token: string) =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class BookingLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly residencies: ResidenciesService,
    private readonly inbox: InboxService,
    private readonly saas: SaasService,
    private readonly notifications: BookingLinkNotificationsService,
  ) {}

  private effectiveStatus(link: BookingLink) {
    if (link.status !== 'ACTIVE') return link.status;
    return (link.expiresAt && link.expiresAt <= new Date()) ||
      parisDate(isoDay(link.allowedTo), 1440) <= new Date()
      ? 'EXPIRED'
      : 'ACTIVE';
  }

  private assertActive(link: BookingLink) {
    const status = this.effectiveStatus(link);
    if (status !== 'ACTIVE') {
      const error = {
        code: `BOOKING_LINK_${status}`,
        message: {
          USED: 'Ce lien a déjà été utilisé.',
          EXPIRED: 'Ce lien a expiré.',
          REVOKED: 'Ce lien a été révoqué.',
        }[status],
      };
      if (status === 'USED') throw new ConflictException(error);
      throw new GoneException(error);
    }
  }

  private async byToken(token: string, tx: Tx = this.prisma) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new NotFoundException({
        code: 'BOOKING_LINK_NOT_FOUND',
        message: 'Lien introuvable.',
      });
    const link = await tx.bookingLink.findUnique({
      where: { tokenHash: tokenDigest(token) },
    });
    if (!link)
      throw new NotFoundException({
        code: 'BOOKING_LINK_NOT_FOUND',
        message: 'Lien introuvable.',
      });
    this.assertActive(link);
    return link;
  }

  /** Permission flags are the existing residency flags, never just team membership. */
  private async assertProfessional(
    actorId: string,
    target: Target,
    action: 'create' | 'view' | 'manage',
    tx: Tx = this.prisma,
  ) {
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (
      !actor ||
      !['user', 'user_salon', 'user_tatoueur'].includes(actor.role) ||
      actor.saasPlan === 'FREE'
    )
      throw new ForbiddenException({
        code: 'BOOKING_LINK_FORBIDDEN',
        message: 'Compte professionnel avec accès aux rendez-vous requis.',
      });
    if (!target.performerUserId) {
      if (actorId !== target.userId) throw new ForbiddenException();
      if (
        target.tatoueurId &&
        !(await tx.tatoueur.findFirst({
          where: { id: target.tatoueurId, userId: target.userId },
        }))
      )
        throw new ForbiddenException();
      if (target.venueSalonId && target.venueSalonId !== target.userId)
        throw new ForbiddenException();
      return;
    }
    const artistId = target.performerUserId;
    const venueId = target.venueSalonId;
    if (target.userId !== artistId && target.userId !== venueId)
      throw new ForbiddenException();
    if (!venueId) {
      if (actorId !== artistId || target.userId !== artistId)
        throw new ForbiddenException();
      if (
        await tx.salonResidency.findFirst({
          where: { artistId, endedAt: null },
        })
      )
        throw fail('VENUE_REQUIRED', 'Choisissez le salon du rendez-vous.');
      return;
    }
    const member = await tx.salonResidency.findFirst({
      where: { artistId, salonId: venueId, endedAt: null },
    });
    const allowed =
      actorId === artistId
        ? action === 'view' ||
          (action === 'create'
            ? member?.salonAllowsArtistCreate
            : member?.salonAllowsArtistManage)
        : actorId === venueId &&
          (action === 'view'
            ? member?.artistAllowsSalonView
            : action === 'create'
              ? member?.artistAllowsSalonCreate
              : member?.artistAllowsSalonManage);
    if (!member || !allowed)
      throw new ForbiddenException({
        code: 'BOOKING_LINK_FORBIDDEN',
        message: 'Le rattachement ne permet pas cette action.',
      });
  }

  private async publicTarget(
    target: Target,
    prestation: string,
    tx: Tx = this.prisma,
  ) {
    const owner = await tx.user.findUnique({
      where: { id: target.userId },
      include: { saasPlanDetails: true },
    });
    const performer = target.performerUserId
      ? await tx.user.findUnique({
          where: { id: target.performerUserId },
          include: { saasPlanDetails: true },
        })
      : null;
    const profile = performer || owner;
    const internal = target.tatoueurId
      ? await tx.tatoueur.findFirst({
          where: { id: target.tatoueurId, userId: target.userId },
        })
      : null;
    if (
      !owner ||
      !profile ||
      !['user', 'user_salon', 'user_tatoueur'].includes(profile.role) ||
      owner.publicVisibility === 'HIDDEN' ||
      profile.publicVisibility === 'HIDDEN' ||
      !publicNameSlug(owner.salonName || '')
    )
      throw new ForbiddenException({
        code: 'BOOKING_PROFILE_UNAVAILABLE',
        message: 'Profil public indisponible.',
      });
    if (target.tatoueurId && (!internal || !internal.rdvBookingEnabled))
      throw new ForbiddenException('Tatoueur indisponible.');
    if (!target.performerUserId && owner.role === 'user_salon' && !internal)
      throw new ForbiddenException('Choisissez un tatoueur.');
    if (!profile.prestations.includes(prestation))
      throw new ForbiddenException('Prestation indisponible.');
    if (profile.saasPlan === 'FREE' && performer) {
      const sponsor = await this.residencies.businessSponsor(
        performer.id,
        target.venueSalonId || undefined,
        true,
        tx,
      );
      if (target.userId !== sponsor.id)
        throw new ForbiddenException(
          'Le salon Business doit posséder ce rendez-vous.',
        );
    } else {
      const details = profile.saasPlanDetails;
      if (
        profile.saasPlan === 'FREE' ||
        details?.currentPlan === 'FREE' ||
        details?.planStatus === 'EXPIRED' ||
        [
          profile.saasPlanUntil,
          details?.endDate,
          ...(details?.planStatus === 'TRIAL' ? [details.trialEndDate] : []),
        ].some((d) => d && d <= new Date())
      )
        throw new ForbiddenException('Réservation publique indisponible.');
    }
    if (performer && target.venueSalonId) {
      const member = await tx.salonResidency.findFirst({
        where: {
          artistId: performer.id,
          salonId: target.venueSalonId,
          endedAt: null,
        },
        include: { salon: true },
      });
      if (
        !member?.artistAllowsPublicBooking ||
        !member.salonAllowsPublicBooking ||
        member.salon.publicVisibility === 'HIDDEN'
      )
        throw new ForbiddenException(
          'Réservation publique fermée dans ce salon.',
        );
    } else if (
      performer &&
      (await tx.salonResidency.findFirst({
        where: { artistId: performer.id, endedAt: null },
      }))
    )
      throw new ForbiddenException('Lieu du rendez-vous devenu indisponible.');
    return {
      owner,
      profile,
      internal,
      hours: internal ? internal.hours : profile.salonHours,
    };
  }

  private url(token: string, salonName: string | null) {
    const slug = publicNameSlug(salonName || '');
    if (!slug)
      throw fail(
        'PUBLIC_SLUG_REQUIRED',
        'Le profil doit disposer d’un nom public.',
      );
    const base = new URL(
      process.env.INKERA_PEOPLE_BASE_URL || 'https://theinkera.com',
    );
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== '/' ||
      (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')
    )
      throw new Error(
        'INKERA_PEOPLE_BASE_URL must be the public People origin',
      );
    return {
      publicSlug: slug,
      bookingUrl: `${base.origin}/${slug}/rdv/${token}`,
    };
  }

  private professionalResponse(link: BookingLink) {
    const { tokenHash: _tokenHash, ...safe } = link;
    return {
      ...safe,
      status: this.effectiveStatus(link),
      allowedFrom: isoDay(link.allowedFrom),
      allowedTo: isoDay(link.allowedTo),
    };
  }

  async create(actorId: string, dto: CreateBookingLinkDto) {
    await this.saas.enforceSaasAccess(actorId, 'appointment');
    const allowedFrom = dateOnly(dto.allowedFrom),
      allowedTo = dateOnly(dto.allowedTo);
    if (
      allowedFrom > allowedTo ||
      allowedTo.getTime() - allowedFrom.getTime() > 365 * 86400000 ||
      parisDate(dto.allowedTo, 1440) <= new Date()
    )
      throw fail(
        'INVALID_BOOKING_WINDOW',
        'Période invalide (maximum 366 jours).',
      );
    if (
      (dto.mode === 'FIXED_START' && !dto.fixedStartTime) ||
      (dto.mode === 'AUTOMATIC' && dto.fixedStartTime)
    )
      throw fail(
        'INVALID_BOOKING_MODE',
        'Heure fixe requise uniquement en mode FIXED_START.',
      );
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (
      expiresAt &&
      (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
    )
      throw fail('INVALID_EXPIRATION', 'Expiration future requise.');
    const project = dto.projectAppointmentId
      ? await this.prisma.appointment.findUnique({
          where: { id: dto.projectAppointmentId },
          include: { conversation: true },
        })
      : null;
    if (dto.projectAppointmentId) {
      await this.residencies.assertAppointmentAccess(
        dto.projectAppointmentId,
        actorId,
        true,
      );
      if (!project || project.prestation !== 'PROJET')
        throw fail(
          'INVALID_PROJECT',
          'Le rendez-vous source doit être un PROJET.',
        );
    }
    const conversationId = dto.conversationId || project?.conversation?.id;
    const thread = dto.inboxThreadId
      ? await this.inbox.getThread(actorId, dto.inboxThreadId)
      : conversationId
        ? await this.inbox.getThreadByConversation(actorId, conversationId)
        : null;
    if (conversationId && thread?.conversationId !== conversationId)
      throw fail('ASSOCIATION_MISMATCH', 'Conversation incohérente.');
    const userId =
      dto.userId || project?.userId || thread?.ownerUserId || actorId;
    if (
      (project && project.userId !== userId) ||
      (thread && thread.ownerUserId !== userId)
    )
      throw new ForbiddenException(
        'Les ressources doivent appartenir au même professionnel.',
      );
    const selected =
      dto.tatoueurId ||
      (project?.performerUserId
        ? `linked_${project.performerUserId}`
        : project?.tatoueurId) ||
      (thread?.assignedUserId
        ? `linked_${thread.assignedUserId}`
        : thread?.assignedTatoueurId) ||
      userId;
    const selectedId = selected.replace(/^linked_/, '');
    const internal = selected.startsWith('linked_')
      ? null
      : await this.prisma.tatoueur.findFirst({
          where: { id: selectedId, userId },
        });
    const artist = internal
      ? null
      : await this.prisma.user.findFirst({
          where: { id: selectedId, role: 'user_tatoueur' },
        });
    if (!internal && !artist)
      throw fail('INVALID_ARTIST', 'Tatoueur introuvable.');
    const target: Target = {
      userId,
      tatoueurId: internal?.id || null,
      performerUserId: artist?.id || null,
      venueSalonId:
        dto.venueSalonId ||
        project?.venueSalonId ||
        (artist && userId !== artist.id ? userId : null),
    };
    if (
      project &&
      (project.tatoueurId !== target.tatoueurId ||
        project.performerUserId !== target.performerUserId ||
        (project.venueSalonId && project.venueSalonId !== target.venueSalonId))
    )
      throw fail(
        'ASSOCIATION_MISMATCH',
        'Le tatoueur et le salon doivent correspondre au projet.',
      );
    await this.assertProfessional(actorId, target, 'create');
    const { owner } = await this.publicTarget(target, dto.prestation);
    let clientId =
      dto.clientId || project?.clientId || thread?.linkedClientId || null;
    if (
      [dto.clientId, project?.clientId, thread?.linkedClientId].some(
        (id) => id && id !== clientId,
      )
    )
      throw fail('ASSOCIATION_MISMATCH', 'Fiches clients incompatibles.');
    let clientUserId =
      project?.clientUserId || thread?.conversation?.clientUserId || null;
    if (
      project?.clientUserId &&
      thread?.conversation?.clientUserId &&
      project.clientUserId !== thread.conversation.clientUserId
    )
      throw fail('ASSOCIATION_MISMATCH', 'Comptes clients incompatibles.');
    if (!clientId && clientUserId)
      clientId =
        (
          await this.prisma.client.findFirst({
            where: { userId, linkedUserId: clientUserId },
          })
        )?.id || null;
    if (clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: clientId, userId },
      });
      if (!client) throw new ForbiddenException('Fiche client inaccessible.');
      if (
        client.linkedUserId &&
        clientUserId &&
        client.linkedUserId !== clientUserId
      )
        throw fail('ASSOCIATION_MISMATCH', 'Compte client incompatible.');
      clientUserId ||= client.linkedUserId;
    }
    // Never infer a CRM record from an external contact's name or email.
    const token = randomBytes(32).toString('base64url');
    const url = this.url(token, owner.salonName);
    const link = await this.prisma.bookingLink.create({
      data: {
        ...target,
        createdByUserId: actorId,
        tokenHash: tokenDigest(token),
        prestation: dto.prestation,
        durationMinutes: dto.durationMinutes,
        mode: dto.mode,
        fixedStartTime: dto.fixedStartTime || null,
        allowedFrom,
        allowedTo,
        expiresAt,
        clientId,
        clientUserId,
        projectAppointmentId: project?.id,
        conversationId: thread?.conversationId,
        inboxThreadId: thread?.id,
      },
    });
    return { error: false, link: this.professionalResponse(link), ...url };
  }

  async list(actorId: string, query: ListBookingLinksDto) {
    const where: Prisma.BookingLinkWhereInput = {
      OR: [
        { userId: actorId },
        { performerUserId: actorId },
        { venueSalonId: actorId },
      ],
      ...(query.userId ? { userId: query.userId } : {}),
    };
    const rows = await this.prisma.bookingLink.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit + 1,
    });
    const data: ReturnType<BookingLinksService['professionalResponse']>[] = [];
    for (const link of rows.slice(0, query.limit)) {
      try {
        await this.assertProfessional(actorId, link, 'view');
        data.push(this.professionalResponse(link));
      } catch (error) {
        if (
          !(
            error instanceof ForbiddenException ||
            error instanceof BadRequestException
          )
        )
          throw error;
      }
    }
    return {
      data,
      page: query.page,
      limit: query.limit,
      hasMore: rows.length > query.limit,
    };
  }

  async get(actorId: string, id: string) {
    const link = await this.prisma.bookingLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException();
    await this.assertProfessional(actorId, link, 'view');
    return { link: this.professionalResponse(link) };
  }

  async revoke(actorId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BookingLink" WHERE id = ${id} FOR UPDATE`;
      const link = await tx.bookingLink.findUnique({ where: { id } });
      if (!link) throw new NotFoundException();
      await this.assertProfessional(actorId, link, 'manage', tx);
      if (link.status === 'REVOKED')
        return { link: this.professionalResponse(link) };
      this.assertActive(link);
      return {
        link: this.professionalResponse(
          await tx.bookingLink.update({
            where: { id },
            data: { status: 'REVOKED', revokedAt: new Date() },
          }),
        ),
      };
    });
  }

  async publicInfo(token: string) {
    const link = await this.byToken(token);
    const { owner, profile, internal } = await this.publicTarget(
      link,
      link.prestation,
    );
    const url = this.url(token, owner.salonName);
    return {
      ...url,
      status: 'ACTIVE',
      prestation: link.prestation,
      durationMinutes: link.durationMinutes,
      mode: link.mode,
      fixedStartTime: link.fixedStartTime,
      timeZone: 'Europe/Paris',
      allowedFrom: isoDay(link.allowedFrom),
      allowedTo: isoDay(link.allowedTo),
      expiresAt: link.expiresAt,
      requiresAuthentication: !!(link.clientUserId || link.clientId),
      professional: {
        tattooPractices: owner.tattooPractices,
        tattooPracticeDetails: owner.tattooPracticeDetails,
        name: publicDisplayName(owner),
        image: owner.profileImage || owner.image,
        city: owner.city,
        address: owner.address,
        postalCode: owner.postalCode,
      },
      artist: {
        tattooPractices: internal ? internal.tattooPractices : profile.tattooPractices,
        tattooPracticeDetails: internal ? internal.tattooPracticeDetails : profile.tattooPracticeDetails,
        name: internal?.name || publicDisplayName(profile),
        image: internal?.img || profile.profileImage || profile.image,
      },
    };
  }

  async availability(token: string, query: BookingLinkAvailabilityDto) {
    const from = dateOnly(query.from),
      to = dateOnly(query.to);
    if (from > to || to.getTime() - from.getTime() > 6 * 86400000)
      throw fail(
        'INVALID_AVAILABILITY_WINDOW',
        'Demandez entre 1 et 7 jours à la fois.',
      );
    const link = await this.byToken(token);
    const { hours } = await this.publicTarget(link, link.prestation);
    const dates: { date: string; slots: { start: Date; end: Date }[] }[] = [];
    for (
      let day = Math.max(from.getTime(), link.allowedFrom.getTime());
      day <= Math.min(to.getTime(), link.allowedTo.getTime());
      day += 86400000
    ) {
      const date = isoDay(new Date(day));
      const slots: { start: Date; end: Date }[] = [];
      for (const slot of bookingLinkCandidates(
        date,
        hours,
        link.durationMinutes,
        link.mode,
        link.fixedStartTime,
      )) {
        try {
          await this.residencies.validateBookingLinkSlot({ ...link, ...slot });
          slots.push(slot);
        } catch (error) {
          if (
            !(
              error instanceof ConflictException ||
              error instanceof ForbiddenException ||
              error instanceof BadRequestException
            )
          )
            throw error;
        }
      }
      if (slots.length) dates.push({ date, slots });
    }
    this.assertActive(link);
    return { timeZone: 'Europe/Paris', dates };
  }

  async confirm(
    token: string,
    dto: ConfirmBookingLinkDto,
    authenticatedClientUserId?: string,
  ) {
    const initial = await this.byToken(token);
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Same ordering as existing client booking: client account, calendar, invitation.
        if (authenticatedClientUserId)
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${authenticatedClientUserId} FOR UPDATE`;
        const calendarId = initial.performerUserId || initial.userId;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${calendarId} FOR UPDATE`;
        if (initial.venueSalonId && initial.venueSalonId !== calendarId)
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${initial.venueSalonId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "BookingLink" WHERE id = ${initial.id} FOR UPDATE`;
        const link = await this.byToken(token, tx);
        const { owner, hours } = await this.publicTarget(
          link,
          link.prestation,
          tx,
        );
        const start = new Date(dto.start);
        if (!Number.isFinite(start.getTime()))
          throw fail('INVALID_DATE', 'Date invalide.');
        const date = parisTime(start).date;
        const slot = bookingLinkCandidates(
          date,
          hours,
          link.durationMinutes,
          link.mode,
          link.fixedStartTime,
        ).find((s) => s.start.getTime() === start.getTime());
        if (
          date < isoDay(link.allowedFrom) ||
          date > isoDay(link.allowedTo) ||
          !slot
        )
          throw new ConflictException({
            code: 'SLOT_UNAVAILABLE',
            message: 'Ce créneau n’est plus disponible.',
          });
        try {
          await this.residencies.validateBookingLinkSlot(
            { ...link, ...slot },
            tx,
          );
        } catch (error) {
          if (
            error instanceof ConflictException ||
            error instanceof BadRequestException
          )
            throw new ConflictException({
              code: 'SLOT_UNAVAILABLE',
              message: 'Ce créneau n’est plus disponible.',
            });
          throw error;
        }
        const account = authenticatedClientUserId
          ? await tx.user.findFirst({
              where: { id: authenticatedClientUserId, role: 'client' },
            })
          : null;
        if (authenticatedClientUserId && !account)
          throw new ForbiddenException('Compte client indisponible.');
        if (link.clientUserId && link.clientUserId !== account?.id)
          throw new ForbiddenException({
            code: 'BOOKING_CLIENT_MISMATCH',
            message: 'Connectez-vous avec le compte destinataire du lien.',
          });
        let client = link.clientId
          ? await tx.client.findFirst({
              where: { id: link.clientId, userId: link.userId },
            })
          : null;
        if (link.clientId) {
          await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${link.clientId} FOR UPDATE`;
          client = await tx.client.findFirst({
            where: { id: link.clientId, userId: link.userId },
          });
          if (
            !client ||
            !account ||
            (client.linkedUserId
              ? client.linkedUserId !== account.id
              : !account.emailVerified ||
                client.email.trim().toLowerCase() !==
                  account.email.trim().toLowerCase())
          )
            throw new ForbiddenException({
              code: 'BOOKING_CLIENT_MISMATCH',
              message:
                'Le compte client ne correspond pas au destinataire vérifié.',
            });
        } else if (account)
          client = await tx.client.findFirst({
            where: { userId: link.userId, linkedUserId: account.id },
          });
        if (link.projectAppointmentId) {
          await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${link.projectAppointmentId} FOR UPDATE`;
          const project = await tx.appointment.findUnique({
            where: { id: link.projectAppointmentId },
          });
          if (
            !project ||
            project.userId !== link.userId ||
            project.prestation !== 'PROJET' ||
            (project.clientId && project.clientId !== link.clientId) ||
            (project.clientUserId &&
              project.clientUserId !== link.clientUserId) ||
            project.tatoueurId !== link.tatoueurId ||
            project.performerUserId !== link.performerUserId
          )
            throw fail(
              'ASSOCIATION_CHANGED',
              'Le projet a changé ; demandez un nouveau lien.',
            );
        }
        if (!client) {
          const email = account?.email || dto.rdvBody.clientEmail;
          if (
            await tx.client.findFirst({
              where: {
                userId: link.userId,
                email: { equals: email, mode: 'insensitive' },
              },
            })
          )
            throw new ConflictException({
              code: 'CLIENT_LINK_REQUIRED',
              message:
                'Une fiche existe déjà. Demandez au professionnel de confirmer son association.',
            });
          client = await tx.client.create({
            data: {
              userId: link.userId,
              firstName: account?.firstName || dto.rdvBody.clientFirstname,
              lastName: account?.lastName || dto.rdvBody.clientLastname,
              email,
              phone: account?.phone || dto.rdvBody.clientPhone || '',
              birthDate: dto.rdvBody.clientBirthdate
                ? dateOnly(dto.rdvBody.clientBirthdate)
                : null,
              ...(account ? { linkedUserId: account.id } : {}),
            },
          });
        }
        const appointment = await this.residencies.persistAppointment(
          {
            data: {
              userId: link.userId,
              tatoueurId: link.tatoueurId,
              performerUserId: link.performerUserId,
              venueSalonId: link.venueSalonId,
              title: `${link.prestation} - ${client.firstName} ${client.lastName}`,
              prestation: link.prestation,
              ...slot,
              status: 'CONFIRMED',
              clientId: client.id,
              clientUserId: account?.id,
              skin: dto.rdvBody.skin,
            },
          },
          null,
          true,
          tx,
        );
        const detail = await tx.tattooDetail.create({
          data: {
            appointmentId: appointment.id,
            clientId: client.id,
            description: '',
            zone: '',
            size: '',
            colorStyle: '',
            price: 0,
            estimatedPrice: 0,
          },
        });
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { tattooDetailId: detail.id },
        });
        let associatedThreadId: string | null = null;
        if (link.inboxThreadId) {
          await tx.$queryRaw`SELECT id FROM "InboxThread" WHERE id = ${link.inboxThreadId} FOR UPDATE`;
          const thread = await tx.inboxThread.findUnique({
            where: { id: link.inboxThreadId },
            include: { conversation: true },
          });
          if (
            !thread ||
            thread.ownerUserId !== link.userId ||
            (thread.linkedClientId && thread.linkedClientId !== client.id) ||
            (thread.conversation &&
              thread.conversation.clientUserId !== account?.id)
          )
            throw fail(
              'ASSOCIATION_CHANGED',
              'La conversation a changé ; demandez un nouveau lien.',
            );
          // An unlinked external thread is retained as provenance on the invitation only.
          if (
            thread.linkedClientId === client.id ||
            (thread.conversation?.clientUserId === account?.id && !!account)
          ) {
            await tx.inboxThreadAppointment.create({
              data: { inboxThreadId: thread.id, appointmentId: appointment.id },
            });
            associatedThreadId = thread.id;
          }
        }
        this.assertActive(link);
        await tx.bookingLink.update({
          where: { id: link.id },
          data: {
            status: 'USED',
            usedAt: new Date(),
            appointmentId: appointment.id,
          },
        });
        return {
          appointment,
          client: { ...client, email: account?.email || client.email },
          owner,
          associatedThreadId,
        };
      },
      { timeout: 20000 },
    );
    await this.notifications.afterConfirmation(result);
    // No private CRM fields, source project, or conversation IDs are returned publicly.
    return {
      error: false,
      appointment: {
        id: result.appointment.id,
        prestation: result.appointment.prestation,
        start: result.appointment.start,
        end: result.appointment.end,
        status: 'CONFIRMED',
      },
      status: 'USED',
    };
  }
}
