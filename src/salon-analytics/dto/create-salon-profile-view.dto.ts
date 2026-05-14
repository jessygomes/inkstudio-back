export class CreateSalonProfileViewDto {
  salonId: string;
  ipHash?: string; // Hash de l'IP (SHA-256 ou similaire)
  referrer?: string; // Source du trafic
  userAgent?: string; // User-Agent du navigateur
  deviceType?: string; // DESKTOP, MOBILE, TABLET
  country?: string; // Pays détecté
  city?: string; // Ville détectée
}
