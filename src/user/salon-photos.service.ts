import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AppointmentPhotoUploadService, UploadedPart, keyFromUrl } from '../appointment-photos/appointment-photo-upload.service';
import { UserService } from './user.service';

export const MAX_SALON_PHOTOS = 6;

/**
 * Galerie du salon depuis l'app mobile : envoi direct (multipart) et suppression d'une photo.
 * Le web passe par UploadThing côté navigateur puis `PATCH /users/:id/photos` ; ici le backend fait l'envoi lui-même
 * (même quota d'envoi) puis enregistre la liste complète via `addOrUpdatePhotoSalon`.
 */
@Injectable()
export class SalonPhotosService {
  constructor(
    private readonly users: UserService,
    private readonly uploads: AppointmentPhotoUploadService,
    private readonly prisma: PrismaService,
  ) {}

  private async current(userId: string): Promise<string[]> {
    const res = await this.users.getPhotosSalon({ userId });
    return Array.isArray(res?.salonPhotos) ? (res.salonPhotos as string[]) : [];
  }

  async add(userId: string, files: UploadedPart[], authorization?: string) {
    const existing = await this.current(userId);
    if (existing.length >= MAX_SALON_PHOTOS) {
      throw new BadRequestException(`La galerie est pleine (${MAX_SALON_PHOTOS} photos maximum).`);
    }
    if (files.length > MAX_SALON_PHOTOS - existing.length) {
      throw new BadRequestException(`Il reste ${MAX_SALON_PHOTOS - existing.length} place(s) dans la galerie.`);
    }
    const images = await this.uploads.storeImages(userId, files, authorization, ['jpeg', 'png', 'webp', 'gif']);
    try {
      await this.users.addOrUpdatePhotoSalon({ userId, requesterUserId: userId, salonPhotos: [...existing, ...images.map((i) => i.url)] });
    } catch (error) {
      await this.uploads.discard(images);
      throw error;
    }
    return { salonPhotos: await this.current(userId) };
  }

  /**
   * Envoie une seule image (photo de profil, couverture, photo d'un tatoueur) et renvoie son URL, sans rien enregistrer :
   * l'appelant l'enregistre ensuite (PATCH /users, /tatoueurs…) ou la supprime avec deleteImage si l'enregistrement échoue.
   */
  async uploadImage(userId: string, file: UploadedPart | undefined, authorization?: string) {
    if (!file) throw new BadRequestException('Aucune image reçue.');
    const [image] = await this.uploads.storeImages(userId, [file], authorization, ['jpeg', 'png', 'webp', 'gif']);
    return { url: image.url };
  }

  /**
   * Supprime une image envoyée par l'utilisateur et qui n'est plus utilisée (ancienne photo remplacée, envoi abandonné).
   * Refuse un fichier qui ne lui appartient pas ou qui est encore affiché sur son profil, sa galerie ou un de ses tatoueurs.
   */
  async deleteImage(userId: string, url: string) {
    const key = keyFromUrl(url);
    if (!key) throw new BadRequestException('Image invalide.');
    const owned = await this.prisma.uploadReservation.findFirst({ where: { ownerUserId: userId, key, status: { not: 'DELETED' } }, select: { id: true } });
    if (!owned) throw new ForbiddenException('Cette image ne vous appartient pas.');
    const [user, tatoueurs] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { image: true, profileImage: true, salonPhotos: true } }),
      this.prisma.tatoueur.findMany({ where: { userId }, select: { img: true } }),
    ]);
    const used = [user?.image, user?.profileImage, ...((user?.salonPhotos as string[] | undefined) ?? []), ...tatoueurs.map((t) => t.img)];
    if (used.some((u) => u && keyFromUrl(u) === key)) throw new BadRequestException('Cette image est encore utilisée.');
    await this.uploads.deleteByUrls([url]);
    return { ok: true };
  }

  async remove(userId: string, url: string) {
    const existing = await this.current(userId);
    if (!existing.includes(url)) throw new BadRequestException('Photo introuvable dans la galerie.');
    await this.users.addOrUpdatePhotoSalon({ userId, requesterUserId: userId, salonPhotos: existing.filter((u) => u !== url) });
    // Libère le fichier et le quota (comme la suppression du site) ; sans effet bloquant si UploadThing échoue.
    await this.uploads.deleteByUrls([url]);
    return { salonPhotos: await this.current(userId) };
  }
}
