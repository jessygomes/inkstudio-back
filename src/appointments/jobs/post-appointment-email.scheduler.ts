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
        repeat: { cron: '0 9 * * *' }, // every day at 09:00
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'fixed', delay: 30_000 },
      },
    );

    this.logger.log('Scheduled daily post-appointment emails at 09:00');
  }
}
