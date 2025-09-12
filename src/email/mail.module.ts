import { Module } from '@nestjs/common';
import { MailService } from './mailer.service';
import { MailgunService } from './mailgun.service';
import { EmailTemplateService } from './email-template.service';

@Module({
  providers: [MailService, MailgunService, EmailTemplateService],
  exports: [MailService, EmailTemplateService],
})
export class MailModule {}
