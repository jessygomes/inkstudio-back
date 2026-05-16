import { Module } from '@nestjs/common';
import { MailService } from './mailer.service';
import { MailgunService } from './mailgun.service';
import { EmailTemplateService } from './email-template.service';
import { PrismaModule } from '../database/prisma.module';
import { EmailPreviewController } from './email-preview.controller';

@Module({
  imports: [PrismaModule],
  controllers: [EmailPreviewController],
  providers: [MailService, MailgunService, EmailTemplateService],
  exports: [MailService, EmailTemplateService],
})
export class MailModule {}
