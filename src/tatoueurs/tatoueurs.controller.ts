import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { TatoueursService } from './tatoueurs.service';
import { CreateTatoueurDto } from './dto/create-tatoueur.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { CreateTeamRequestDto } from './dto/create-team-request.dto';
import { RespondTeamRequestDto } from './dto/respond-team-request.dto';

@Controller('tatoueurs')
export class TatoueursController {
  constructor(private readonly tatoueursService: TatoueursService) {}

  //! CREER UN TATOUEUR ✅
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Request() req: RequestWithUser, @Body() tatoueurBody: CreateTatoueurDto) {
    const userId = req.user.userId;
    return this.tatoueursService.create({ tatoueurBody, userId });
  }

  //! RECHERCHER DES TATOUEURS USERS INSCRITS (pour invitation d'equipe)
  @UseGuards(JwtAuthGuard)
  @Get('team-requests/search')
  searchTatoueurUsers(@Request() req: RequestWithUser, @Query('q') q?: string) {
    return this.tatoueursService.searchTatoueurUsers({
      salonUserId: req.user.userId,
      salonRole: req.user.role,
      query: q,
    });
  }

  //! ENVOYER UNE DEMANDE D'INTEGRATION A UN TATOUEUR INSCRIT
  @UseGuards(JwtAuthGuard)
  @Post('team-requests')
  createTeamRequest(@Request() req: RequestWithUser, @Body() body: CreateTeamRequestDto) {
    return this.tatoueursService.createTeamRequest({
      salonUserId: req.user.userId,
      salonRole: req.user.role,
      body,
    });
  }

  //! LISTER LES DEMANDES ENVOYEES PAR LE SALON
  @UseGuards(JwtAuthGuard)
  @Get('team-requests/outgoing')
  getOutgoingTeamRequests(@Request() req: RequestWithUser) {
    return this.tatoueursService.getOutgoingTeamRequests({
      salonUserId: req.user.userId,
      salonRole: req.user.role,
    });
  }

  //! LISTER LES DEMANDES REÇUES PAR LE TATOUEUR USER
  @UseGuards(JwtAuthGuard)
  @Get('team-requests/incoming')
  getIncomingTeamRequests(@Request() req: RequestWithUser) {
    return this.tatoueursService.getIncomingTeamRequests({
      tatoueurUserId: req.user.userId,
      tatoueurRole: req.user.role,
    });
  }

  //! REPONDRE A UNE DEMANDE (accept/refuse)
  @UseGuards(JwtAuthGuard)
  @Patch('team-requests/:requestId/respond')
  respondToTeamRequest(
    @Request() req: RequestWithUser,
    @Param('requestId') requestId: string,
    @Body() body: RespondTeamRequestDto,
  ) {
    return this.tatoueursService.respondToTeamRequest({
      requestId,
      tatoueurUserId: req.user.userId,
      tatoueurRole: req.user.role,
      action: body.action,
    });
  }

  //! VOIR TOUS LES TATOUEURS ✅
  @Get()
  findAll() {
    return this.tatoueursService.getAllTatoueurs();
  }

  //! VOIR TOUS LES TATOUEURS PAR USER ID ✅
  @Get('user/:id')
  getTatoueurByUserId(@Param('id') id: string) {
    return this.tatoueursService.getTatoueurByUserId(id);
  }

    //! VOIR TOUS LES TATOUEURS PAR USER ID ✅
  @Get('for-appointment/:id')
  getTatoueurByUserIdForAppointment(@Param('id') id: string) {
    return this.tatoueursService.getTatoueurByUserIdForAppointment(id);
  }

  //! VOIR UN SEUL TATOUEUR ✅
  @Get(':id')
  getOneTatoueur(@Param('id') id: string) {
    return this.tatoueursService.getOneTatoueur(id);
  }

  //! MODIFIER UN TATOUEUR ✅
  @UseGuards(JwtAuthGuard)
  @Patch('update/:id')
  updateTatoueur(@Param('id') id: string, @Body() tatoueurBody: CreateTatoueurDto) {
    return this.tatoueursService.updateTatoueur(id, tatoueurBody);
  }

  //! SUPPRIMER UN TATOUEUR ✅
  @UseGuards(JwtAuthGuard)
  @Delete('delete/:id')
  deleteTatoueur(@Param('id') id: string) {
    return this.tatoueursService.deleteTatoueur(id);
  }
}
