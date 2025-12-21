/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Injectable, Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';

@Injectable()
export class CacheService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  /**
   * Récupère une valeur depuis le cache, ou la calcule et la stocke si absente
   * @param key Clé de cache
   * @param factory Fonction qui génère la valeur si non trouvée
   * @param ttl Temps de vie (en secondes)
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl: number = 300,
  ): Promise<T> {
    const cached = await this.cacheManager.get<T>(key);
    if (cached) {
      return cached;
    }

    const value = await factory();
    await this.cacheManager.set(key, value, ttl);
    return value;
  }

  /**
   * Met manuellement une valeur dans le cache
   */
  async set<T>(key: string, value: T, ttl: number = 300): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
  }

  /**
   * Récupère une valeur sans fallback
   */
  async get<T>(key: string): Promise<T | null> {
    return (await this.cacheManager.get<T>(key)) ?? null;
  }

  /**
   * Supprime une clé du cache
   */
  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }

  /**
   * Supprime toutes les clés correspondant à un pattern
   * Note: implémentation simplifiée - dans un vrai Redis, on utiliserait KEYS + DEL
   */
  async delPattern(pattern: string): Promise<void> {
    try {
      // Essayer d'abord via l'API de cache-manager (store.keys)
      const store: any = (this.cacheManager as any).store;

      if (store && typeof store.keys === 'function') {
        const keys: string[] = await store.keys(pattern);
        if (!keys || keys.length === 0) return;
        await Promise.allSettled(keys.map((key) => this.cacheManager.del(key)));
        return;
      }

      // Fallback pour un client Redis accessible directement (node-redis v4)
      if (store && store.client && typeof store.client.scan === 'function') {
        const client = store.client;
        let cursor = '0';
        const keys: string[] = [];

        do {
          const scanResult = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
          // node-redis v4: { cursor: string; keys: string[] }
          cursor = scanResult.cursor ?? (Array.isArray(scanResult) ? scanResult[0] : '0');
          const foundKeys = scanResult.keys ?? (Array.isArray(scanResult) ? scanResult[1] : []);
          if (foundKeys && foundKeys.length) {
            keys.push(...foundKeys);
          }
        } while (cursor !== '0');

        if (keys.length > 0) {
          await client.del(keys);
        }
        return;
      }

      console.warn(`Impossible de supprimer le pattern ${pattern}: aucune méthode keys/scan disponible.`);
    } catch (error) {
      console.error(`Erreur lors de la suppression du pattern ${pattern}:`, error);
    }
  }
}
