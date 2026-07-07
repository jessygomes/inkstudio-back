import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { TatoueursService } from './tatoueurs.service';
import { CreateTatoueurDto } from './dto/create-tatoueur.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { CreateTeamRequestDto } from './dto/create-team-request.dto';
import { RespondTeamRequestDto } from './dto/respond-team-request.dto';
import { UpdateLinkedTatoueurAppointmentBookingDto } from './dto/update-linked-tatoueur-appointment-booking.dto';
import { UpdateSalonLinkedPermissionDto } from './dto/update-salon-linked-permission.dto';

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

  //! LISTER LES SALONS RELIES AU TATOUEUR USER
  @UseGuards(JwtAuthGuard)
  @Get('team-requests/linked-salons')
  getLinkedSalons(@Request() req: RequestWithUser) {
    return this.tatoueursService.getLinkedSalons({
      tatoueurUserId: req.user.userId,
      tatoueurRole: req.user.role,
    });
  }

  //! RETIRER UN TATOUEUR USER RELIE DE L'EQUIPE
  @UseGuards(JwtAuthGuard)
  @Delete('team-requests/linked/:tatoueurUserId')
  unlinkLinkedTatoueur(
    @Request() req: RequestWithUser,
    @Param('tatoueurUserId') tatoueurUserId: string,
  ) {
    return this.tatoueursService.unlinkLinkedTatoueur({
      salonUserId: req.user.userId,
      salonRole: req.user.role,
      tatoueurUserId,
    });
  }

  //! AUTORISER OU NON UN TATOUEUR RELIE A PRENDRE DES RDV
  @UseGuards(JwtAuthGuard)
  @Patch('team-requests/linked/:tatoueurUserId/appointment-booking')
  updateLinkedTatoueurAppointmentBooking(
    @Request() req: RequestWithUser,
    @Param('tatoueurUserId') tatoueurUserId: string,
    @Body() body: UpdateLinkedTatoueurAppointmentBookingDto,
  ) {
    return this.tatoueursService.updateLinkedTatoueurAppointmentBooking({
      salonUserId: req.user.userId,
      salonRole: req.user.role,
      tatoueurUserId,
      appointmentBookingEnabled: body.appointmentBookingEnabled,
    });
  }

  //! RETIRER SON PROPRE COMPTE TATOUEUR DE SON SALON ACTUEL
  @UseGuards(JwtAuthGuard)
  @Delete('team-requests/linked/me/leave')
  leaveCurrentSalon(@Request() req: RequestWithUser) {
    return this.tatoueursService.leaveCurrentSalon({
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
      allowSalonAgendaAccess: body.allowSalonAgendaAccess,
      allowSalonCreateAppointments: body.allowSalonCreateAppointments,
    });
  }

  /**
   * PATCH /team-requests/permissions/agenda-access
   * 
   * Route contrôlée par le user_tatoueur pour autoriser/refuser au user_salon lié
   * la possibilité de voir son agenda et ses RDV.
   * 
   * Authentification : JwtAuthGuard (user_tatoueur uniquement)
   * 
   * Logique :
   * 1. Vérifie que l'appelant est un user_tatoueur lié à un salon
   * 2. Met à jour User.salonCanViewAppointments
   * 3. Invalide le cache des RDV du salon et les données du tatoueur
   * 
   * @param req Requête HTTP avec user context (JwtAuthGuard)
   * @param body UpdateSalonLinkedPermissionDto { enabled: boolean }
   * @returns Message de succès/erreur + permissions mises à jour
   */
  @UseGuards(JwtAuthGuard)
  @Patch('team-requests/permissions/agenda-access')
  updateSalonAgendaAccessPermission(
    @Request() req: RequestWithUser,
    @Body() body: UpdateSalonLinkedPermissionDto,
  ) {
    return this.tatoueursService.updateSalonAgendaAccessPermission({
      tatoueurUserId: req.user.userId,
      tatoueurRole: req.user.role,
      enabled: body.enabled,
    });
  }

  /**
   * PATCH /team-requests/permissions/salon-appointment-creation
   * 
   * Route contrôlée par le user_tatoueur pour autoriser/refuser au user_salon lié
   * la possibilité de créer des RDV pour ce tatoueur.
   * 
   * Authentification : JwtAuthGuard (user_tatoueur uniquement)
   * 
   * Logique :
   * 1. Vérifie que l'appelant est un user_tatoueur lié à un salon
   * 2. Met à jour User.salonCanCreateAppointments
   * 3. Invalide le cache de gestion des RDV du salon
   * 
   * @param req Requête HTTP avec user context (JwtAuthGuard)
   * @param body UpdateSalonLinkedPermissionDto { enabled: boolean }
   * @returns Message de succès/erreur + permissions mises à jour
   */
  @UseGuards(JwtAuthGuard)
  @Patch('team-requests/permissions/salon-appointment-creation')
  updateSalonAppointmentCreationPermission(
    @Request() req: RequestWithUser,
    @Body() body: UpdateSalonLinkedPermissionDto,
  ) {
    return this.tatoueursService.updateSalonAppointmentCreationPermission({
      tatoueurUserId: req.user.userId,
      tatoueurRole: req.user.role,
      enabled: body.enabled,
    });
  }

  //! RECUPERER SES PERMISSIONS ACTUELLES
  @UseGuards(JwtAuthGuard)
  @Get('team-requests/permissions/current')
  getCurrentPermissions(@Request() req: RequestWithUser) {
    return this.tatoueursService.getCurrentPermissions({
      tatoueurUserId: req.user.userId,
      tatoueurRole: req.user.role,
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
  updateTatoueur(@Request() req: RequestWithUser, @Param('id') id: string, @Body() tatoueurBody: CreateTatoueurDto) {
    const userId = req.user.userId;
    return this.tatoueursService.updateTatoueur(id, tatoueurBody, userId);
  }

  //! SUPPRIMER UN TATOUEUR ✅
  @UseGuards(JwtAuthGuard)
  @Delete('delete/:id')
  deleteTatoueur(@Request() req: RequestWithUser, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.tatoueursService.deleteTatoueur(id, userId);
  }
}
