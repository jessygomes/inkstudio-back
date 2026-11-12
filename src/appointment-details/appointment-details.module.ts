import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/database/prisma.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AppointmentPhotosModule } from '../appointment-photos/appointment-photos.module';
import { SuiviModule } from '../suivi/suivi.module';
import { AppointmentDetailsController } from './appointment-details.controller';
import { AppointmentDetailsService } from './appointment-details.service';

/** Regroupe en une requête ce que la fiche d'un rendez-vous charge (rendez-vous, client, conversation, photos, suivi de dessin). */
@Module({
  imports: [PrismaModule, AppointmentsModule, AppointmentPhotosModule, SuiviModule],
  controllers: [AppointmentDetailsController],
  providers: [AppointmentDetailsService],
})
export class AppointmentDetailsModule {}
