import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../database/prisma.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { NotificationRemindersService } from './notification-reminders.service';
import { NOTIFICATION_REMINDERS_QUEUE, NotificationRemindersJob, NotificationRemindersScheduler } from './notification-reminders.job';

/** Global : n'importe quel service peut injecter NotificationsService pour notifier un utilisateur. */
@Global()
@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: NOTIFICATION_REMINDERS_QUEUE })],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushService, NotificationRemindersService, NotificationRemindersScheduler, NotificationRemindersJob],
  exports: [NotificationsService, PushService],
})
export class NotificationsModule {}
