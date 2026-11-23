import { createHash } from 'crypto';
import { bookingHoursWindow } from '../../utils/booking-hours';
import { CONTACT_CHANNELS, ContactChannel, PROFILE_FIELDS, ProfileField, ProfileFacts } from './giveaway-criteria';

/** Champs du compte lus pour l'éligibilité (aucune donnée sensible au-delà du profil professionnel). */
export const eligibilityUserSelect = {
  id: true,
  role: true,
  email: true,
  emailVerified: true,
  publicVisibility: true,
  salonName: true,
  firstName: true,
  lastName: true,
  profileImage: true,
  image: true,
  city: true,
  address: true,
  postalCode: true,
  description: true,
  style: true,
  prestations: true,
  salonHours: true,
  salonPhotos: true,
  phone: true,
  instagram: true,
  website: true,
  facebook: true,
  tiktok: true,
} as const;

export type EligibilityUser = {
  id: string;
  role: string;
  email: string;
  emailVerified: Date | null;
  publicVisibility: 'VISIBLE' | 'SEARCH_HIDDEN' | 'HIDDEN';
  salonName: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImage: string | null;
  image: string | null;
  city: string | null;
  address: string | null;
  postalCode: string | null;
  description: string | null;
  style: string[];
  prestations: string[];
  salonHours: string | null;
  salonPhotos: string[];
  phone: string | null;
  instagram: string | null;
  website: string | null;
  facebook: string | null;
  tiktok: string | null;
};

const filled = (value: string | null | undefined, min = 1) =>
  typeof value === 'string' && value.trim().length >= min;

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Au moins un jour d'ouverture valide, au format utilisé par la réservation (`utils/booking-hours.ts`). */
export function hasOpeningHours(json: string | null): boolean {
  if (!json) return false;
  // Une date de référence par jour de la semaine (semaine du lundi 2 mars 2026, sans changement d'heure).
  return DAYS.some((_, i) => bookingHoursWindow(new Date(Date.UTC(2026, 2, 2 + i, 11)), json) !== null);
}

export function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function distinctNonEmpty(values: string[]): Set<string> {
  return new Set(values.map((v) => v.trim()).filter(Boolean));
}

export function profileFacts(user: EligibilityUser, portfolioImageUrls: string[]): ProfileFacts {
  const portfolio = distinctNonEmpty(portfolioImageUrls);
  const studio = distinctNonEmpty(user.salonPhotos ?? []);
  const union = new Set([...portfolio, ...studio]);
  const fields: Record<ProfileField, boolean> = {
    NAME: filled(user.salonName, 2),
    PROFILE_PHOTO: filled(user.profileImage),
    COVER_PHOTO: filled(user.image),
    CITY: filled(user.city),
    ADDRESS: filled(user.address, 3),
    POSTAL_CODE: filled(user.postalCode),
    DESCRIPTION: filled(user.description, 20),
    STYLE: (user.style ?? []).some((s) => filled(s)),
    HOURS: hasOpeningHours(user.salonHours),
    PRESTATIONS: (user.prestations ?? []).some((s) => filled(s)),
  };
  const contacts: Record<ContactChannel, boolean> = {
    PHONE: digitsOnly(user.phone).length >= 9,
    INSTAGRAM: filled(user.instagram, 2),
    WEBSITE: filled(user.website, 4),
    FACEBOOK: filled(user.facebook, 2),
    TIKTOK: filled(user.tiktok, 2),
  };
  // Garde-fou : la liste des clés suit exactement les listes blanches.
  if (Object.keys(fields).length !== PROFILE_FIELDS.length || Object.keys(contacts).length !== CONTACT_CHANNELS.length)
    throw new Error('Correspondance des champs incomplète.');
  return {
    role: user.role,
    emailVerified: !!user.emailVerified,
    publicVisibility: user.publicVisibility,
    publicRouteReady: filled(user.salonName) && filled(user.city) && filled(user.postalCode),
    fields,
    contacts,
    portfolioImages: portfolio.size,
    studioImages: studio.size,
    studioOrPortfolioImages: union.size,
  };
}

export function participantHash(userId: string): string {
  return createHash('sha256').update(`giveaway-participant:${userId}`).digest('hex');
}

const sha = (kind: string, value: string) =>
  createHash('sha256').update(`giveaway-signal:${kind}:${value}`).digest('hex');

/** Numéro français ramené à 9 chiffres significatifs (0612… et +33612… donnent la même valeur). */
export function normalizePhone(value: string | null | undefined): string | null {
  let d = digitsOnly(value);
  if (d.startsWith('0033')) d = d.slice(4);
  else if (d.startsWith('33') && d.length === 11) d = d.slice(2);
  if (d.startsWith('0') && d.length === 10) d = d.slice(1);
  return d.length >= 9 ? d : null;
}

export function normalizeHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?(instagram|facebook|tiktok)\.com\//, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '');
  return v.length >= 2 ? v : null;
}

export function normalizeWebsite(value: string | null | undefined): string | null {
  if (!value) return null;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
  // Les plateformes partagées ne sont pas des signaux d'identité.
  if (!host.includes('.') || /(instagram|facebook|tiktok|linktr\.ee|wixsite|theinkera)\./.test(host)) return null;
  return host;
}

export function normalizeName(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return v.length >= 3 ? v : null;
}

/**
 * Signaux d'identité, hachés. Un signal partagé entre deux participations
 * n'entraîne jamais de fusion ni de rejet automatique : la participation passe
 * en revue manuelle (deux salons distincts peuvent partager un site web, une
 * famille un téléphone…).
 */
export function identitySignals(user: Pick<EligibilityUser, 'phone' | 'instagram' | 'facebook' | 'tiktok' | 'website' | 'salonName' | 'postalCode'>): string[] {
  const out: string[] = [];
  const phone = normalizePhone(user.phone);
  if (phone) out.push(sha('phone', phone));
  for (const [kind, raw] of [
    ['instagram', user.instagram],
    ['facebook', user.facebook],
    ['tiktok', user.tiktok],
  ] as const) {
    const handle = normalizeHandle(raw);
    if (handle) out.push(sha(kind, handle));
  }
  const site = normalizeWebsite(user.website);
  if (site) out.push(sha('website', site));
  const name = normalizeName(user.salonName);
  const postal = digitsOnly(user.postalCode);
  if (name && postal.length === 5) out.push(sha('name-postal', `${name}:${postal}`));
  return [...new Set(out)].sort();
}
