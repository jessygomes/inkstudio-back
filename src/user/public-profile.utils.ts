import type { Prisma } from '@prisma/client';

/** Minimum identity required by the public /salon/name/city-postcode route. */
export function publicProfessionalProfileWhere(): Prisma.UserWhereInput {
  return {
    role: { in: ['user', 'user_salon', 'user_tatoueur'] },
    salonName: { not: null, notIn: [''] },
    city: { not: null, notIn: [''] },
    postalCode: { not: null, notIn: [''] },
  };
}