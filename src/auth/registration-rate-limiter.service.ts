import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';

type ConsumeRateLimitInput = {
  ip: string;
  email?: string;
};

type ConsumeRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  blockedBy: 'ip' | 'email' | null;
};

@Injectable()
export class RegistrationRateLimiterService {
  private readonly logger = new Logger(RegistrationRateLimiterService.name);

  // Préfixe unique pour éviter les collisions avec d'autres clés Redis de l'application.
  private readonly KEY_PREFIX = 'auth:register:rate-limit:';

  // Limite et fenêtre pour l'IP (ex: éviter les rafales depuis une même source réseau).
  private readonly ipMaxRequests = Number(process.env.REGISTER_RATE_LIMIT_IP_MAX ?? 10);
  private readonly ipWindowSeconds = Number(process.env.REGISTER_RATE_LIMIT_IP_WINDOW_SECONDS ?? 15 * 60);

  // Limite et fenêtre pour l'email (ex: éviter le spam ciblé sur une même adresse).
  private readonly emailMaxRequests = Number(process.env.REGISTER_RATE_LIMIT_EMAIL_MAX ?? 5);
  private readonly emailWindowSeconds = Number(
    process.env.REGISTER_RATE_LIMIT_EMAIL_WINDOW_SECONDS ?? 60 * 60,
  );

  constructor(private readonly redisService: RedisService) {}

  /**
   * Consomme 1 tentative d'inscription sur les deux axes (IP + email).
   *
   * - Si une limite est dépassée, on bloque immédiatement la requête.
   * - On renvoie aussi le temps d'attente avant la prochaine tentative.
   */
  async consume(input: ConsumeRateLimitInput): Promise<ConsumeRateLimitResult> {
    const normalizedEmail = input.email?.trim().toLowerCase();
    const ipKey = `${this.KEY_PREFIX}ip:${input.ip}`;

    // 1) Vérifie la limite côté IP.
    const ipState = await this.incrementWithWindow(
      ipKey,
      this.ipWindowSeconds,
      this.ipMaxRequests,
    );

    if (!ipState.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: ipState.retryAfterSeconds,
        blockedBy: 'ip',
      };
    }

    // 2) Vérifie la limite côté email si un email est présent.
    if (normalizedEmail) {
      const emailKey = `${this.KEY_PREFIX}email:${normalizedEmail}`;
      const emailState = await this.incrementWithWindow(
        emailKey,
        this.emailWindowSeconds,
        this.emailMaxRequests,
      );

      if (!emailState.allowed) {
        return {
          allowed: false,
          retryAfterSeconds: emailState.retryAfterSeconds,
          blockedBy: 'email',
        };
      }
    }

    return {
      allowed: true,
      retryAfterSeconds: 0,
      blockedBy: null,
    };
  }

  /**
   * Incrémente un compteur Redis et garantit une expiration de fenêtre glissante simple.
   *
   * Stratégie:
   * - INCR atomique pour compter la tentative courante.
   * - Si c'est la première occurrence (count=1), on pose l'expiration (EXPIRE).
   * - Si count > maxRequests, on bloque et on retourne le TTL restant.
   */
  private async incrementWithWindow(
    key: string,
    windowSeconds: number,
    maxRequests: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    try {
      const client = this.redisService.getClient();
      const count = await client.incr(key);

      if (count === 1) {
        await client.expire(key, windowSeconds);
      }

      if (count > maxRequests) {
        const ttl = await client.ttl(key);
        return {
          allowed: false,
          retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
        };
      }

      return {
        allowed: true,
        retryAfterSeconds: 0,
      };
    } catch (error) {
      // En cas de souci Redis, on n'interrompt pas le flux fonctionnel.
      // On loggue le problème et on autorise la requête (fail-open contrôlé).
      this.logger.error(
        `Rate limit Redis failure on key ${key}: ${this.getErrorMessage(error)}`,
      );

      return {
        allowed: true,
        retryAfterSeconds: 0,
      };
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error';
  }
}
