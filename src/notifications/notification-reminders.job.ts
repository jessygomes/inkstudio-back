import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bull';
import { NotificationRemindersService } from './notification-reminders.service';

export const NOTIFICATION_REMINDERS_QUEUE = 'notification-reminders';

/** Planifie le passage des rappels toutes les 15 minutes (tâche répétée Bull, unique même avec plusieurs instances). */
@Injectable()
export class NotificationRemindersScheduler implements OnModuleInit {
  private readonly logger = new Logger(NotificationRemindersScheduler.name);

  constructor(@InjectQueue(NOTIFICATION_REMINDERS_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const job of await this.queue.getRepeatableJobs()) {
        if (job.id === 'notification-reminders-tick') await this.queue.removeRepeatableByKey(job.key);
      }
      await this.queue.add('tick', {}, { repeat: { every: 15 * 60 * 1000 }, jobId: 'notification-reminders-tick', removeOnComplete: true, removeOnFail: true });
    } catch (e) {
      this.logger.error(`Planification des rappels impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

@Processor(NOTIFICATION_REMINDERS_QUEUE)
export class NotificationRemindersJob {
  private readonly logger = new Logger(NotificationRemindersJob.name);

  constructor(private readonly reminders: NotificationRemindersService) {}

  @Process('tick')
  async tick(_job: Job): Promise<void> {
    await this.reminders.run();
  }
}
