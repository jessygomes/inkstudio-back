import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { UTApi, UTFile } from 'uploadthing/server';

export type StoredFile = { key: string; url: string; size: number };
export type FileToStore = { buffer: Buffer; name: string; type: string; customId: string };

/**
 * Envoi / suppression de fichiers vers UploadThing depuis le backend (le frontend web passe, lui, par sa route Next).
 * Isolé dans une classe à part pour pouvoir être remplacé dans les tests.
 */
@Injectable()
export class UploadStorage {
  private readonly logger = new Logger(UploadStorage.name);
  private api?: UTApi;

  private get client(): UTApi {
    const token = process.env.UPLOADTHING_TOKEN;
    if (!token) {
      this.logger.error('UPLOADTHING_TOKEN manquant : envoi de photos indisponible.');
      throw new ServiceUnavailableException("Le stockage des images n'est pas configuré.");
    }
    return (this.api ??= new UTApi({ token }));
  }

  /** Un élément `null` = ce fichier n'a pas pu être envoyé (les autres peuvent l'avoir été). */
  async upload(files: FileToStore[]): Promise<(StoredFile | null)[]> {
    const results = await this.client.uploadFiles(
      files.map((f) => new UTFile([new Uint8Array(f.buffer)], f.name, { type: f.type, customId: f.customId })),
    );
    return results.map((r) => {
      if (r.error || !r.data) {
        this.logger.warn(`Échec d'envoi UploadThing : ${r.error?.message ?? 'réponse vide'}`);
        return null;
      }
      return { key: r.data.key, url: r.data.ufsUrl, size: r.data.size };
    });
  }

  /** Renvoie true seulement si UploadThing confirme la suppression physique. */
  async delete(keys: string[]): Promise<boolean> {
    try {
      return (await this.client.deleteFiles(keys)).success;
    } catch (error) {
      this.logger.warn(`Suppression UploadThing impossible : ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }
}
