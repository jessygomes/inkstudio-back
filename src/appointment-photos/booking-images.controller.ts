import { BadRequestException, Body, Controller, Post, ForbiddenException, ServiceUnavailableException, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SecurityThrottle } from 'src/auth/security-throttle';
import { AppointmentPhotoUploadService, MAX_PHOTO_BYTES } from './appointment-photo-upload.service';
import { issueGuestUploadToken, verifyGuestUploadToken } from './guest-upload-token';

/** Images d'inspiration jointes à une réservation : une image de référence et un croquis au plus (comme le site People). */
export const MAX_BOOKING_IMAGES = 2;
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Envoi des images d'inspiration d'une réservation depuis l'app People, **sans compte** (multipart, champ « images »,
 * corps `salonId` et `guestToken`). Même contrat que l'UploadThing du site People pour un invité : la réservation de quota
 * est rattachée au salon réservé (le salon doit accepter la réservation en ligne) et au visiteur, puis reprise par
 * `attachGuestUploads` à la création du rendez-vous (POST /appointments/by-client). Le visiteur est identifié par un jeton
 * signé délivré par POST /client-booking-images/guest (30 min), comme le cookie signé du site : l'app ne choisit pas
 * son identifiant.
 * Un client connecté passe, lui, par POST /users/:id/images/upload (images à son nom).
 * Route : POST /client-booking-images/upload → { urls }
 */
@Controller('client-booking-images')
export class BookingImagesController {
  constructor(private readonly uploads: AppointmentPhotoUploadService) {}

  /** Jeton de visiteur signé, valable 30 minutes (l'app en redemande un quand il expire). */
  @Post('guest')
  @SecurityThrottle('upload')
  guest() {
    const token = issueGuestUploadToken();
    if (!token) throw new ServiceUnavailableException('Envoi d’images indisponible.');
    return token;
  }

  @Post('upload')
  @SecurityThrottle('upload')
  @UseInterceptors(FilesInterceptor('images', MAX_BOOKING_IMAGES, { storage: memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_BOOKING_IMAGES } }))
  async upload(@Body() body: { salonId?: string; guestToken?: string }, @UploadedFiles() files: Express.Multer.File[]) {
    const salonId = String(body?.salonId ?? '');
    if (!IDENTIFIER.test(salonId)) throw new BadRequestException('Réservation invalide.');
    const guestId = verifyGuestUploadToken(body?.guestToken);
    // Code GUEST_TOKEN_INVALID : l'app redemande un jeton puis réessaie.
    if (!guestId) throw new ForbiddenException({ message: 'Session d’envoi expirée. Réessayez.', code: 'GUEST_TOKEN_INVALID' });
    const images = await this.uploads.storeBookingGuestImages(salonId, guestId, files ?? [], MAX_BOOKING_IMAGES);
    return { urls: images.map((image) => image.url) };
  }
}
