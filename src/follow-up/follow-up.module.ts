import { MessagingModule } from 'src/messaging/messaging.module';
import { RedisModule } from 'src/redis/redis.module';
import { ReminderSettingsController } from './reminder-settings.controller';
import { ReminderSettingsService } from './reminder-settings.service';
import { ReminderDeliveryService } from './reminder-delivery.service';
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
    MessagingModule,
    RedisModule,
    MailModule,
    BullModule.registerQueue({ name: 'followup' }),
  ],
  providers: [
    FollowupSchedulerService,
    FollowupQueueService,
    FollowupProcessor,
    ReminderSettingsService,
    ReminderDeliveryService,
  ],
  exports: [FollowupSchedulerService, ReminderDeliveryService],
  controllers: [FollowupsController, ReminderSettingsController],
})
export class FollowUpModule {}
