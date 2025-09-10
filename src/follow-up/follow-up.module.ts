import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/database/prisma.module';
import { MailModule } from 'src/mail.module';
import { FollowupsController } from './follow-up.controller';
import { FollowupSchedulerService } from './followup-scheduler.service';

@Module({
  imports: [PrismaModule, MailModule],
  providers: [FollowupSchedulerService],
  exports: [FollowupSchedulerService],
  controllers: [FollowupsController],
})
export class FollowUpModule {}
