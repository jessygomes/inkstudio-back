import type { Prisma } from '@prisma/client';

export const publicProfessionalRoles = [
  'user',
  'user_salon',
  'user_tatoueur',
] as const;

// Public profile fields only. Never share the private account selection/cache.
export const publicUserProfileSelect = {
  id: true,
  email: true,
  role: true,
  verifiedSalon: true,
  salonName: true,
  nickname: true,
  publicVisibility: true,
  description: true,
  image: true,
  profileImage: true,
  firstName: true,
  lastName: true,
  phone: true,
  address: true,
  city: true,
  postalCode: true,
  salonHours: true,
  prestations: true,
  style: true,
  appointmentBookingEnabled: true,
  projectAppointmentDurationMinutes: true,
  projectAppointmentIsFree: true,
  projectAppointmentPrice: true,
  addConfirmationEnabled: true,
  colorProfile: true,
  colorProfileBis: true,
  saasPlan: true,
  saasPlanDetails: {
    select: {
      currentPlan: true,
      agendaMode: true,
    },
  },
  Tatoueur: {
    select: {
      id: true,
      name: true,
      img: true,
      description: true,
      phone: true,
      hours: true,
      instagram: true,
      style: true,
      skills: true,
      rdvBookingEnabled: true,
    },
  },
  salonPhotos: true,
  instagram: true,
  facebook: true,
  tiktok: true,
  website: true,
  ProductSalon: {
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      imageUrl: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const satisfies Prisma.UserSelect;

function project(value: unknown, selection: Record<string, unknown>): unknown {
  if (value === null) return null;
  if (Array.isArray(value))
    return value.map((item) => project(item, selection));
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(selection)) {
    if (!Object.hasOwn(record, key)) continue;
    if (spec === true) result[key] = record[key];
    else if (spec && typeof spec === 'object' && 'select' in spec) {
      result[key] = project(
        record[key],
        (spec as { select: Record<string, unknown> }).select,
      );
    }
  }
  return result;
}

export function publicUserProfile(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    !publicProfessionalRoles.some((role) => role === record.role) ||
    record.publicVisibility === 'HIDDEN'
  )
    return null;
  return project(record, publicUserProfileSelect) as Record<string, unknown>;
}
