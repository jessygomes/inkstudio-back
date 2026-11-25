import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Pseudo d'un compte client (Inkera People) : obligatoire à l'inscription et unique sur toute la plateforme,
 * sans tenir compte des majuscules (« InkFan » et « inkfan » sont le même pseudo). C'est le nom affiché aux
 * professionnels tant que le client ne leur a pas partagé ses informations.
 *
 * Règles (mêmes messages sur le site et l'app People) : 3 à 30 caractères, lettres (accents compris), chiffres,
 * « _ », « . » et « - », sans espace.
 */
export const PSEUDO_MIN = 3;
export const PSEUDO_MAX = 30;
const PSEUDO_PATTERN = /^[\p{L}\p{N}_.-]+$/u;

type Db = Prisma.TransactionClient | PrismaClient;

export function normalizePseudo(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFC').trim() : '';
}

/** Message d'erreur si le format est invalide, sinon null. */
export function pseudoFormatError(pseudo: string): string | null {
  if (!pseudo) return 'Choisissez un pseudo.';
  if (pseudo.length < PSEUDO_MIN) return `Le pseudo doit contenir au moins ${PSEUDO_MIN} caractères.`;
  if (pseudo.length > PSEUDO_MAX) return `Le pseudo ne peut pas dépasser ${PSEUDO_MAX} caractères.`;
  if (!PSEUDO_PATTERN.test(pseudo)) return 'Lettres, chiffres, « _ », « . » et « - » seulement, sans espace.';
  return null;
}

/** true si un autre compte utilise déjà ce pseudo (majuscules ignorées). */
export async function isPseudoTaken(db: Db, pseudo: string, exceptUserId?: string): Promise<boolean> {
  const found = await db.clientProfile.findFirst({
    where: {
      pseudo: { equals: pseudo, mode: 'insensitive' },
      ...(exceptUserId ? { userId: { not: exceptUserId } } : {}),
    },
    select: { id: true },
  });
  return !!found;
}

/** Disponibilité affichée en direct pendant la saisie. */
export async function checkPseudo(db: Db, value: unknown, exceptUserId?: string) {
  const pseudo = normalizePseudo(value);
  const formatError = pseudoFormatError(pseudo);
  if (formatError) return { available: false, code: 'PSEUDO_INVALID' as const, message: formatError };
  if (await isPseudoTaken(db, pseudo, exceptUserId)) {
    return { available: false, code: 'PSEUDO_TAKEN' as const, message: 'Ce pseudo est déjà utilisé. Choisissez-en un autre.' };
  }
  return { available: true as const };
}

/** Valide le pseudo à l'enregistrement (inscription, modification du profil) et le renvoie normalisé. */
export async function assertPseudoAvailable(db: Db, value: unknown, exceptUserId?: string): Promise<string> {
  const pseudo = normalizePseudo(value);
  const formatError = pseudoFormatError(pseudo);
  if (formatError) throw new BadRequestException({ code: 'PSEUDO_INVALID', message: formatError });
  if (await isPseudoTaken(db, pseudo, exceptUserId)) {
    throw new ConflictException({ code: 'PSEUDO_TAKEN', message: 'Ce pseudo est déjà utilisé. Choisissez-en un autre.' });
  }
  return pseudo;
}

/**
 * Pseudo libre proposé automatiquement (connexion Google / Apple, qui n'a pas de formulaire d'inscription) :
 * à partir du prénom, puis un nombre. Le client peut le changer ensuite dans son profil.
 */
export async function generateUniquePseudo(db: Db, base: string | null | undefined): Promise<string> {
  const cleaned = (base ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_.-]/g, '')
    .slice(0, 20)
    .toLowerCase();
  const stem = cleaned.length >= PSEUDO_MIN ? cleaned : `client${cleaned}`;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `${stem}${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await isPseudoTaken(db, candidate))) return candidate;
  }
  return `${stem}${Date.now().toString(36)}`.slice(0, PSEUDO_MAX);
}

/** Violation de l'index d'unicité du pseudo (inscriptions simultanées). */
export function isPseudoUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: unknown }; message?: string } | null;
  if (!e) return false;
  if (e.code === 'P2002') return JSON.stringify(e.meta?.target ?? '').includes('pseudo');
  return typeof e.message === 'string' && e.message.includes('ClientProfile_pseudo_lower_key');
}
