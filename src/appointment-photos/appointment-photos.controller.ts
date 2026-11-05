import { Body, Controller, Delete, Get, Headers, Param, Post, Request, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { SecurityThrottle } from 'src/auth/security-throttle';
import { AppointmentPhotosService } from './appointment-photos.service';
import { AppointmentPhotoUploadService, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_UPLOAD } from './appointment-photo-upload.service';
import { AddAppointmentPhotosDto } from './dto/add-appointment-photos.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class AppointmentPhotosController {
  constructor(
    private readonly photos: AppointmentPhotosService,
    private readonly uploads: AppointmentPhotoUploadService,
  ) {}

  @Get('appointments/:id/photos')
  list(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.photos.list(id, req.user.userId);
  }

  @Post('appointments/:id/photos')
  add(@Param('id') id: string, @Request() req: RequestWithUser, @Body() dto: AddAppointmentPhotosDto) {
    return this.photos.add(id, req.user.userId, dto);
  }

  // Envoi direct d'images (multipart, champ « photos ») pour l'app mobile ; le web continue d'utiliser UploadThing + la route ci-dessus.
  @Post('appointments/:id/photos/upload')
  @SecurityThrottle('upload')
  @UseInterceptors(FilesInterceptor('photos', MAX_PHOTOS_PER_UPLOAD, { storage: memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS_PER_UPLOAD } }))
  upload(
    @Param('id') id: string,
    @Request() req: RequestWithUser,
    @UploadedFiles() files: Express.Multer.File[],
    @Headers('authorization') authorization?: string,
  ) {
    return this.uploads.upload(id, req.user.userId, files ?? [], authorization);
  }

  @Delete('appointments/:id/photos/:photoId')
  remove(@Param('id') id: string, @Param('photoId') photoId: string, @Request() req: RequestWithUser) {
    return this.photos.remove(id, photoId, req.user.userId);
  }

  @Get('clients/:id/photos')
  forClient(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.photos.forClient(id, req.user.userId);
  }
}
