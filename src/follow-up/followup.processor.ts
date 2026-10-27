import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { ReminderDeliveryService } from './reminder-delivery.service';

@Processor('followup')
export class FollowupProcessor {
  constructor(private readonly delivery: ReminderDeliveryService) {}
  @Process('sendFollowupEmail')
  async handle(job: Job<{ appointmentId: string }>) { await this.delivery.deliver(job.data.appointmentId, 'FOLLOW_UP'); }
  @Process('sendRetouchesReminderEmail')
  async handleRetouches(job: Job<{ appointmentId: string }>) { await this.delivery.deliver(job.data.appointmentId, 'RETOUCH'); }
}
