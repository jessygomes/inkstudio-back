import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('RedisService');
  private client: RedisClientType;
  private pubClient: RedisClientType;
  private subClient: RedisClientType;

  async onModuleInit() {
    try {
      // Main client pour les opérations générale
      this.client = createClient({
        socket: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
        },
        password: process.env.REDIS_PASSWORD || undefined,
        database: parseInt(process.env.REDIS_DB || '0', 10),
      });

      await this.client.connect();
      this.logger.log('Redis client connected');

      // Pub/Sub clients (Redis requires separate connections for pub/sub)
      this.pubClient = this.client.duplicate();
      this.subClient = this.client.duplicate();

      await this.pubClient.connect();
      await this.subClient.connect();
      this.logger.log('Redis pub/sub clients connected');
    } catch (error) {
      this.logger.error('Failed to connect to Redis:', this.getErrorMessage(error));
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      if (this.client?.isOpen) await this.client.quit();
      if (this.pubClient?.isOpen) await this.pubClient.quit();
      if (this.subClient?.isOpen) await this.subClient.quit();
      this.logger.log('Redis connections closed');
    } catch (error) {
      this.logger.error('Error closing Redis connections:', this.getErrorMessage(error));
    }
  }

  /**
   * Get main Redis client
   */
  getClient(): RedisClientType {
    return this.client;
  }

  /**
   * Get pub client for publishing
   */
  getPubClient(): RedisClientType {
    return this.pubClient;
  }

  /**
   * Get sub client for subscribing
   */
  getSubClient(): RedisClientType {
    return this.subClient;
  }

  /**
   * Generic error message extractor
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
