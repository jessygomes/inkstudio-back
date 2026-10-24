import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
} from '@nestjs/common';
import { EmailTemplateService } from './email-template.service';
import { emailPreviewData, emailPreviewTemplates } from './email-preview.data';

@Controller('dev/email-preview')
export class EmailPreviewController {
  constructor(private readonly emailTemplateService: EmailTemplateService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  preview(@Query('template') template = 'cicatrisation-followup'): string {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Email preview is disabled in production');
    }

    const method = emailPreviewTemplates[template as keyof typeof emailPreviewTemplates];
    if (!method) {
      throw new BadRequestException(`Unknown template '${template}'. Try: ${Object.keys(emailPreviewTemplates).join(', ')}`);
    }
    return this.emailTemplateService[method](emailPreviewData);
  }
}
