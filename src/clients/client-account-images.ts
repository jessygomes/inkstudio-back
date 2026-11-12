import { PrismaService } from 'src/database/prisma.service';

const CHUNK = 50;

/**
 * Photos de profil des comptes Inkera People (rôle client) correspondant à des e-mails, en une requête par lot de 50.
 * Clé de la table retournée : l'e-mail en minuscules. Les e-mails sans compte ou sans photo n'y figurent pas.
 * Sert à afficher l'avatar d'une fiche client non liée sans que le site cherche la photo fiche par fiche.
 */
export async function findAccountImagesByEmail(prisma: Pick<PrismaService, 'user'>, emails: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(emails.map((email) => email?.trim().toLowerCase() ?? '').filter(Boolean))];
  const byEmail = new Map<string, string>();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const accounts = await prisma.user.findMany({
      where: { role: 'client', image: { not: null }, OR: batch.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })) },
      select: { email: true, image: true },
    });
    for (const account of accounts ?? []) {
      if (account.email && account.image?.trim()) byEmail.set(account.email.toLowerCase(), account.image);
    }
  }
  return byEmail;
}
