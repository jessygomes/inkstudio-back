import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { SaasService } from './saas.service';

@Processor('saas-billing')
export class SaasBillingJob {
  private readonly logger = new Logger(SaasBillingJob.name);

  constructor(private readonly saasService: SaasService) {}

  // Traite le job quotidien qui rétrograde les comptes en past_due
  // depuis plus de 5 jours vers le plan FREE.
  @Process('downgrade-past-due')
  async handle() {
    const result = await this.saasService.downgradeExpiredPastDueUsers(5);
    this.logger.log(
      `Scan past_due terminé: scannés=${result.scanned}, downgradés=${result.downgraded}`,
    );
    return result;
  }
}
