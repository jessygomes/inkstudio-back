import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AgendaMode, Prisma, SaasPlan, SaasPlanStatus } from '@prisma/client';
import { bookingHoursWindow } from '../../utils/booking-hours';

export async function lockInternalCalendar(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  // All internal artists share the salon lock, including unassigned/global bookings.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

export async function validateInternalBooking(
  tx: Prisma.TransactionClient,
  data: {
    userId: string;
    tatoueurId?: string | null;
    start: Date | string;
    end: Date | string;
    prestation?: string;
  },
  publicBooking: boolean,
  excludedAppointmentId?: string,
) {
  const start = new Date(data.start);
  const end = new Date(data.end);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  )
    throw new BadRequestException('Les dates du rendez-vous sont invalides.');
  await lockInternalCalendar(tx, data.userId);
  await tx.$queryRaw`SELECT id FROM "SaasPlanDetails" WHERE "userId" = ${data.userId} FOR UPDATE`;
  if (data.tatoueurId)
    await tx.$queryRaw`SELECT id FROM "Tatoueur" WHERE id = ${data.tatoueurId} AND "userId" = ${data.userId} FOR UPDATE`;
  const salon = await tx.user.findUnique({
    where: { id: data.userId },
    select: {
      role: true,
      publicVisibility: true,
      salonHours: true,
      prestations: true,
      saasPlan: true,
      saasPlanUntil: true,
      saasPlanDetails: {
        select: {
          agendaMode: true,
          currentPlan: true,
          planStatus: true,
          endDate: true,
          trialEndDate: true,
        },
      },
    },
  });
  if (!salon) throw new ForbiddenException('Salon indisponible.');
  const artist = data.tatoueurId
    ? await tx.tatoueur.findFirst({
        where: { id: data.tatoueurId, userId: data.userId },
        select: { id: true, hours: true, rdvBookingEnabled: true },
      })
    : null;
  if (data.tatoueurId && !artist)
    throw new ForbiddenException('Ce tatoueur ne fait pas partie du salon.');
  const perArtist =
    salon.role === 'user_salon' ||
    (salon.role !== 'user_tatoueur' &&
      salon.saasPlanDetails?.agendaMode === AgendaMode.PAR_TATOUEUR);
  if (publicBooking) {
    const details = salon.saasPlanDetails;
    const expired = [
      salon.saasPlanUntil,
      details?.endDate,
      ...(details?.planStatus === SaasPlanStatus.TRIAL
        ? [details.trialEndDate]
        : []),
    ].some((date) => date && date.getTime() <= Date.now());
    if (
      !['user', 'user_salon', 'user_tatoueur'].includes(salon.role) ||
      salon.publicVisibility === 'HIDDEN' ||
      salon.saasPlan === SaasPlan.FREE ||
      details?.currentPlan === SaasPlan.FREE ||
      details?.planStatus === SaasPlanStatus.EXPIRED ||
      expired
    )
      throw new ForbiddenException(
        'Ce profil ne peut plus recevoir de réservation publique.',
      );
    if (perArtist && !artist)
      throw new ForbiddenException('Choisissez un tatoueur du salon.');
    if (artist && !artist.rdvBookingEnabled)
      throw new ForbiddenException(
        'Ce tatoueur ne reçoit pas de réservation publique.',
      );
    if (data.prestation && !salon.prestations.includes(data.prestation))
      throw new ForbiddenException(
        'Cette prestation n’est pas proposée sur ce profil.',
      );
    const window = bookingHoursWindow(
      start,
      artist ? artist.hours : salon.salonHours,
    );
    if (
      start.getTime() <= Date.now() ||
      !window ||
      start < window.start ||
      end > window.end
    )
      throw new ForbiddenException(
        'Ce rendez-vous est en dehors des horaires disponibles.',
      );
  }
  const scoped = perArtist && data.tatoueurId;
  const blocked = await tx.blockedTimeSlot.findFirst({
    where: {
      userId: data.userId,
      startDate: { lt: end },
      endDate: { gt: start },
      ...(scoped
        ? { OR: [{ tatoueurId: null }, { tatoueurId: data.tatoueurId }] }
        : {}),
    },
    select: { id: true },
  });
  if (blocked) throw new ConflictException('Ce créneau est bloqué.');
  const occupied = await tx.appointment.findFirst({
    where: {
      userId: data.userId,
      status: { in: ['PENDING', 'CONFIRMED'] },
      start: { lt: end },
      end: { gt: start },
      ...(excludedAppointmentId ? { id: { not: excludedAppointmentId } } : {}),
      ...(scoped
        ? {
            OR: [
              { tatoueurId: data.tatoueurId },
              { tatoueurId: null, performerUserId: null },
            ],
          }
        : {}),
    },
    select: { id: true },
  });
  if (occupied)
    throw new ConflictException('Ce créneau horaire est déjà réservé.');
}

export async function updateInternalBooking(
  tx: Prisma.TransactionClient,
  args: Prisma.AppointmentUpdateArgs,
  ownerId: string,
  actorId: string,
  clientBooking: boolean,
) {
  await lockInternalCalendar(tx, ownerId);
  await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${args.where.id} FOR UPDATE`;
  const current = await tx.appointment.findUniqueOrThrow({ where: args.where });
  if (current.userId !== ownerId || current.performerUserId)
    throw new ConflictException('Le rendez-vous a changé. Rechargez-le.');
  if (
    clientBooking
      ? current.clientUserId !== actorId
      : current.userId !== actorId
  )
    throw new ForbiddenException();
  if (clientBooking && !['PENDING', 'CONFIRMED'].includes(current.status))
    throw new ForbiddenException('Ce rendez-vous ne peut plus être déplacé.');
  const update = args.data as Prisma.AppointmentUncheckedUpdateInput;
  if (update.performerUserId)
    throw new BadRequestException(
      'Créez un nouveau rendez-vous pour changer de compte tatoueur.',
    );
  const artistId =
    update.tatoueurId === undefined ? current.tatoueurId : update.tatoueurId;
  const start = (update.start ?? current.start) as Date | string;
  const end = (update.end ?? current.end) as Date | string;
  const status = update.status ?? current.status;
  if (status === 'PENDING' || status === 'CONFIRMED') {
    await validateInternalBooking(
      tx,
      {
        userId: ownerId,
        tatoueurId: artistId as string | null,
        start,
        end,
        prestation: (update.prestation ?? current.prestation) as string,
      },
      clientBooking,
      current.id,
    );
  } else if (
    typeof artistId === 'string' &&
    !(await tx.tatoueur.findFirst({
      where: { id: artistId, userId: ownerId },
      select: { id: true },
    }))
  ) {
    throw new ForbiddenException('Ce tatoueur ne fait pas partie du salon.');
  }
  return tx.appointment.update(args);
}
