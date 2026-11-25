import type { PrismaService } from '../database/prisma.service';

export type KnownClientRecord = { id: string; firstName: string; lastName: string; email: string; linkedUserId: string | null };

/**
 * Fiches du professionnel qui correspondent déjà à des comptes clients Inkera : fiche reliée au compte, sinon fiche non
 * reliée portant l'e-mail (vérifié) du compte. Le professionnel connaît déjà ces clients : il n'y a rien à lui masquer.
 * Même règle que partout ailleurs : une fiche ne correspond à un compte que par le même e-mail.
 */
export async function findKnownClientRecords(
  prisma: PrismaService,
  professionalId: string,
  clientUserIds: string[],
): Promise<Map<string, KnownClientRecord>> {
  const ids = [...new Set(clientUserIds)];
  const known = new Map<string, KnownClientRecord>();
  if (!ids.length) return known;
  const select = { id: true, firstName: true, lastName: true, email: true, linkedUserId: true } as const;

  const linked = await prisma.client.findMany({
    where: { userId: professionalId, linkedUserId: { in: ids } },
    orderBy: { createdAt: 'asc' },
    select,
  });
  for (const record of linked) if (record.linkedUserId && !known.has(record.linkedUserId)) known.set(record.linkedUserId, record);

  const missing = ids.filter((id) => !known.has(id));
  if (!missing.length) return known;
  const accounts = await prisma.user.findMany({
    where: { id: { in: missing }, role: 'client', emailVerified: { not: null } },
    select: { id: true, email: true },
  });
  if (!accounts.length) return known;
  const byEmail = await prisma.client.findMany({
    where: {
      userId: professionalId,
      linkedUserId: null,
      OR: accounts.map((a) => ({ email: { equals: a.email.trim(), mode: 'insensitive' as const } })),
    },
    orderBy: { createdAt: 'asc' },
    select,
  });
  for (const account of accounts) {
    const record = byEmail.find((r) => r.email.trim().toLowerCase() === account.email.trim().toLowerCase());
    if (record) known.set(account.id, record);
  }
  return known;
}
