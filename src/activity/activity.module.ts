import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/database/prisma.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

/** Pastilles « nouveau » de la barre latérale du site : une seule requête légère au lieu de relire tout l'historique. */
@Module({
  imports: [PrismaModule, AppointmentsModule],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
