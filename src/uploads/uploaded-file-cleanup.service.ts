import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { UploadStorage } from '../appointment-photos/upload-storage';
import { UploadQuotaService } from './upload-quota.service';
import { UploadsModule } from './uploads.module';

/** Clé UploadThing d'une URL (`…/f/<clé>`, ancien domaine `uploadthing.com/<clé>`). */
export function uploadKeyFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/f\/([^/?#]+)/) ?? url.match(/uploadthing\.com\/([^/?#]+)/);
  if (match?.[1]) return match[1];
  if (!/utfs\.io|ufs\.sh|uploadthing/.test(url)) return null; // pas un fichier UploadThing
  const last = url.split(/[?#]/)[0].split('/').pop();
  return last && !last.includes('.') ? last : null;
}

/**
 * Suppression des fichiers UploadThing qui ne servent plus.
 *
 * Un même fichier peut être utilisé à plusieurs endroits (visuel d'un flash recopié dans les photos d'un rendez-vous,
 * photo de rendez-vous ajoutée au portfolio…). Avant d'effacer, on vérifie donc dans toutes les colonnes qui stockent
 * des URL qu'aucune ligne n'y fait encore référence. À appeler APRÈS la suppression ou la modification en base.
 * Ne lève jamais d'erreur : un échec laisse simplement le fichier en place.
 */
@Injectable()
export class UploadedFileCleanupService {
  private readonly logger = new Logger(UploadedFileCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: UploadStorage,
    private readonly quota: UploadQuotaService,
  ) {}

  /** true si une ligne de la base référence encore ce fichier. */
  async isUsed(key: string): Promise<boolean> {
    const like = `%${key.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await this.prisma.$queryRaw<unknown[]>(Prisma.sql`
      SELECT 1 FROM "User" WHERE "image" LIKE ${like} OR "profileImage" LIKE ${like} OR array_to_string("salonPhotos", ' ') LIKE ${like}
      UNION ALL SELECT 1 FROM "Tatoueur" WHERE "img" LIKE ${like}
      UNION ALL SELECT 1 FROM "Portfolio" WHERE "imageUrl" LIKE ${like}
      UNION ALL SELECT 1 FROM "Flash" WHERE "imageUrl" LIKE ${like}
      UNION ALL SELECT 1 FROM "ProductSalon" WHERE "imageUrl" LIKE ${like}
      UNION ALL SELECT 1 FROM "AppointmentPhoto" WHERE "url" LIKE ${like}
      UNION ALL SELECT 1 FROM "TattooDetail" WHERE "reference" LIKE ${like} OR "sketch" LIKE ${like}
      UNION ALL SELECT 1 FROM "MoodboardImage" WHERE "url" LIKE ${like}
      UNION ALL SELECT 1 FROM "DrawingCardImage" WHERE "url" LIKE ${like}
      UNION ALL SELECT 1 FROM "MessageAttachment" WHERE "fileUrl" LIKE ${like}
      UNION ALL SELECT 1 FROM "ExternalAttachment" WHERE "fileUrl" LIKE ${like}
      UNION ALL SELECT 1 FROM "SalonReview" WHERE array_to_string("photos", ' ') LIKE ${like}
      UNION ALL SELECT 1 FROM "FollowUpSubmission" WHERE "photoUrl" LIKE ${like} OR array_to_string("photoUrls", ' ') LIKE ${like}
      UNION ALL SELECT 1 FROM "Client" WHERE "consentFileUrl" LIKE ${like}
      UNION ALL SELECT 1 FROM "TattooHistory" WHERE "photo" LIKE ${like}
      UNION ALL SELECT 1 FROM "Aftercare" WHERE "photoUrl" LIKE ${like}
      UNION ALL SELECT 1 FROM "Article" WHERE array_to_string("imageUrls", ' ') LIKE ${like}
      UNION ALL SELECT 1 FROM "SalonVerificationDocument" WHERE "fileUrl" LIKE ${like}
      LIMIT 1
    `);
    return rows.length > 0;
  }

  /**
   * Efface dans UploadThing les fichiers de ces URL qui ne sont plus utilisés nulle part, puis libère leur quota.
   * Les URL étrangères (autre hébergeur) et vides sont ignorées. Renvoie les clés effacées.
   */
  async deleteIfUnused(urls: (string | null | undefined)[]): Promise<string[]> {
    const keys = [...new Set(urls.map(uploadKeyFromUrl).filter((k): k is string => !!k))];
    if (!keys.length) return [];
    try {
      const unused: string[] = [];
      for (const key of keys) if (!(await this.isUsed(key))) unused.push(key);
      if (!unused.length) return [];
      if (!(await this.storage.delete(unused))) return [];
      // Le quota est enregistré au nom du site d'envoi (Studio « pro » ou People « public ») : on le libère dans les deux.
      for (const application of ['pro', 'public'] as const) {
        try {
          const deleted = this.quota.sign('deleted', { keys: unused }, application);
          await this.quota.deleted(deleted.body, deleted.signature);
        } catch (error) {
          this.logger.warn(`Libération du quota (${application}) impossible : ${error instanceof Error ? error.message : error}`);
        }
      }
      return unused;
    } catch (error) {
      this.logger.warn(`Nettoyage des fichiers impossible : ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }

  /** Comme deleteIfUnused, sans attendre (la réponse au client n'attend pas UploadThing). */
  deleteIfUnusedLater(urls: (string | null | undefined)[]): void {
    void this.deleteIfUnused(urls);
  }
}

@Global()
@Module({
  imports: [UploadsModule],
  providers: [UploadedFileCleanupService, UploadStorage, PrismaService],
  exports: [UploadedFileCleanupService],
})
export class UploadedFileCleanupModule {}
