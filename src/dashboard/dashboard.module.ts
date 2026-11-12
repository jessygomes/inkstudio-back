import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/database/prisma.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { ClientsModule } from '../clients/clients.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SalonReviewModule } from '../salon-review/salon-review.module';
import { SuiviModule } from '../suivi/suivi.module';
import { SaasModule } from '../saas/saas.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** Regroupe en une requête les données de l'accueil (rendez-vous du jour, en attente, messages, suivis, projets, chiffres du mois, avis). */
@Module({
  imports: [PrismaModule, AppointmentsModule, ClientsModule, MessagingModule, SalonReviewModule, SuiviModule, SaasModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
