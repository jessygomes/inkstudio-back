import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { CreateDrawingCardDto } from './dto/create-drawing-card.dto';
import { CreateDrawingCardNoteDto } from './dto/create-drawing-card-note.dto';
import { CreateDrawingCardImageDto } from './dto/create-drawing-card-image.dto';
import { UpdateDrawingCardImageDto } from './dto/update-drawing-card-image.dto';
import { SearchDrawingCardsDto } from './dto/search-drawing-cards.dto';
import { UpdateDrawingCardDto } from './dto/update-drawing-card.dto';
import { SuiviService } from './suivi.service';

// Préfixe distinct du suivi de cicatrisation, qui conserve ses propres routes.
@Controller('suiviDessin')
@UseGuards(JwtAuthGuard)
export class SuiviController {
  constructor(private readonly suiviService: SuiviService) {}

  // Affiche toutes les cards du tableau Suivi de l'utilisateur connecté.
  @Get('cards')
  getCards(@Request() req: RequestWithUser, @Query() query: SearchDrawingCardsDto) {
    return this.suiviService.getCards(req.user.userId, query);
  }

  // Vérifie si le RDV peut afficher l'action « Créer une card ».
  @Get('appointments/:appointmentId/card-status')
  getAppointmentCardStatus(@Param('appointmentId') appointmentId: string, @Request() req: RequestWithUser) {
    return this.suiviService.getAppointmentCardStatus(appointmentId, req.user.userId);
  }

  // Crée une card et préremplit ses informations depuis le rendez-vous source.
  @Post('cards')
  createCard(@Request() req: RequestWithUser, @Body() dto: CreateDrawingCardDto) {
    return this.suiviService.createCard(req.user.userId, dto);
  }

  // Modifie les informations ou déplace la card vers une autre colonne.
  @Patch('cards/:id')
  updateCard(@Param('id') id: string, @Request() req: RequestWithUser, @Body() dto: UpdateDrawingCardDto) {
    return this.suiviService.updateCard(id, req.user.userId, dto);
  }

  // Supprime définitivement une card et ses notes/images liées.
  @Delete('cards/:id')
  deleteCard(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.suiviService.deleteCard(id, req.user.userId);
  }

  // Ajoute une note à l'historique de la card.
  @Post('cards/:id/notes')
  addNote(@Param('id') id: string, @Request() req: RequestWithUser, @Body() dto: CreateDrawingCardNoteDto) {
    return this.suiviService.addNote(id, req.user.userId, dto);
  }

  // Ajoute une nouvelle image ou version au dessin.
  @Post('cards/:id/images')
  addImage(@Param('id') id: string, @Request() req: RequestWithUser, @Body() dto: CreateDrawingCardImageDto) {
    return this.suiviService.addImage(id, req.user.userId, dto);
  }

  // Définit l'image validée qui servira de référence au rendez-vous Tattoo.
  @Patch('cards/:id/images/:imageId/approve')
  approveImage(@Param('id') id: string, @Param('imageId') imageId: string, @Request() req: RequestWithUser) {
    return this.suiviService.approveImage(id, imageId, req.user.userId);
  }

  // Modifie uniquement la légende d'une version existante.
  @Patch('cards/:id/images/:imageId')
  updateImageCaption(@Param('id') id: string, @Param('imageId') imageId: string, @Request() req: RequestWithUser, @Body() dto: UpdateDrawingCardImageDto) {
    return this.suiviService.updateImageCaption(id, imageId, req.user.userId, dto);
  }

  // Supprime une version d'image appartenant à la card.
  @Delete('cards/:id/images/:imageId')
  deleteImage(@Param('id') id: string, @Param('imageId') imageId: string, @Request() req: RequestWithUser) {
    return this.suiviService.deleteImage(id, imageId, req.user.userId);
  }

  // Associe une card approuvée au rendez-vous Tattoo correspondant.
  @Post('cards/:cardId/tattoo-appointment/:appointmentId')
  linkTattooAppointment(
    @Param('cardId') cardId: string,
    @Param('appointmentId') appointmentId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.suiviService.linkTattooAppointment(cardId, appointmentId, req.user.userId);
  }
}
