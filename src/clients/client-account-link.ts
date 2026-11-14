import { Prisma, PrismaClient } from '@prisma/client';

export function sameClientEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? '').trim().toLowerCase();
  return left.length > 0 && left === (b ?? '').trim().toLowerCase();
}

/**
 * Relie une fiche du salon au compte client avec qui le salon est déjà en relation (conversation Inkera…),
 * uniquement si l'e-mail de la fiche est celui du compte et que le compte a vérifié son e-mail.
 * Ne remplace jamais une liaison existante. Renvoie `true` si la fiche est (désormais) liée à ce compte.
 */
export async function linkClientRecordIfSameEmail(
  db: Prisma.TransactionClient | PrismaClient,
  client: { id: string; userId: string; email: string | null; linkedUserId?: string | null },
  accountUserId: string,
): Promise<boolean> {
  if (client.linkedUserId) return client.linkedUserId === accountUserId;
  const account = await db.user.findUnique({
    where: { id: accountUserId },
    select: { role: true, email: true, emailVerified: true },
  });
  if (!account || account.role !== 'client' || !account.emailVerified) return false;
  if (!sameClientEmail(client.email, account.email)) return false;
  const { count } = await db.client.updateMany({
    where: { id: client.id, userId: client.userId, linkedUserId: null },
    data: { linkedUserId: accountUserId },
  });
  return count > 0;
}

/** Compare deux prénoms ou noms sans tenir compte de la casse, des accents, des espaces, tirets et apostrophes. */
export function normalizeClientName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s'’-]+/g, ' ')
    .trim();
}

export function sameClientName(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeClientName(a);
  return left.length > 0 && left === normalizeClientName(b);
}

type LinkableAccount = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  emailVerified: Date | null;
};

/**
 * Relie au compte client la fiche non liée du salon qui a la même adresse e-mail, le même prénom et le même nom.
 *
 * À appeler uniquement quand le titulaire du compte agit lui-même (réservation connectée) : l'e-mail vérifié du compte
 * est la preuve, le prénom et le nom évitent de rattacher la fiche d'une autre personne partageant l'adresse.
 * Renvoie la fiche reliée, ou `null` si aucune fiche ne correspond (rien n'est modifié).
 */
export async function claimMatchingClientRecord(
  tx: Prisma.TransactionClient,
  salonId: string,
  account: LinkableAccount,
) {
  const email = account.email?.trim();
  if (!account.emailVerified || !email) return null;

  const candidates = await tx.client.findMany({
    where: { userId: salonId, linkedUserId: null, email: { equals: email, mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, firstName: true, lastName: true },
  });
  const match = candidates.find(
    (c) => sameClientName(c.firstName, account.firstName) && sameClientName(c.lastName, account.lastName),
  );
  if (!match) return null;

  await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${match.id} FOR UPDATE`;
  // Ne relie que si la fiche n'a pas été reliée entre-temps à un autre compte.
  const { count } = await tx.client.updateMany({
    where: { id: match.id, userId: salonId, linkedUserId: null },
    data: { linkedUserId: account.id },
  });
  if (count === 0) return null;
  return tx.client.findFirst({ where: { id: match.id, userId: salonId } });
}
