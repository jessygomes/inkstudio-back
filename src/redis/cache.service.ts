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
  delPattern(_pattern: string): void {
    // Pour l'instant on ne fait rien - à implémenter avec un vrai client Redis
    console.log(`⚠️ delPattern non implémenté pour le pattern: ${_pattern}`);
  }
}
