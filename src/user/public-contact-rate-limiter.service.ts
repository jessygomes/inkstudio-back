import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';

type ConsumePublicContactInput = {
  ip: string;
  targetUserId: string;
  senderEmail?: string;
};

type ConsumePublicContactResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  blockedBy: 'ip' | 'target' | 'sender_email' | null;
};

@Injectable()
export class PublicContactRateLimiterService {
  private readonly logger = new Logger(PublicContactRateLimiterService.name);

  // Prefixe unique pour isoler les compteurs Redis de ce flux uniquement.
  private readonly KEY_PREFIX = 'public:contact:rate-limit:';

  // Limite anti-spam par IP (fenetre courte).
  private readonly ipMaxRequests = Number(process.env.CONTACT_RATE_LIMIT_IP_MAX ?? 8);
  private readonly ipWindowSeconds = Number(process.env.CONTACT_RATE_LIMIT_IP_WINDOW_SECONDS ?? 10 * 60);

  // Limite anti-harcelement par profil cible (fenetre plus large).
  private readonly targetMaxRequests = Number(process.env.CONTACT_RATE_LIMIT_TARGET_MAX ?? 20);
  private readonly targetWindowSeconds = Number(
    process.env.CONTACT_RATE_LIMIT_TARGET_WINDOW_SECONDS ?? 60 * 60,
  );

  // Limite complementaire par email expéditeur pour freiner les abus tournants.
  private readonly senderEmailMaxRequests = Number(
    process.env.CONTACT_RATE_LIMIT_SENDER_EMAIL_MAX ?? 5,
  );
  private readonly senderEmailWindowSeconds = Number(
    process.env.CONTACT_RATE_LIMIT_SENDER_EMAIL_WINDOW_SECONDS ?? 60 * 60,
  );

  constructor(private readonly redisService: RedisService) {}

  async consume(input: ConsumePublicContactInput): Promise<ConsumePublicContactResult> {
    // Normalisation pour eviter des contournements type casse/espaces.
    const normalizedEmail = input.senderEmail?.trim().toLowerCase();

    // 1) Controle IP (frein immediat sur bursts).
    const ipState = await this.incrementWithWindow(
      `${this.KEY_PREFIX}ip:${input.ip}`,
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

    // 2) Controle cible (protection d'un profil contre le volume cumule).
    const targetState = await this.incrementWithWindow(
      `${this.KEY_PREFIX}target:${input.targetUserId}`,
      this.targetWindowSeconds,
      this.targetMaxRequests,
    );

    if (!targetState.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: targetState.retryAfterSeconds,
        blockedBy: 'target',
      };
    }

    // 3) Controle email expéditeur si present.
    if (normalizedEmail) {
      const emailState = await this.incrementWithWindow(
        `${this.KEY_PREFIX}sender-email:${normalizedEmail}`,
        this.senderEmailWindowSeconds,
        this.senderEmailMaxRequests,
      );

      if (!emailState.allowed) {
        return {
          allowed: false,
          retryAfterSeconds: emailState.retryAfterSeconds,
          blockedBy: 'sender_email',
        };
      }
    }

    return {
      allowed: true,
      retryAfterSeconds: 0,
      blockedBy: null,
    };
  }

  private async incrementWithWindow(
    key: string,
    windowSeconds: number,
    maxRequests: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    try {
      const client = this.redisService.getClient();
      // INCR cree la cle si absente et retourne le compteur courant.
      const count = await client.incr(key);

      // On pose l'expiration uniquement a la premiere occurrence pour definir la fenetre.
      if (count === 1) {
        await client.expire(key, windowSeconds);
      }

      // Si depassement, on renvoie le TTL restant pour alimenter Retry-After.
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
      // Strategie fail-open: en cas de panne Redis, on n'interrompt pas le formulaire.
      this.logger.error(`Rate limit Redis failure on key ${key}: ${this.getErrorMessage(error)}`);

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
