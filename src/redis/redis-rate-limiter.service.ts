import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Redis-based rate limiter for email notifications
 * Replaces database queries with atomic Redis operations
 */
@Injectable()
export class RedisRateLimiterService {
  private readonly logger = new Logger('RedisRateLimiterService');
  private readonly EMAIL_RATE_LIMIT_PREFIX = 'email:rate_limit:';

  constructor(private readonly redisService: RedisService) {}

  /**
   * Check if we can send an email (respecting rate limits)
   * @param conversationId Conversation ID
   * @param recipientUserId Recipient user ID
   * @returns true if email can be sent, false if rate limited
   * Note: Window is hardcoded in recordEmailSent (3600s)
   */
  async canSendEmail(
    conversationId: string,
    recipientUserId: string,
  ): Promise<boolean> {
    try {
      const client = this.redisService.getClient();
      const key = `${this.EMAIL_RATE_LIMIT_PREFIX}${conversationId}:${recipientUserId}`;

      // Get current count
      const count = await client.get(key);

      if (!count) {
        // No previous email sent, allowed
        return true;
      }

      // Email already sent in window
      return false;
    } catch (error) {
      this.logger.error(
        `Failed to check rate limit for ${conversationId}/${recipientUserId}:`,
        this.getErrorMessage(error),
      );
      // On error, default to allowing (safer than blocking)
      return true;
    }
  }

  /**
   * Record that an email was sent (sets rate limit)
   * @param conversationId Conversation ID
   * @param recipientUserId Recipient user ID
   * @param windowSeconds Time window in seconds (default 3600 = 1 hour)
   */
  async recordEmailSent(
    conversationId: string,
    recipientUserId: string,
    windowSeconds = 3600,
  ): Promise<void> {
    try {
      const client = this.redisService.getClient();
      const key = `${this.EMAIL_RATE_LIMIT_PREFIX}${conversationId}:${recipientUserId}`;

      // Set key with expiration (auto-cleanup)
      await client.setEx(key, windowSeconds, new Date().toISOString());

      this.logger.debug(
        `Email rate limit set for ${conversationId}/${recipientUserId} (${windowSeconds}s)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to record email sent for ${conversationId}/${recipientUserId}:`,
        this.getErrorMessage(error),
      );
    }
  }

  /**
   * Reset rate limit for a conversation/user (manual override)
   * @param conversationId Conversation ID
   * @param recipientUserId Recipient user ID
   */
  async resetRateLimit(
    conversationId: string,
    recipientUserId: string,
  ): Promise<void> {
    try {
      const client = this.redisService.getClient();
      const key = `${this.EMAIL_RATE_LIMIT_PREFIX}${conversationId}:${recipientUserId}`;

      await client.del(key);
      this.logger.debug(`Rate limit reset for ${conversationId}/${recipientUserId}`);
    } catch (error) {
      this.logger.error(
        `Failed to reset rate limit for ${conversationId}/${recipientUserId}:`,
        this.getErrorMessage(error),
      );
    }
  }

  /**
   * Get time remaining until rate limit expires
   * @param conversationId Conversation ID
   * @param recipientUserId Recipient user ID
   * @returns Seconds remaining, or 0 if no rate limit
   */
  async getRateLimitTTL(
    conversationId: string,
    recipientUserId: string,
  ): Promise<number> {
    try {
      const client = this.redisService.getClient();
      const key = `${this.EMAIL_RATE_LIMIT_PREFIX}${conversationId}:${recipientUserId}`;

      const ttl = await client.ttl(key);
      return ttl > 0 ? ttl : 0;
    } catch (error) {
      this.logger.error(
        `Failed to get rate limit TTL for ${conversationId}/${recipientUserId}:`,
        this.getErrorMessage(error),
      );
      return 0;
    }
  }

  /**
   * Batch check rate limits for multiple conversations
   * Useful for bulk operations
   * @param checks Array of {conversationId, recipientUserId}
   * @returns Map of "conversationId:recipientUserId" → canSend boolean
   */
  async canSendEmailBatch(
    checks: Array<{ conversationId: string; recipientUserId: string }>,
  ): Promise<Map<string, boolean>> {
    const resultMap = new Map<string, boolean>();

    try {
      const client = this.redisService.getClient();
      const pipeline = client.multi();

      // Build pipeline
      for (const check of checks) {
        const key = `${this.EMAIL_RATE_LIMIT_PREFIX}${check.conversationId}:${check.recipientUserId}`;
        pipeline.exists(key);
      }

      const results = await pipeline.exec();

      // Process results
      for (let i = 0; i < checks.length; i++) {
        const check = checks[i];
        const mapKey = `${check.conversationId}:${check.recipientUserId}`;
        const exists = results?.[i];
        
        // If key exists (1), email was recently sent (false = can't send)
        // If key doesn't exist (0), no recent email (true = can send)
        const canSend = typeof exists === 'number' ? exists === 0 : true;
        resultMap.set(mapKey, canSend);
      }
    } catch (error) {
      this.logger.error(
        'Failed to batch check rate limits:',
        this.getErrorMessage(error),
      );
      // On error, allow all (safer)
      for (const check of checks) {
        const mapKey = `${check.conversationId}:${check.recipientUserId}`;
        resultMap.set(mapKey, true);
      }
    }

    return resultMap;
  }

  /**
   * Normalize error message
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error occurred';
  }
}
