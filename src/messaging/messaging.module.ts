import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../database/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ConversationsController } from './conversations/conversations.controller';
import { ConversationsService } from './conversations/conversations.service';
import { MessagesController } from './messages/messages.controller';
import { MessagesService } from './messages/messages.service';
import { MessageNotificationService } from './notifications/message-notification.service';
import { NotificationPreferenceService } from './notifications/notification-preference.service';
import { NotificationPreferencesController } from './notifications/notification-preferences.controller';
import { TestEmailNotificationController } from './notifications/test-email-notification.controller';
import { EmailNotificationService } from './notifications/email-notification.service';
import { ConversationAccessGuard } from './conversations/guards/conversation-access.guard';
import { MessageAccessGuard } from './messages/guards/message-access.guard';
import { MessagesGateway } from './websocket/messages.gateway';
import { WebSocketAuthService } from './websocket/websocket-auth.service';
import { SendEmailNotificationsJob } from './jobs/send-email-notifications.job';
import { EmailNotificationScheduler } from './jobs/email-notification.scheduler';
import { MessageArchivalService } from './archival/message-archival.service';
import { MessageArchivalJob } from './jobs/message-archival.job';
import { MessageArchivalScheduler } from './jobs/message-archival.scheduler';
import { MailgunService } from '../email/mailgun.service';
import { JwtModule } from '@nestjs/jwt';
import { InboxController } from './inbox/inbox.controller';
import { InboxService } from './inbox/inbox.service';
import { InstagramApiService } from './instagram/instagram-api.service';
import { InstagramService } from './instagram/instagram.service';
import { InstagramController } from './instagram/instagram.controller';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: '24h' },
    }),
    BullModule.registerQueue({
      name: 'email-notifications',
    }),
    BullModule.registerQueue({
      name: 'message-archival',
    }),
  ],
  controllers: [
    ConversationsController,
    MessagesController,
    InboxController,
    InstagramController,
    NotificationPreferencesController,
    TestEmailNotificationController,
  ],
  providers: [
    ConversationsService,
    MessagesService,
    InboxService,
    InstagramApiService,
    InstagramService,
    MessageNotificationService,
    NotificationPreferenceService,
    EmailNotificationService,
    MessageArchivalService,
    ConversationAccessGuard,
    MessageAccessGuard,
    MessagesGateway,
    WebSocketAuthService,
    SendEmailNotificationsJob,
    EmailNotificationScheduler,
    MessageArchivalJob,
    MessageArchivalScheduler,
    MailgunService,
  ],
  exports: [
    ConversationsService,
    MessagesService,
    InboxService,
    MessageNotificationService,
    EmailNotificationService,
    NotificationPreferenceService,
  ],
})
export class MessagingModule {}
