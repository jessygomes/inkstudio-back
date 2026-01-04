import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bull';

@Injectable()
export class MessageArchivalScheduler implements OnModuleInit {
  private readonly logger = new Logger('MessageArchivalScheduler');
  private readonly jobName = 'run-archival';

  constructor(@InjectQueue('message-archival') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    // Remove old repeatable jobs to avoid duplicates
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
        repeat: { cron: '0 3 * * *' }, // every day at 03:00
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'fixed', delay: 30_000 },
      },
    );

    this.logger.log('Scheduled daily message archival at 03:00');
  }
}
