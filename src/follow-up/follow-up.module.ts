/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/database/prisma.module';
import { MailService } from 'src/mailer.service';
import { FollowupsController } from './follow-up.controller';
import { FollowupSchedulerService } from './followup-scheduler.service';

@Module({
  imports: [PrismaModule],
  providers: [FollowupSchedulerService, MailService],
  exports: [FollowupSchedulerService],
  controllers: [FollowupsController],
})
export class FollowUpModule {}
