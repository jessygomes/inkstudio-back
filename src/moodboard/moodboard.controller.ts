import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { MoodboardService } from './moodboard.service';
import { CreateMoodboardDto } from './dto/create-moodboard.dto';
import { UpdateMoodboardDto } from './dto/update-moodboard.dto';
import { AddMoodboardImageDto } from './dto/add-moodboard-image.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';

@Controller('moodboard')
@UseGuards(JwtAuthGuard)
export class MoodboardController {
  constructor(private readonly moodboardService: MoodboardService) {}

  //! ─── MOODBOARD CRUD ───────────────────────────────────────────────────────

  //! CRÉER UN MOODBOARD ✅
  @Post()
  create(
    @Request() req: RequestWithUser,
    @Body() dto: CreateMoodboardDto,
  ) {
    return this.moodboardService.createMoodboard(req.user.userId, dto);
  }

  //! VOIR TOUS SES MOODBOARDS ✅
  @Get('my')
  getMyMoodboards(@Request() req: RequestWithUser) {
    return this.moodboardService.getMyMoodboards(req.user.userId);
  }

  //! VOIR UN MOODBOARD PAR ID ✅ (client propriétaire ou salon avec accès via rdv)
  @Get(':id')
  getById(
    @Param('id') id: string,
    @Request() req: RequestWithUser,
  ) {
    return this.moodboardService.getMoodboardById(id, req.user.userId);
  }

  //! MODIFIER UN MOODBOARD ✅
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: RequestWithUser,
    @Body() dto: UpdateMoodboardDto,
  ) {
    return this.moodboardService.updateMoodboard(id, req.user.userId, dto);
  }

  //! SUPPRIMER UN MOODBOARD ✅
  @Delete(':id')
  delete(
    @Param('id') id: string,
    @Request() req: RequestWithUser,
  ) {
    return this.moodboardService.deleteMoodboard(id, req.user.userId);
  }

  //! ─── IMAGES ───────────────────────────────────────────────────────────────

  //! AJOUTER UNE IMAGE ✅
  @Post(':id/images')
  addImage(
    @Param('id') id: string,
    @Request() req: RequestWithUser,
    @Body() dto: AddMoodboardImageDto,
  ) {
    return this.moodboardService.addImage(id, req.user.userId, dto);
  }

  //! SUPPRIMER UNE IMAGE ✅
  @Delete(':id/images/:imageId')
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.moodboardService.removeImage(id, imageId, req.user.userId);
  }

  //! ─── CONNEXION AU RDV ─────────────────────────────────────────────────────

  //! CONNECTER UN MOODBOARD À UN RDV ✅
  @Post(':id/connect/:appointmentId')
  connectToAppointment(
    @Param('id') id: string,
    @Param('appointmentId') appointmentId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.moodboardService.connectToAppointment(
      id,
      appointmentId,
      req.user.userId,
    );
  }

  //! DÉCONNECTER UN MOODBOARD D'UN RDV ✅
  @Delete(':id/disconnect/:appointmentId')
  disconnectFromAppointment(
    @Param('id') id: string,
    @Param('appointmentId') appointmentId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.moodboardService.disconnectFromAppointment(
      id,
      appointmentId,
      req.user.userId,
    );
  }

  //! ─── ACCÈS SALON ──────────────────────────────────────────────────────────

  //! VOIR LE MOODBOARD D'UN RDV (accès salon) ✅
  @Get('appointment/:appointmentId')
  getMoodboardByAppointment(
    @Param('appointmentId') appointmentId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.moodboardService.getMoodboardByAppointment(
      appointmentId,
      req.user.userId,
    );
  }
}
