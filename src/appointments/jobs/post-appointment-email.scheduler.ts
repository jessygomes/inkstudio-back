import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bull';

@Injectable()
export class PostAppointmentEmailScheduler implements OnModuleInit {
  private readonly logger = new Logger('PostAppointmentEmailScheduler');
  private readonly jobName = 'send-post-appointment';

  constructor(@InjectQueue('post-appointment-email') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    const repeats = await this.queue.getRepeatableJobs();
    await Promise.all(
      repeats
        .filter((job) => job.name === this.jobName)
        .map((job) => this.queue.removeRepeatableByKey(job.key)),
    );

    await this.queue.add(
      this.jobName,
      {},
      {
        repeat: { every: 15 * 60 * 1000 }, // Reconcile pending reminders every 15 minutes
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'fixed', delay: 30_000 },
      },
    );

    this.logger.log('Scheduled pending appointment reminders every 15 minutes');
  }
}
