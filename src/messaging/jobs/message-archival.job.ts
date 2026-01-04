import { Processor, Process } from '@nestjs/bull';
import { MessageArchivalService } from '../archival/message-archival.service';

@Processor('message-archival')
export class MessageArchivalJob {
  constructor(private readonly messageArchivalService: MessageArchivalService) {}

  @Process('run-archival')
  async handle(): Promise<{ archivedCount: number; deletedCount: number }> {
    return this.messageArchivalService.runArchival();
  }
}
