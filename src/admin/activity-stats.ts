import { BadRequestException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';

export interface ActivityQuery {
  year?: string;
  month?: string;
  role?: string;
  accountId?: string;
  status?: string;
}

// Month boundaries use Paris civil time, including daylight saving changes.
function parisMonthStart(year: number, month: number) {
  const utc = Date.UTC(year, month - 1, 1);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', timeZoneName: 'shortOffset',
  }).formatToParts(new Date(utc));
  const offset = parts.find((part) => part.type === 'timeZoneName')!.value;
  const hours = Number(offset.replace('GMT', ''));
  return new Date(utc - hours * 60 * 60 * 1000);
}

export function activityDateRange(query: ActivityQuery): Prisma.DateTimeFilter | undefined {
  if (query.year && (!/^\d{4}$/.test(query.year) || +query.year < 2000 || +query.year > 9998)) {
    throw new BadRequestException('Année invalide (2000 à 9998).');
  }
  if (query.month && (!/^\d{1,2}$/.test(query.month) || +query.month < 1 || +query.month > 12 || !query.year)) {
    throw new BadRequestException('Sélectionnez une année et un mois valide.');
  }
  if (!query.year) return undefined;
  const year = +query.year;
  const month = query.month ? +query.month : 1;
  const nextMonth = query.month ? month + 1 : 1;
  return {
    gte: parisMonthStart(year, month),
    lt: parisMonthStart(query.month && month < 12 ? year : year + 1, nextMonth === 13 ? 1 : nextMonth),
  };
}

export async function getActivityStats(prisma: PrismaService, query: ActivityQuery) {
  const dateRange = activityDateRange(query);
  if (query.role && !['user_salon', 'user_tatoueur'].includes(query.role)) throw new BadRequestException('Type de compte invalide.');
  if (query.status && !['PRIVATE', 'OPEN', 'MATCHED', 'CLOSED'].includes(query.status)) throw new BadRequestException('Statut invalide.');
  if (query.accountId && (typeof query.accountId !== 'string' || query.accountId.length > 100)) throw new BadRequestException('Compte invalide.');
  const roles: Role[] = query.role === 'user_tatoueur' ? [Role.user_tatoueur]
    : query.role === 'user_salon' ? [Role.user, Role.user_salon]
    : [Role.user, Role.user_salon, Role.user_tatoueur];
  const accountWhere: Prisma.UserWhereInput = { role: { in: roles }, ...(query.accountId && { id: query.accountId }) };
  const professionalWhere = { user: { is: accountWhere }, ...(dateRange && { createdAt: dateRange }) };
  const sharedWhere: Prisma.MoodboardWhereInput = { publishedAt: dateRange ?? { not: null } };
  const groupedStatuses = prisma.moodboard.groupBy({
    by: ['projectStatus'], where: sharedWhere, _count: { _all: true }, orderBy: { projectStatus: 'asc' },
  });
  const [appointments, clientRecords, moodboards, sharedMoodboards, filteredAppointments, filteredClients, filteredMoodboards, statuses] = await prisma.$transaction([
    prisma.appointment.count(),
    prisma.client.count(),
    prisma.moodboard.count(),
    prisma.moodboard.count({ where: { publishedAt: { not: null } } }),
    prisma.appointment.count({ where: professionalWhere }),
    prisma.client.count({ where: professionalWhere }),
    prisma.moodboard.count({ where: dateRange ? { createdAt: dateRange } : {} }),
    groupedStatuses,
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  const sharedByStatus = statuses.map((row) => ({ status: row.projectStatus, count: row._count._all }));
  return {
    totals: { appointments, clientRecords, moodboards, sharedMoodboards },
    filtered: {
      appointments: filteredAppointments, clientRecords: filteredClients, moodboards: filteredMoodboards,
      sharedMoodboards: sharedByStatus.filter((row) => !query.status || row.status === query.status).reduce((sum, row) => sum + row.count, 0),
    },
    sharedByStatus,
  };
}
