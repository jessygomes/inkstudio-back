export type CachedUser = {
  id: string,
  saasPlan?: string,
  email: string,
  salonName?: string,
  firstName?: string,
  lastName?: string,
  phone?: string,
  address?: string,
  city?: string,
  postalCode?: string,
  salonHours?: string,
  instagram?: string,
  facebook?: string,
  tiktok?: string,
  website?: string,
  description?: string,
  image?: string,
  role?: string,
  prestations?: string[],
  style?: string[],
  projectAppointmentDurationMinutes?: number | null,
  projectAppointmentIsFree?: boolean,
  projectAppointmentPrice?: number | null,
  Tatoueur?: any, // You can further type this if needed
};

//! -------------------------------------------
//! TYPE POUR FONCTION getUserBySlugAndLocation ( user.services.ts)
//! -------------------------------------------
export type InternalTatoueur = {
  id: string,
  name: string,
  img: string | null,
  description: string | null,
  phone: string | null,
  hours: string | null,
  instagram: string | null,
  style: string[],
  skills: string[],
  rdvBookingEnabled: boolean,
  projectAppointmentDurationMinutes?: number | null,
  projectAppointmentIsFree?: boolean,
  projectAppointmentPrice?: number | null,
};

export type SlugUser = {
  id: string,
  role: string,
  salonName: string | null,
  city: string | null,
  postalCode: string | null,
  Tatoueur: InternalTatoueur[],
  [key: string]: unknown,
};

export type LinkedTatoueurUser = {
  id: string,
  salonName: string | null,
  city: string | null,
  postalCode: string | null,
  firstName: string | null,
  lastName: string | null,
  image: string | null,
  profileImage: string | null,
  phone: string | null,
  instagram: string | null,
  tiktok: string | null,
  website: string | null,
  description: string | null,
  style: string[],
  prestations: string[],
  appointmentBookingEnabled: boolean,
  projectAppointmentDurationMinutes?: number | null,
  projectAppointmentIsFree?: boolean,
  projectAppointmentPrice?: number | null,
};

export type LinkedSalon = {
  id: string,
  salonName: string | null,
  profileImage: string | null,
  address: string | null,
  city: string | null,
  postalCode: string | null,
  instagram: string | null,
  website: string | null,
  salonHours: string | null,
  prestations: string[],
  image: string | null,
  isCurrentSalon: boolean,
  linkedAt: Date | null,
};
