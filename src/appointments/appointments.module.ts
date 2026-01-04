import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { PrismaService } from 'src/database/prisma.service';
import { MailModule } from 'src/email/mail.module';
import { FollowUpModule } from 'src/follow-up/follow-up.module';
import { SaasModule } from 'src/saas/saas.module';
import { VideoCallModule } from 'src/video-call/video-call.module';
import { CacheService } from 'src/redis/cache.service';
import { MessagingModule } from 'src/messaging/messaging.module';
import { PostAppointmentEmailService } from './post-appointment-email.service';
import { PostAppointmentEmailJob } from './jobs/post-appointment-email.job';
import { PostAppointmentEmailScheduler } from './jobs/post-appointment-email.scheduler';

@Module({
  imports: [
    FollowUpModule,
    SaasModule,
    MailModule,
    VideoCallModule,
    MessagingModule,
    BullModule.registerQueue({ name: 'post-appointment-email' }),
  ],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    PrismaService,
    CacheService,
    PostAppointmentEmailService,
    PostAppointmentEmailJob,
    PostAppointmentEmailScheduler,
  ],
})
export class AppointmentsModule {}
