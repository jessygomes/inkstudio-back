import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class MessageArchivalService {
  private readonly logger = new Logger('MessageArchivalService');

  constructor(private readonly prisma: PrismaService) {}

  private getRetentionDays(): number {
    const envValue = process.env.MESSAGE_RETENTION_DAYS;
    const parsed = envValue ? Number.parseInt(envValue, 10) : 90;
    return Number.isNaN(parsed) ? 90 : Math.max(parsed, 1);
  }

  private getHardDeleteDays(): number {
    const envValue = process.env.MESSAGE_HARD_DELETE_AFTER_DAYS;
    const parsed = envValue ? Number.parseInt(envValue, 10) : 0;
    if (Number.isNaN(parsed)) {
      return 0;
    }
    return parsed < 0 ? 0 : parsed;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error occurred';
  }

  /**
   * Archive messages older than retention (soft delete via archivedAt)
   */
  async archiveOldMessages(): Promise<number> {
    try {
      const retentionDays = this.getRetentionDays();
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      const result = await this.prisma.message.updateMany({
        where: {
          archivedAt: null,
          createdAt: { lt: cutoff },
        },
        data: {
          archivedAt: new Date(),
        },
      });

      this.logger.log(`Archived ${result.count} messages older than ${retentionDays}d`);
      return result.count;
    } catch (error) {
      this.logger.error('Failed to archive old messages', this.getErrorMessage(error));
      return 0;
    }
  }

  /**
   * Hard delete messages that have been archived long enough
   */
  async hardDeleteArchivedMessages(): Promise<number> {
    const hardDeleteDays = this.getHardDeleteDays();
    if (hardDeleteDays <= 0) {
      return 0; // disabled
    }

    try {
      const cutoff = new Date(Date.now() - hardDeleteDays * 24 * 60 * 60 * 1000);
      const result = await this.prisma.message.deleteMany({
        where: {
          archivedAt: { lt: cutoff },
        },
      });

      this.logger.log(`Hard-deleted ${result.count} archived messages older than ${hardDeleteDays}d`);
      return result.count;
    } catch (error) {
      this.logger.error('Failed to hard delete archived messages', this.getErrorMessage(error));
      return 0;
    }
  }

  /**
   * Run full archival pipeline
   */
  async runArchival(): Promise<{ archivedCount: number; deletedCount: number }> {
    const archivedCount = await this.archiveOldMessages();
    const deletedCount = await this.hardDeleteArchivedMessages();
    return { archivedCount, deletedCount };
  }
}
