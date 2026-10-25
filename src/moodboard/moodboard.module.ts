import { Module } from '@nestjs/common';
import { MoodboardController } from './moodboard.controller';
import { MoodboardService } from './moodboard.service';
import { PrismaService } from 'src/database/prisma.service';
import { MessagingModule } from 'src/messaging/messaging.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { BullModule } from '@nestjs/bull';
import { MailModule } from 'src/email/mail.module';
import { ProjectProposalEmailService } from './project-proposal-email.service';

@Module({
  imports: [MessagingModule, MailModule, BullModule.registerQueue({ name: 'project-proposal-emails' })],
  controllers: [MoodboardController, ProjectsController],
  providers: [MoodboardService, ProjectsService, PrismaService, ProjectProposalEmailService],
  exports: [MoodboardService],
})
export class MoodboardModule {}
