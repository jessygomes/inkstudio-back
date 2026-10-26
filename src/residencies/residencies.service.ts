import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalonResidency, SaasPlan } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { minutes, parisDate, parisTime } from './presence';
import {
  LocationPresence,
  nextLocationChange,
  nextLocationPresence,
  parsePresence,
  samePriorityOverlap,
  venueOnDate,
} from './location-presence';
import { businessBillingFields, canBookLinkedArtist, hasActiveBusiness } from './booking-access';
import { ResidencyPermissionsDto } from './dto';

const salonFields = {
  id: true,
  role: true,
  salonName: true,
  firstName: true,
  lastName: true,
  image: true,
  profileImage: true,
  address: true,
  city: true,
  postalCode: true,
  salonHours: true,
  instagram: true,
  website: true,
  prestations: true,
} as const;
type Tx = Prisma.TransactionClient;
const live = { endedAt: null };
const activeStatuses = ['PENDING', 'CONFIRMED'] as const;

@Injectable()
export class ResidenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private async invalidate() {
    await Promise.all(
      [
        'user:*',
        'users:*',
        'tatoueurs:*',
        'appointment:*',
        'appointments:*',
        'client:appointments:*',
        'dashboard:*',
      ].map((key) => this.cache.delPattern(key)),
    );
  }
  private async member(id: string, actorId: string, tx: Tx = this.prisma) {
    const member = await tx.salonResidency.findFirst({
      where: { id, ...live, OR: [{ salonId: actorId }, { artistId: actorId }] },
    });
    if (!member) throw new NotFoundException('Rattachement introuvable.');
    return member;
  }
  private async lockArtist(tx: Tx, artistId: string) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${artistId} FOR UPDATE`;
  }

  async list(actorId: string) {
    const residencies = await this.prisma.salonResidency.findMany({
      where: { ...live, OR: [{ salonId: actorId }, { artistId: actorId }] },
      include: {
        salon: { select: salonFields },
        artist: {
          select: {
            ...salonFields,
            currentResidencyId: true,
            currentResidencyUntil: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
    const allArtistResidencies = residencies.length
      ? await this.prisma.salonResidency.findMany({
          where: {
            artistId: { in: [...new Set(residencies.map((r) => r.artistId))] },
            ...live,
          },
        })
      : [];
    return {
      residencies: residencies.map((r) =>
        this.presenceState(
          r,
          allArtistResidencies.filter((m) => m.artistId === r.artistId),
          r.artist,
        ),
      ),
    };
  }

  private presenceState<T extends SalonResidency>(
    r: T,
    members: SalonResidency[],
    artist: {
      currentResidencyId?: string | null;
      currentResidencyUntil?: Date | null;
    },
  ) {
    const manual =
      !!artist.currentResidencyId &&
      (!artist.currentResidencyUntil ||
        new Date(artist.currentResidencyUntil) > new Date()) &&
      members.some((m) => m.id === artist.currentResidencyId);
    const currentId = manual
      ? artist.currentResidencyId
      : venueOnDate(members, parisTime(new Date()).date)?.id;
    return {
      ...r,
      presence: parsePresence(r.presence),
      isCurrentSalon: r.id === currentId,
      currentSalonMode: manual ? 'manual' : 'automatic',
      currentSalonUntil: manual ? artist.currentResidencyUntil : null,
      nextPresenceAt: nextLocationPresence(members, r.id),
    };
  }

  async publicSalons(artistId: string) {
    const [members, artist] = await Promise.all([
      this.prisma.salonResidency.findMany({
        where: { artistId, ...live },
        include: { salon: { select: { ...salonFields, ...businessBillingFields, addConfirmationEnabled: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.user.findUnique({
        where: { id: artistId },
        select: { currentResidencyId: true, currentResidencyUntil: true, saasPlan: true },
      }),
    ]);
    return members
      .map((r) => {
        const state = this.presenceState(r, members, artist || {});
        return {
          ...Object.fromEntries(Object.entries(r.salon).filter(([key]) => !["saasPlanUntil", "saasPlanDetails"].includes(key))),
          id: r.salon.id, salonName: r.salon.salonName, city: r.salon.city, postalCode: r.salon.postalCode,
          adress: r.salon.address,
          residencyId: r.id,
          linkedAt: r.joinedAt,
          presence: state.presence,
          isCurrentSalon: state.isCurrentSalon,
          currentSalonMode: state.currentSalonMode,
          currentSalonUntil: state.currentSalonUntil,
          nextPresenceAt: state.nextPresenceAt,
          addConfirmationEnabled: r.salon.addConfirmationEnabled,
          publicBookingEnabled:
            r.salonAllowsPublicBooking &&
            r.artistAllowsPublicBooking &&
            !!state.presence && canBookLinkedArtist(artist || {}, r.salon),
        };
      })
      .sort(
        (a, b) =>
          Number(b.isCurrentSalon) - Number(a.isCurrentSalon) ||
          (a.nextPresenceAt?.getTime() ?? Infinity) -
            (b.nextPresenceAt?.getTime() ?? Infinity),
      );
  }

  async salonArtists(salonId: string) {
    return this.prisma.salonResidency.findMany({
      where: { salonId, ...live },
      include: {
        salon: { select: businessBillingFields },
        artist: {
          select: {
            ...salonFields,
            description: true,
            phone: true,
            style: true,
            tiktok: true,
            saasPlan: true,
          },
        },
      },
    });
  }

  async updatePermissions(
    id: string,
    actorId: string,
    values: ResidencyPermissionsDto,
  ) {
    const member = await this.member(id, actorId);
    const allowed =
      actorId === member.salonId
        ? [
            'salonAllowsArtistCreate',
            'salonAllowsArtistManage',
            'salonAllowsPublicBooking',
          ]
        : [
            'artistAllowsSalonView',
            'artistAllowsSalonCreate',
            'artistAllowsSalonManage',
            'artistAllowsPublicBooking',
          ];
    const keys = Object.keys(values).filter((k) => values[k] !== undefined);
    if (keys.some((k) => !allowed.includes(k)))
      throw new ForbiddenException(
        'Vous pouvez uniquement modifier les autorisations que vous accordez.',
      );
    const result = await this.prisma.salonResidency.update({
      where: { id },
      data: Object.fromEntries(keys.map((k) => [k, values[k]])),
    });
    await this.invalidate();
    return result;
  }

  async setPresence(id: string, actorId: string, value: unknown) {
    let presence: LocationPresence | null;
    try {
      presence = parsePresence(value);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const initial = await this.member(id, actorId, tx);
      if (initial.artistId !== actorId)
        throw new ForbiddenException(
          'Seul le tatoueur peut modifier ses présences.',
        );
      await this.lockArtist(tx, actorId);
      const member = await this.member(id, actorId, tx);
      const others = await tx.salonResidency.findMany({
        where: { artistId: actorId, ...live, id: { not: id } },
      });
      if (
        others.some((m) =>
          samePriorityOverlap(presence, parsePresence(m.presence)),
        )
      )
        throw new ConflictException(
          'Deux salons ne peuvent pas avoir les mêmes jours récurrents ou des périodes qui se chevauchent.',
        );
      const members = [...others, { ...member, presence }];
      const future = await tx.appointment.findMany({
        where: {
          end: { gt: new Date() },
          // Unconfigured legacy venues are completed separately; do not block
          // configuring this venue on an unrelated missing presence.
          venueSalonId: { in: members.filter(m => m.id === id || m.presence !== null).map((m) => m.salonId) },
          status: { in: [...activeStatuses] },
          OR: [{ performerUserId: actorId }, { userId: actorId }],
        },
        select: { venueSalonId: true, start: true, end: true },
      });
      if (
        future.some(
          (a) => !this.presentAt(members, a.venueSalonId!, a.start, a.end),
        )
      )
        throw new ConflictException(
          'Des rendez-vous à venir ne correspondent pas à ces présences. Traitez-les avant de modifier les dates ou jours.',
        );
      const result = await tx.salonResidency.update({
        where: { id },
        data: {
          presence: presence ?? Prisma.DbNull,
          pendingSchedule: Prisma.DbNull,
          salonApproved: false,
          artistApproved: false,
        },
      });
      await this.refreshManualExpiry(tx, actorId, members as SalonResidency[]);
      return result;
    });
    await this.invalidate();
    return result;
  }

  private presentAt(
    members: { id: string; salonId: string; presence: unknown }[],
    salonId: string,
    start: Date,
    end: Date,
  ) {
    return (
      Number.isFinite(start.getTime()) &&
      end > start &&
      parisTime(start).date === parisTime(new Date(end.getTime() - 1)).date &&
      venueOnDate(members, parisTime(start).date)?.salonId === salonId
    );
  }

  private async refreshManualExpiry(
    tx: Tx,
    artistId: string,
    members: SalonResidency[],
  ) {
    const artist = await tx.user.findUniqueOrThrow({
      where: { id: artistId },
      select: { currentResidencyId: true, currentResidencyUntil: true },
    });
    if (!artist.currentResidencyId) return;
    const active =
      (!artist.currentResidencyUntil ||
        artist.currentResidencyUntil > new Date()) &&
      members.some((m) => m.id === artist.currentResidencyId);
    await tx.user.update({
      where: { id: artistId },
      data: active
        ? { currentResidencyUntil: nextLocationChange(members) }
        : { currentResidencyId: null, currentResidencyUntil: null },
    });
  }

  async setCurrentSalon(actorId: string, residencyId: string | null) {
    const result = await this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUniqueOrThrow({
        where: { id: actorId },
        select: { role: true },
      });
      if (actor.role !== 'user_tatoueur')
        throw new ForbiddenException(
          'Seul le tatoueur choisit son salon actuel.',
        );
      await this.lockArtist(tx, actorId);
      const members = await tx.salonResidency.findMany({
        where: { artistId: actorId, ...live },
      });
      if (residencyId && !members.some((m) => m.id === residencyId))
        throw new ForbiddenException('Choisissez un de vos salons actifs.');
      const until = residencyId ? nextLocationChange(members) : null;
      await tx.user.update({
        where: { id: actorId },
        data: { currentResidencyId: residencyId, currentResidencyUntil: until },
      });
      return { success: true, currentSalonUntil: until };
    });
    await this.invalidate();
    return result;
  }

  async leave(id: string, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      const member = await this.member(id, actorId, tx);
      await this.lockArtist(tx, member.artistId);
      const count = await tx.appointment.count({
        where: {
          venueSalonId: member.salonId,
          start: { gte: new Date() },
          status: { in: [...activeStatuses] },
          OR: [
            { userId: member.artistId },
            { performerUserId: member.artistId },
          ],
        },
      });
      if (count)
        throw new ConflictException(
          `${count} rendez-vous à venir dans ce salon. Traitez-les avant de terminer le rattachement.`,
        );
      await tx.salonResidency.update({
        where: { id },
        data: { endedAt: new Date(), pendingSchedule: Prisma.DbNull },
      });
      await tx.user.updateMany({
        where: { id: member.artistId, currentResidencyId: member.id },
        data: { currentResidencyId: null, currentResidencyUntil: null },
      });
      await tx.user.updateMany({
        where: { id: member.artistId, salonId: member.salonId },
        data: { salonId: null },
      });
      const remaining = await tx.salonResidency.findMany({ where: { artistId: member.artistId, ...live } });
      await this.refreshManualExpiry(tx, member.artistId, remaining);
    });
    await this.invalidate();
    return { success: true };
  }

  async searchSalons(query: string) {
    if (query.trim().length < 2) return [];
    return this.prisma.user.findMany({
      where: {
        role: 'user_salon',
        OR: [
          { salonName: { contains: query.trim(), mode: 'insensitive' } },
          { city: { contains: query.trim(), mode: 'insensitive' } },
        ],
      },
      select: salonFields,
      take: 20,
    });
  }

  async requestJoin(artistId: string, salonId: string, message?: string) {
    const [artist, salon] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: artistId },
        select: { role: true },
      }),
      this.prisma.user.findUnique({
        where: { id: salonId },
        select: { role: true },
      }),
    ]);
    if (artist?.role !== 'user_tatoueur' || salon?.role !== 'user_salon')
      throw new ForbiddenException(
        'Choisissez un salon valide depuis votre compte indépendant.',
      );
    if (
      await this.prisma.salonResidency.findFirst({
        where: { artistId, salonId, ...live },
      })
    )
      throw new ConflictException('Vous êtes déjà rattaché à ce salon.');
    if (
      await this.prisma.salonTatoueurTeamRequest.findFirst({
        where: { salonId, tatoueurUserId: artistId, status: 'PENDING' },
      })
    )
      throw new ConflictException(
        'Une demande est déjà en attente pour ce rattachement.',
      );
    return this.prisma.salonTatoueurTeamRequest.create({
      data: {
        salonId,
        tatoueurUserId: artistId,
        initiatedById: artistId,
        message: message?.trim().slice(0, 1000),
        status: 'PENDING',
      },
    });
  }

  async requests(actorId: string) {
    const requests = await this.prisma.salonTatoueurTeamRequest.findMany({
      where: {
        status: 'PENDING',
        OR: [{ salonId: actorId }, { tatoueurUserId: actorId }],
      },
      include: {
        salon: { select: salonFields },
        tatoueurUser: { select: salonFields },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      requests: requests.map((r) => ({
        ...r,
        incoming: (r.initiatedById || r.salonId) !== actorId,
      })),
    };
  }

  async respondRequest(
    requestId: string,
    actorId: string,
    action: 'accept' | 'refuse',
    permissions?: {
      artistAllowsSalonView?: boolean;
      artistAllowsSalonCreate?: boolean;
    },
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.salonTatoueurTeamRequest.findUnique({
        where: { id: requestId },
      });
      if (
        !request ||
        ![request.salonId, request.tatoueurUserId].includes(actorId) ||
        (request.initiatedById || request.salonId) === actorId
      )
        throw new ForbiddenException(
          'Seul le destinataire peut répondre à cette demande.',
        );
      await this.lockArtist(tx, request.tatoueurUserId);
      const changed = await tx.salonTatoueurTeamRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: {
          status: action === 'accept' ? 'ACCEPTED' : 'REFUSED',
          respondedAt: new Date(),
        },
      });
      if (!changed.count)
        throw new ConflictException('Cette demande a déjà été traitée.');
      if (action === 'accept') {
        const existing = await tx.salonResidency.findUnique({
          where: {
            salonId_artistId: {
              salonId: request.salonId,
              artistId: request.tatoueurUserId,
            },
          },
        });
        if (existing && !existing.endedAt)
          throw new ConflictException('Ce rattachement est déjà actif.');
        const data = {
          salonId: request.salonId,
          artistId: request.tatoueurUserId,
          ...(actorId === request.tatoueurUserId ? permissions : {}),
        };
        if (existing)
          await tx.salonResidency.update({
            where: { id: existing.id },
            data: {
              ...data,
              endedAt: null,
              joinedAt: new Date(),
              schedule: [],
              presence: Prisma.DbNull,
              pendingSchedule: Prisma.DbNull,
              salonApproved: false,
              artistApproved: false,
              salonAllowsArtistCreate: false,
              salonAllowsArtistManage: false,
              salonAllowsPublicBooking: false,
              artistAllowsPublicBooking: false,
              artistAllowsSalonView:
                permissions?.artistAllowsSalonView ?? false,
              artistAllowsSalonCreate:
                permissions?.artistAllowsSalonCreate ?? false,
              artistAllowsSalonManage: false,
            },
          });
        else await tx.salonResidency.create({ data });
      }
      return {
        error: false,
        message:
          action === 'accept'
            ? 'Rattachement accepté. Configurez les autorisations et indiquez les présences.'
            : 'Demande refusée.',
      };
    });
    await this.invalidate();
    return result;
  }

  async visibleAppointmentsWhere(
    actorId: string,
  ): Promise<Prisma.AppointmentWhereInput> {
    const user = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { role: true, saasPlan: true },
    });
    if (user?.role === 'user_tatoueur' && user.saasPlan === SaasPlan.FREE) return { id: { in: [] } };
    if (user?.role === 'user_tatoueur')
      return { OR: [{ userId: actorId }, { performerUserId: actorId }] };
    if (user?.role !== 'user_salon' || user.saasPlan === 'FREE')
      return { userId: actorId };
    const members = await this.prisma.salonResidency.findMany({
      where: { salonId: actorId, artistAllowsSalonView: true, ...live },
      select: { artistId: true },
    });
    return {
      OR: [
        { userId: actorId, performerUserId: null },
        {
          venueSalonId: actorId,
          performerUserId: { in: members.map((m) => m.artistId) },
        },
      ],
    };
  }

  async assertAppointmentAccess(id: string, actorId: string, manage: boolean) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      select: {
        userId: true,
        performerUserId: true,
        clientUserId: true,
        venueSalonId: true,
      },
    });
    if (!appointment) throw new NotFoundException('Rendez-vous introuvable.');
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true, saasPlan: true } });
    if (actor?.role === 'user_tatoueur' && actor.saasPlan === SaasPlan.FREE) throw new ForbiddenException('Le plan FREE ne donne pas accès à la gestion des rendez-vous.');
    if (!manage && appointment.clientUserId === actorId) return;
    const artistId = appointment.performerUserId;
    if (!artistId) {
      if (appointment.userId === actorId) return;
      throw new ForbiddenException();
    }
    if (artistId === actorId) {
      if (!appointment.venueSalonId || !manage) return;
      const member = await this.prisma.salonResidency.findFirst({
        where: { salonId: appointment.venueSalonId, artistId, ...live },
      });
      if (member?.salonAllowsArtistManage) return;
    } else if (appointment.venueSalonId === actorId) {
      const member = await this.prisma.salonResidency.findFirst({
        where: { salonId: actorId, artistId, ...live },
      });
      if (
        manage ? member?.artistAllowsSalonManage : member?.artistAllowsSalonView
      )
        return;
    }
    throw new ForbiddenException(
      'Ce rattachement ne vous autorise pas à consulter ou modifier ce rendez-vous.',
    );
  }

  async businessSponsor(artistId: string, salonId: string | undefined, publicBooking = true, tx: Tx = this.prisma) {
    if (!salonId) throw new ForbiddenException('Ce compte FREE peut recevoir des rendez-vous uniquement dans un salon Business relié.');
    const member = await tx.salonResidency.findFirst({ where: { artistId, salonId, ...live }, include: { salon: { select: { ...businessBillingFields, id: true, salonName: true, email: true, addConfirmationEnabled: true } } } });
    if (!member || !hasActiveBusiness(member.salon)) throw new ForbiddenException('Le salon choisi doit disposer d’un abonnement Business actif pour recevoir les rendez-vous de ce tatoueur FREE.');
    if (publicBooking ? !member.salonAllowsPublicBooking || !member.artistAllowsPublicBooking : !member.artistAllowsSalonCreate) throw new ForbiddenException('Les autorisations nécessaires pour ce rendez-vous ne sont pas activées.');
    return member.salon;
  }

  async venueSnapshot(
    artistId: string | null,
    ownerId: string,
    venueSalonId: string | undefined,
    actorId: string | null,
    publicBooking: boolean,
    start: Date,
    end: Date,
    tx: Tx = this.prisma,
    managing = false,
  ) {
    if (!artistId) {
      if (venueSalonId && venueSalonId !== ownerId)
        throw new ForbiddenException('Le lieu doit correspondre au salon.');
      return this.snapshot(ownerId, tx);
    }
    const members = await tx.salonResidency.findMany({
      where: { artistId, ...live },
    });
    const venueId =
      venueSalonId || (ownerId !== artistId ? ownerId : undefined);
    if (!venueId) {
      if (members.length)
        throw new BadRequestException('Choisissez le salon du rendez-vous.');
      if (ownerId !== artistId)
        throw new ForbiddenException(
          'Ce tatoueur n’est pas rattaché à votre salon.',
        );
      return this.snapshot(artistId, tx, false);
    }
    const member = members.find((m) => m.salonId === venueId);
    if (!member)
      throw new ForbiddenException(
        'Le tatoueur n’est pas rattaché à ce salon.',
      );
    if (publicBooking) {
      if (!member.salonAllowsPublicBooking || !member.artistAllowsPublicBooking)
        throw new ForbiddenException(
          'La réservation publique n’est pas ouverte dans ce salon.',
        );
    } else if (actorId === artistId) {
      if (
        !(managing
          ? member.salonAllowsArtistManage
          : member.salonAllowsArtistCreate)
      )
        throw new ForbiddenException(
          'Le salon ne vous autorise pas à gérer ces rendez-vous.',
        );
    } else if (
      actorId !== venueId ||
      !(managing
        ? member.artistAllowsSalonManage
        : member.artistAllowsSalonCreate)
    )
      throw new ForbiddenException(
        'Le tatoueur ne vous autorise pas à gérer ses rendez-vous dans ce salon.',
      );
    if (!this.presentAt(members, venueId, start, end))
      throw new BadRequestException(
        'Le tatoueur n’est pas présent dans ce salon à cette date.',
      );
    const artist = await tx.user.findUniqueOrThrow({
      where: { id: artistId },
      select: { salonHours: true },
    });
    if (!this.artistOpen(artist.salonHours, start, end))
      throw new BadRequestException(
        'Le rendez-vous est en dehors des horaires personnels du tatoueur.',
      );
    return this.snapshot(venueId, tx);
  }

  private async snapshot(userId: string, tx: Tx, salon = true) {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: salonFields,
    });
    return {
      venueSalonId: salon ? userId : null,
      venueName:
        user.salonName ||
        `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      venueAddress: user.address,
      venueCity: user.city,
      venuePostalCode: user.postalCode,
    };
  }

  private artistOpen(hoursJson: string | null, start: Date, end: Date) {
    let hours: Record<string, { start: string; end: string } | null>;
    try {
      hours = JSON.parse(hoursJson || '{}');
    } catch {
      return false;
    }
    const a = parisTime(start);
    const b = parisTime(end);
    const day = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ][a.day - 1];
    const hoursForDay = hours[day];
    return (
      !!hoursForDay &&
      a.date === b.date &&
      minutes(hoursForDay.start) <= a.minute &&
      minutes(hoursForDay.end) >= b.minute
    );
  }

  async slots(
    artistId: string,
    salonId: string,
    date: string,
    actorId: string | null = null,
    publicBooking = true,
    appointmentId?: string,
  ) {
    if (!artistId || !salonId)
      throw new BadRequestException('Le tatoueur et le salon sont requis.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))
      throw new BadRequestException('Date invalide.');
    const member = await this.prisma.salonResidency.findFirst({
      where: { artistId, salonId, ...live },
    });
    if (!member) return [];
    if (appointmentId) {
      if (!actorId) throw new ForbiddenException();
      await this.assertAppointmentAccess(appointmentId, actorId, true);
      const appointment = await this.prisma.appointment.findUniqueOrThrow({
        where: { id: appointmentId },
      });
      if (
        appointment.performerUserId !== artistId ||
        appointment.venueSalonId !== salonId
      )
        throw new ForbiddenException();
    }
    if (parisTime(parisDate(date, 12 * 60)).date !== date)
      throw new BadRequestException('Date invalide.');
    if (
      publicBooking
        ? !member.salonAllowsPublicBooking || !member.artistAllowsPublicBooking
        : actorId === artistId
          ? !(appointmentId
              ? member.salonAllowsArtistManage
              : member.salonAllowsArtistCreate)
          : actorId !== salonId ||
            !(appointmentId
              ? member.artistAllowsSalonManage
              : member.artistAllowsSalonCreate)
    )
      return [];
    const billingArtist = await this.prisma.user.findUnique({ where: { id: artistId }, select: { saasPlan: true } });
    if (billingArtist?.saasPlan === SaasPlan.FREE) {
      try { await this.businessSponsor(artistId, salonId, publicBooking); } catch (error) { if (error instanceof ForbiddenException) return []; throw error; }
    }
    const members = await this.prisma.salonResidency.findMany({
      where: { artistId, ...live },
    });
    if (venueOnDate(members, date)?.salonId !== salonId) return [];
    const [artist, appointments, blocks] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: artistId },
        select: { salonHours: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          ...(appointmentId ? { id: { not: appointmentId } } : {}),
          start: { lt: parisDate(date, 1440) },
          end: { gt: parisDate(date, 0) },
          status: { in: [...activeStatuses] },
          OR: [{ userId: artistId }, { performerUserId: artistId }],
        },
        select: { start: true, end: true },
      }),
      this.prisma.blockedTimeSlot.findMany({
        where: {
          startDate: { lt: parisDate(date, 1440) },
          endDate: { gt: parisDate(date, 0) },
          OR: [{ userId: artistId }, { userId: salonId, tatoueurId: null }],
        },
        select: { startDate: true, endDate: true },
      }),
    ]);
    const day = parisTime(parisDate(date, 12 * 60)).day;
    let hours: Record<string, { start: string; end: string } | null>;
    try {
      hours = JSON.parse(artist.salonHours || '{}');
    } catch {
      return [];
    }
    const window =
      hours[
        [
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
          'sunday',
        ][day - 1]
      ];
    const windows = window ? [window] : [];
    const slots: { start: Date; end: Date }[] = [];
    for (const window of windows)
      for (
        let minute = minutes(window.start);
        minute + 30 <= minutes(window.end);
        minute += 30
      ) {
        const start = parisDate(date, minute);
        const end = parisDate(date, minute + 30);
        if (
          parisTime(start).minute !== minute ||
          parisTime(end).minute !== minute + 30 ||
          end <= start
        )
          continue;
        if (start <= new Date()) continue;
        if (
          this.artistOpen(artist.salonHours, start, end) &&
          !appointments.some((a) => a.start < end && a.end > start) &&
          !blocks.some((b) => b.startDate < end && b.endDate > start)
        )
          slots.push({ start, end });
      }
    return slots;
  }

  private async conflict(
    tx: Tx,
    artistId: string,
    salonId: string | null,
    start: Date,
    end: Date,
    excludingId?: string,
  ) {
    const appointment = await tx.appointment.findFirst({
      where: {
        ...(excludingId ? { id: { not: excludingId } } : {}),
        start: { lt: end },
        end: { gt: start },
        status: { in: [...activeStatuses] },
        OR: [{ userId: artistId }, { performerUserId: artistId }],
      },
      select: { id: true },
    });
    if (appointment) return true;
    return !!(await tx.blockedTimeSlot.findFirst({
      where: {
        startDate: { lt: end },
        endDate: { gt: start },
        OR: [
          { userId: artistId },
          ...(salonId ? [{ userId: salonId, tatoueurId: null }] : []),
        ],
      },
      select: { id: true },
    }));
  }

  async persistAppointment(
    args: Prisma.AppointmentCreateArgs,
    actorId: string | null,
    publicBooking: boolean,
  ): Promise<any> {
    const data = args.data as Prisma.AppointmentUncheckedCreateInput;
    const artistId = data.performerUserId;
    if (!artistId) {
      if (
        data.tatoueurId &&
        !(await this.prisma.tatoueur.findFirst({
          where: { id: data.tatoueurId, userId: data.userId },
        }))
      )
        throw new ForbiddenException(
          'Ce tatoueur ne fait pas partie du salon.',
        );
      const snapshot = await this.venueSnapshot(
        null,
        data.userId,
        data.venueSalonId || undefined,
        actorId,
        publicBooking,
        new Date(data.start as string),
        new Date(data.end as string),
      );
      return this.prisma.appointment.create({
        ...args,
        data: { ...args.data, ...snapshot } as any,
      });
    }
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockArtist(tx, artistId);
        const artist = await tx.user.findUnique({ where: { id: artistId }, select: { saasPlan: true } });
        if (artist?.saasPlan === SaasPlan.FREE) {
          const sponsor = await this.businessSponsor(artistId, data.venueSalonId || (data.userId !== artistId ? data.userId : undefined), publicBooking, tx);
          if (data.userId !== sponsor.id || (!publicBooking && actorId !== sponsor.id)) throw new ForbiddenException('Ce rendez-vous doit être géré par le salon Business choisi.');
        }
        const start = new Date(data.start as string);
        const end = new Date(data.end as string);
        const snapshot = await this.venueSnapshot(
          artistId,
          data.userId,
          data.venueSalonId || undefined,
          actorId,
          publicBooking,
          start,
          end,
          tx,
        );
        if (
          await this.conflict(tx, artistId, snapshot.venueSalonId, start, end)
        )
          throw new ConflictException(
            'Ce tatoueur est déjà occupé ou indisponible sur ce créneau.',
          );
        return tx.appointment.create({
          ...args,
          data: {
            ...args.data,
            ...snapshot,
          } as Prisma.AppointmentUncheckedCreateInput,
        });
      },
      { timeout: 20000 },
    );
  }

  async updateAppointment(
    args: Prisma.AppointmentUpdateArgs,
    actorId: string,
    venueSalonId?: string,
    clientBooking = false,
  ): Promise<any> {
    const existing = await this.prisma.appointment.findUniqueOrThrow({
      where: args.where,
    });
    if (clientBooking) {
      if (existing.clientUserId !== actorId) throw new ForbiddenException();
    } else await this.assertAppointmentAccess(existing.id, actorId, true);
    const update = args.data as Prisma.AppointmentUncheckedUpdateInput;
    if (!existing.performerUserId) {
      if (update.performerUserId)
        throw new BadRequestException(
          'Créez un nouveau rendez-vous pour changer de compte tatoueur.',
        );
      if (
        typeof update.tatoueurId === 'string' &&
        !(await this.prisma.tatoueur.findFirst({
          where: { id: update.tatoueurId, userId: existing.userId },
        }))
      )
        throw new ForbiddenException(
          'Ce tatoueur ne fait pas partie du salon.',
        );
      return this.prisma.appointment.update(args);
    }
    if (
      update.performerUserId !== undefined &&
      update.performerUserId !== existing.performerUserId
    )
      throw new BadRequestException(
        'Créez un nouveau rendez-vous pour changer de compte tatoueur.',
      );
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockArtist(tx, existing.performerUserId!);
        const current = await tx.appointment.findUniqueOrThrow({
          where: args.where,
        });
        if (current.performerUserId !== existing.performerUserId)
          throw new ConflictException(
            'Ce rendez-vous vient de changer. Rechargez-le.',
          );
        const start = new Date((update.start || current.start) as string);
        const end = new Date((update.end || current.end) as string);
        // Legacy appointments retain their historical location until explicitly moved.
        const snapshot =
          !venueSalonId && !current.venueSalonId
            ? { venueSalonId: null }
            : await this.venueSnapshot(
                current.performerUserId,
                current.userId,
                venueSalonId || current.venueSalonId || undefined,
                actorId,
                clientBooking,
                start,
                end,
                tx,
                true,
              );
        if (
          await this.conflict(
            tx,
            current.performerUserId!,
            snapshot.venueSalonId,
            start,
            end,
            current.id,
          )
        )
          throw new ConflictException(
            'Ce tatoueur est déjà occupé sur ce créneau.',
          );
        // Preserve the address on a simple time change; only an explicit venue change refreshes it.
        return tx.appointment.update({
          ...args,
          data: {
            ...args.data,
            ...(venueSalonId && venueSalonId !== current.venueSalonId
              ? snapshot
              : {}),
          } as Prisma.AppointmentUncheckedUpdateInput,
        });
      },
      { timeout: 20000 },
    );
  }
}
