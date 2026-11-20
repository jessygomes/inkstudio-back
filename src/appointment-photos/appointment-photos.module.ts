import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { UploadsModule } from 'src/uploads/uploads.module';
import { AppointmentPhotoUploadService } from './appointment-photo-upload.service';
import { AppointmentPhotosController } from './appointment-photos.controller';
import { BookingImagesController } from './booking-images.controller';
import { AppointmentPhotosService } from './appointment-photos.service';
import { UploadStorage } from './upload-storage';

@Module({
  imports: [UploadsModule],
  controllers: [AppointmentPhotosController, BookingImagesController],
  providers: [AppointmentPhotosService, AppointmentPhotoUploadService, UploadStorage, PrismaService],
  exports: [AppointmentPhotoUploadService, AppointmentPhotosService],
})
export class AppointmentPhotosModule {}
