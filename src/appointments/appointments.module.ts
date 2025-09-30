import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { PrismaService } from 'src/database/prisma.service';
import { MailModule } from 'src/email/mail.module';
import { FollowUpModule } from 'src/follow-up/follow-up.module';
import { SaasModule } from 'src/saas/saas.module';
import { VideoCallModule } from 'src/video-call/video-call.module';
import { CacheService } from 'src/redis/cache.service';

@Module({
  imports: [FollowUpModule, SaasModule, MailModule, VideoCallModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, PrismaService, CacheService],
})
export class AppointmentsModule {}
