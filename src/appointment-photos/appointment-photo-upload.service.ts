import { BadRequestException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { UploadQuotaService } from 'src/uploads/upload-quota.service';
import { AppointmentPhotosService } from './appointment-photos.service';
import { StoredFile, UploadStorage } from './upload-storage';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTOS_PER_UPLOAD = 5;

export type Kind = 'jpeg' | 'png' | 'webp' | 'gif' | 'heif' | 'avif';
const MIME: Record<Kind, { type: string; ext: string }> = {
  jpeg: { type: 'image/jpeg', ext: 'jpg' },
  png: { type: 'image/png', ext: 'png' },
  webp: { type: 'image/webp', ext: 'webp' },
  gif: { type: 'image/gif', ext: 'gif' },
  heif: { type: 'image/heic', ext: 'heic' },
  avif: { type: 'image/avif', ext: 'avif' },
};

/** Détecte le vrai format d'après les premiers octets : on ne fait jamais confiance au type annoncé par le client. */
export function detectImageKind(buffer: Buffer): Kind | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heif';
  }
  return null;
}

/** Clé UploadThing d'une URL de fichier (/f/<clé>), comme lib/utils/uploadImg/extractKeyFromUrl du site. */
export function keyFromUrl(url: string): string | null {
  const match = url.match(/\/f\/([^/?]+)/) ?? url.match(/uploadthing\.com\/([^/?]+)/);
  if (match?.[1]) return match[1];
  const last = url.split('/').pop();
  return last && !last.includes('.') ? last : null;
}

export type UploadedPart ={ buffer: Buffer; size: number };
export type StoredImage = StoredFile & { type: string; name: string };

/**
 * Envoi de photos de rendez-vous depuis l'app mobile (multipart) : réutilise le quota d'envoi existant
 * (UploadQuotaService prepare / complete / deleted), stocke chez UploadThing, puis enregistre les photos du RDV.
 */
@Injectable()
export class AppointmentPhotoUploadService {
  private readonly logger = new Logger(AppointmentPhotoUploadService.name);

  constructor(
    private readonly photos: AppointmentPhotosService,
    private readonly quota: UploadQuotaService,
    private readonly storage: UploadStorage,
  ) {}

  /** Photos d'un RDV : vérifie l'accès au RDV, stocke les images puis les enregistre sur le RDV. */
  async upload(appointmentId: string, userId: string, files: UploadedPart[], authorization?: string) {
    await this.photos.authorize(appointmentId, userId);
    const images = await this.storeImages(userId, files, authorization);
    try {
      return await this.photos.add(appointmentId, userId, { photos: images.map((image) => ({ url: image.url })) });
    } catch (error) {
      await this.discard(images);
      throw error;
    }
  }

  /**
   * Valide les images (type réel, 8 Mo, 5 max), réserve le quota, les envoie à UploadThing puis confirme le quota.
   * N'enregistre rien en base : l'appelant (photos de RDV, pièces jointes de messages…) le fait ensuite et appelle
   * `discard` si cette étape échoue. `kinds` restreint les formats acceptés.
   */
  async storeImages(userId: string, files: UploadedPart[], authorization?: string, kinds?: Kind[]): Promise<StoredImage[]> {
    if (!files?.length) throw new BadRequestException('Aucune photo reçue.');
    if (files.length > MAX_PHOTOS_PER_UPLOAD) throw new BadRequestException(`${MAX_PHOTOS_PER_UPLOAD} photos maximum par envoi.`);
    const checked = files.map((file) => {
      const kind = detectImageKind(file.buffer);
      if (!kind || file.size < 1 || file.size > MAX_PHOTO_BYTES) throw new BadRequestException('Image invalide ou trop lourde (8 Mo maximum).');
      if (kinds && !kinds.includes(kind)) throw new BadRequestException('Format non pris en charge (JPG, PNG, WebP ou GIF).');
      return { buffer: file.buffer, size: file.size, ...MIME[kind] };
    });

    // 1. Réservation de quota (mêmes règles que sur le site : comptes pro uniquement, plafonds par jour et au total).
    const prepare = this.quota.sign('prepare', { route: 'imageUploader', files: checked.map(({ size, type }) => ({ size, type })) });
    const reserved = (await this.quota.prepare(prepare.body, prepare.signature, authorization)) as { reservations: string[]; ownerUserId: string | null };
    if (reserved.ownerUserId !== userId) throw new UnauthorizedException('Invalid upload credentials');
    if (reserved.reservations.length !== checked.length) throw new ServiceUnavailableException('Réservation d’envoi incohérente.');

    // 2. Envoi puis confirmation du quota. En cas d'échec, on retire ce qui a été envoyé.
    let stored: (StoredFile | null)[] = [];
    try {
      stored = await this.storage.upload(
        checked.map((file, i) => ({ buffer: file.buffer, name: `photo-${i + 1}.${file.ext}`, type: file.type, customId: reserved.reservations[i] })),
      );
      if (stored.some((s) => !s)) throw new ServiceUnavailableException("L'envoi des photos a échoué.");
      const done = stored as StoredFile[];
      for (let i = 0; i < done.length; i++) {
        const complete = this.quota.sign('complete', { id: reserved.reservations[i], key: done[i].key, size: done[i].size });
        await this.quota.complete(complete.body, complete.signature);
      }
      return done.map((s, i) => ({ ...s, type: checked[i].type, name: `photo-${i + 1}.${checked[i].ext}` }));
    } catch (error) {
      await this.cleanup(stored.filter((s): s is StoredFile => !!s));
      throw error;
    }
  }

  /** Retire des images déjà stockées (échec de l'enregistrement qui suit). */
  async discard(images: StoredFile[]) {
    await this.cleanup(images);
  }

  /** Supprime des fichiers déjà enregistrés d'après leur URL UploadThing (même extraction de clé que le site). Ne lève jamais. */
  async deleteByUrls(urls: string[]) {
    const keys = urls.map(keyFromUrl).filter((k): k is string => !!k);
    await this.cleanup(keys.map((key) => ({ key }) as StoredFile));
  }

  // Ne libère le quota qu'après suppression physique confirmée (comme finishUpload côté web).
  private async cleanup(files: StoredFile[]) {
    if (!files.length) return;
    try {
      const keys = files.map((f) => f.key);
      if (await this.storage.delete(keys)) {
        const deleted = this.quota.sign('deleted', { keys });
        await this.quota.deleted(deleted.body, deleted.signature);
      }
    } catch (error) {
      this.logger.warn(`Nettoyage des photos envoyées impossible : ${error instanceof Error ? error.message : error}`);
    }
  }
}
