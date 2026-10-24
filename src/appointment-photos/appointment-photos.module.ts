import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { AppointmentPhotosController } from './appointment-photos.controller';
import { AppointmentPhotosService } from './appointment-photos.service';

@Module({ controllers: [AppointmentPhotosController], providers: [AppointmentPhotosService, PrismaService] })
export class AppointmentPhotosModule {}
