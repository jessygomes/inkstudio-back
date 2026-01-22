import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Manages user online/offline status in Redis
 * Provides centralized presence tracking across multiple server instances
 */
@Injectable()
export class RedisOnlineStatusService {
  private readonly logger = new Logger('RedisOnlineStatusService');
  private readonly USER_ONLINE_PREFIX = 'user:online:';
  private readonly USER_CONNECTIONS_PREFIX = 'user:connections:';
  private readonly TTL_SECONDS = 3600; // 1 hour

  constructor(private readonly redisService: RedisService) {}

  /**
   * Mark user as online with optional socket ID (for multi-tab support)
   * @param userId User ID
   * @param socketId Socket connection ID (unique per tab)
   */
  async markUserOnline(userId: string, socketId: string): Promise<void> {
    try {
      const client = this.redisService.getClient();

      // Store socket ID in user's connection set
      const connectionKey = `${this.USER_CONNECTIONS_PREFIX}${userId}`;
      await client.sAdd(connectionKey, socketId);
      await client.expire(connectionKey, this.TTL_SECONDS);

      // Mark user online with timestamp
      const onlineKey = `${this.USER_ONLINE_PREFIX}${userId}`;
      await client.setEx(onlineKey, this.TTL_SECONDS, new Date().toISOString());

      this.logger.debug(`User ${userId} marked online (socket: ${socketId})`);
    } catch (error) {
      this.logger.error(
        `Failed to mark user ${userId} online:`,
        this.getErrorMessage(error),
      );
    }
  }

  /**
   * Remove socket ID from user's connections
   * @param userId User ID
   * @param socketId Socket connection ID
   * @returns true if user has no more connections
   */
  async removeUserConnection(
    userId: string,
    socketId: string,
  ): Promise<boolean> {
    try {
      const client = this.redisService.getClient();

      const connectionKey = `${this.USER_CONNECTIONS_PREFIX}${userId}`;
      
      // Get all connections before removing
      const allConnections = await client.sMembers(connectionKey);
      this.logger.debug(`🔴 [Redis] User ${userId} - Before removal: ${allConnections.length} connections - [${allConnections.join(', ')}]`);
      this.logger.debug(`🔴 [Redis] Removing socketId: ${socketId}`);
      
      await client.sRem(connectionKey, socketId);

      // Check if user has remaining connections
      const remainingConnections = await client.sCard(connectionKey);
      const remainingConnectionsList = await client.sMembers(connectionKey);
      this.logger.debug(`🔴 [Redis] User ${userId} - After removal: ${remainingConnections} connections - [${remainingConnectionsList.join(', ')}]`);

      if (remainingConnections === 0) {
        // User is completely offline
        const onlineKey = `${this.USER_ONLINE_PREFIX}${userId}`;
        await client.del([onlineKey, connectionKey]);
        this.logger.debug(`✅ User ${userId} marked offline (no connections)`);
        return true;
      }

      this.logger.debug(`⚠️ User ${userId} still has ${remainingConnections} connections`);
      return false;
    } catch (error) {
      this.logger.error(
        `Failed to remove connection for user ${userId}:`,
        this.getErrorMessage(error),
      );
      return false;
    }
  }

  /**
   * Check if user is online
   * @param userId User ID
   * @returns true if user has at least one active connection
   */
  async isUserOnline(userId: string): Promise<boolean> {
    try {
      const client = this.redisService.getClient();

      const connectionKey = `${this.USER_CONNECTIONS_PREFIX}${userId}`;
      const connectionCount = await client.sCard(connectionKey);

      return connectionCount > 0;
    } catch (error) {
      this.logger.error(
        `Failed to check online status for user ${userId}:`,
        this.getErrorMessage(error),
      );
      return false;
    }
  }

  /**
   * Get count of active connections for user (multi-tab support)
   * @param userId User ID
   * @returns Number of active connections
   */
  async getUserConnectionCount(userId: string): Promise<number> {
    try {
      const client = this.redisService.getClient();

      const connectionKey = `${this.USER_CONNECTIONS_PREFIX}${userId}`;
      return await client.sCard(connectionKey);
    } catch (error) {
      this.logger.error(
        `Failed to get connection count for user ${userId}:`,
        this.getErrorMessage(error),
      );
      return 0;
    }
  }

  /**
   * Get all socket IDs for a user (for multi-tab notifications)
   * @param userId User ID
   * @returns Array of socket IDs
   */
  async getUserConnections(userId: string): Promise<string[]> {
    try {
      const client = this.redisService.getClient();

      const connectionKey = `${this.USER_CONNECTIONS_PREFIX}${userId}`;
      return await client.sMembers(connectionKey);
    } catch (error) {
      this.logger.error(
        `Failed to get connections for user ${userId}:`,
        this.getErrorMessage(error),
      );
      return [];
    }
  }

  /**
   * Refresh user online status TTL (extend expiration)
   * Useful for periodic keep-alive signals
   * @param userId User ID
   */
  async refreshUserStatus(userId: string): Promise<void> {
    try {
      const client = this.redisService.getClient();

      const onlineKey = `${this.USER_ONLINE_PREFIX}${userId}`;
      const connectionKey = `${this.USER_CONNECTIONS_PREFIX}${userId}`;

      // Only refresh if user is actually online
      const hasConnections = (await client.sCard(connectionKey)) > 0;
      if (hasConnections) {
        await client.expire(onlineKey, this.TTL_SECONDS);
        await client.expire(connectionKey, this.TTL_SECONDS);
        this.logger.debug(`User ${userId} status refreshed`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to refresh user ${userId} status:`,
        this.getErrorMessage(error),
      );
    }
  }

  /**
   * Get online status for multiple users (bulk check)
   * @param userIds Array of user IDs
   * @returns Map of userId -> isOnline
   */
  async checkMultipleUsersOnline(userIds: string[]): Promise<Map<string, boolean>> {
    const statusMap = new Map<string, boolean>();

    try {
      const client = this.redisService.getClient();

      // Use pipeline for batch operations
      const pipeline = client.multi();

      for (const userId of userIds) {
        const connectionKey = `${this.USER_CONNECTIONS_PREFIX}${userId}`;
        pipeline.sCard(connectionKey);
      }

      const results = await pipeline.exec();

      for (let i = 0; i < userIds.length; i++) {
        const result = results?.[i];
        const count = typeof result === 'number' ? result : 0;
        statusMap.set(userIds[i], count > 0);
      }
    } catch (error) {
      this.logger.error(
        'Failed to check multiple users online status:',
        this.getErrorMessage(error),
      );
      // Return all as offline on error (safer than assuming online)
      userIds.forEach((userId) => statusMap.set(userId, false));
    }

    return statusMap;
  }

  /**
   * Get timestamp when user came online
   * @param userId User ID
   * @returns ISO timestamp or null if offline
   */
  async getUserOnlineTime(userId: string): Promise<string | null> {
    try {
      const client = this.redisService.getClient();

      const onlineKey = `${this.USER_ONLINE_PREFIX}${userId}`;
      return await client.get(onlineKey);
    } catch (error) {
      this.logger.error(
        `Failed to get online time for user ${userId}:`,
        this.getErrorMessage(error),
      );
      return null;
    }
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
