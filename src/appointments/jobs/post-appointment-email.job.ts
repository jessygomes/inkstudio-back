import { Processor, Process } from '@nestjs/bull';
import { PostAppointmentEmailService, SendResult } from '../post-appointment-email.service';

@Processor('post-appointment-email')
export class PostAppointmentEmailJob {
  constructor(private readonly service: PostAppointmentEmailService) {}

  @Process('send-post-appointment')
  async handle(): Promise<SendResult> {
    return this.service.sendDueEmails();
  }
}
