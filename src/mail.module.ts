import { Module } from '@nestjs/common';
import { MailService } from './mailer.service';
import { EmailTemplateService } from './email-template.service';

@Module({
  providers: [MailService, EmailTemplateService],
  exports: [MailService, EmailTemplateService],
})
export class MailModule {}
