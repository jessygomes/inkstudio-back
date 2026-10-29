import type { Prisma } from '@prisma/client';

/** Continue a salon booking on the selected artist's profile, keeping its venue. */
export function linkedArtistBookingHref(
  artist: { salonName?: string | null; city?: string | null; postalCode?: string | null },
  salonId: string,
): string {
  const slug = (value: string) => value.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const location = [artist.city, artist.postalCode]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .join('-');
  return `/salon/${slug(artist.salonName || '')}/${slug(location) || 'localisation'}/reserver?venueSalonId=${encodeURIComponent(salonId)}`;
}

/** Minimum identity required by the public /salon/name/city-postcode route. */
export function publicProfessionalProfileWhere(
  search = true,
): Prisma.UserWhereInput {
  return {
    role: { in: ['user', 'user_salon', 'user_tatoueur'] },
    salonName: { not: null, notIn: [''] },
    city: { not: null, notIn: [''] },
    postalCode: { not: null, notIn: [''] },
    publicVisibility: search ? 'VISIBLE' : { not: 'HIDDEN' },
  };
}

export function publicDisplayName(user: {
  role?: string | null;
  nickname?: string | null;
  salonName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  return (
    (user.role === 'user_tatoueur' ? user.nickname?.trim() : '') ||
    user.salonName?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    'Tatoueur'
  );
}

export function withPublicName<
  T extends Parameters<typeof publicDisplayName>[0],
>(user: T) {
  return { ...user, displayName: publicDisplayName(user) };
}
