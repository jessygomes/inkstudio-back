import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from 'src/database/prisma.module';
import { MailModule } from 'src/email/mail.module';
import { FollowupsController } from './follow-up.controller';
import { FollowupSchedulerService } from './followup-scheduler.service';
import { FollowupQueueService } from './followup-queue.service';
import { FollowupProcessor } from './followup.processor';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    BullModule.registerQueue({ name: 'followup' }),
  ],
  providers: [
    FollowupSchedulerService,
    FollowupQueueService,
    FollowupProcessor,
  ],
  exports: [FollowupSchedulerService],
  controllers: [FollowupsController],
})
export class FollowUpModule {}
