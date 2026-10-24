import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { AppointmentPhotosService } from './appointment-photos.service';
import { AddAppointmentPhotosDto } from './dto/add-appointment-photos.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class AppointmentPhotosController {
  constructor(private readonly photos: AppointmentPhotosService) {}

  @Get('appointments/:id/photos')
  list(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.photos.list(id, req.user.userId);
  }

  @Post('appointments/:id/photos')
  add(@Param('id') id: string, @Request() req: RequestWithUser, @Body() dto: AddAppointmentPhotosDto) {
    return this.photos.add(id, req.user.userId, dto);
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
