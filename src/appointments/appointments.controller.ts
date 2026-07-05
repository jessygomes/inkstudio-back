import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
// import { SaasLimitGuard } from 'src/saas/saas-limit.guard';
// import { SaasLimit } from 'src/saas/saas-limit.decorator';
import { SendCustomEmailDto } from './dto/send-custom-email.dto';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { CreateAppointmentConsumableDto } from './dto/create-appointment-consumable.dto';
import { UpdateAppointmentConsumableDto } from './dto/update-appointment-consumable.dto';
import { SearchAppointmentConsumablesDto } from './dto/search-appointment-consumables.dto';
import {
  CreateAppointmentByClientRequestDto,
  CreateAppointmentByClientResponse,
} from './dto/create-appointment-by-client.dto';

@ApiTags('Appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  //! CREER UN RDV ✅
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Créer un RDV (salon authentifié)' })
  @ApiResponse({ status: 201, description: 'RDV créé avec succès.' })
  @ApiResponse({ status: 401, description: 'Non authentifié.' })
  @UseGuards(JwtAuthGuard)
  @Post()
  // @SaasLimit('appointment')
  async create(@Request() req: RequestWithUser, @Body() rdvBody: CreateAppointmentDto) {
    const userId = req.user.userId; // Permettre aussi de passer userId dans le body pour les RDV clients
    return await this.appointmentsService.create({userId, rdvBody });
  }

  @ApiOperation({ summary: 'Créer un RDV via le parcours client (sans auth)' })
  @ApiResponse({ status: 201, description: 'RDV créé (PENDING ou CONFIRMED selon le salon).' })
  @ApiResponse({
    status: 200,
    description: 'Erreur métier — code LINKED_BOOKING_REDIRECT: tatoueur réservable uniquement via son profil direct.',
    schema: {
      example: {
        error: true,
        code: 'LINKED_BOOKING_REDIRECT',
        message: "La reservation client avec ce tatoueur n'est plus disponible depuis le profil du salon.",
        performerUserId: 'linked-user-id',
      },
    },
  })
  @Post('by-client')
  async createByClient(
    @Body() body: CreateAppointmentByClientRequestDto,
  ): Promise<CreateAppointmentByClientResponse> {
    const userId = body.userId ?? body.salonId;
    const { rdvBody, clientUserId } = body;
    const resolvedClientUserId = clientUserId ?? rdvBody?.clientUserId;
    
    return await this.appointmentsService.createByClient({
      userId,
      rdvBody,
      clientUserId: resolvedClientUserId,
    });
  }

  //! VOIR TOUS LES RDV ✅
  // @Get()
  // async getAllAppointments(@Param('id') userId: string) {
  //   return await this.appointmentsService.getAllAppointments(userId);
  // }

  //! VOIR TOUS LES RDV PAR DATE ✅
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'RDV par plage de dates (paginé)' })
  @ApiQuery({ name: 'start', required: true, example: '2026-01-01' })
  @ApiQuery({ name: 'end', required: true, example: '2026-01-31' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 5 })
  @ApiResponse({ status: 200, description: 'Liste paginée des RDV.' })
  @ApiResponse({ status: 401, description: 'Non authentifié.' })
  @UseGuards(JwtAuthGuard)
  @Get('range')
  async getByDateRange(
    @Request() req: RequestWithUser,
    @Query('start') start: string,
    @Query('end') end: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const userId = req.user.userId; // ✅ source de vérité
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 5;
    return this.appointmentsService.getAppointmentsByDateRange(userId, start, end, pageNumber, limitNumber);
  }

  //! VOIR TOUS LES RDV D'UN SALON AVEC PAGINATION ✅
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Tous les RDV du salon authentifié (paginé, filtrable)' })
  @ApiResponse({ status: 200, description: 'Liste paginée des RDV.' })
  @ApiResponse({ status: 401, description: 'Non authentifié.' })
  @ApiResponse({ status: 403, description: 'Accès interdit — l\'id ne correspond pas au salon connecté.' })
  @UseGuards(JwtAuthGuard)
  @Get('salon/:id')
  async getAllAppointmentsBySalon(
    @Request() req: RequestWithUser,
    @Param('id') salonId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('period') period?: 'upcoming' | 'past',
    @Query('tatoueurId') tatoueurId?: string,
    @Query('prestation') prestation?: string,
    @Query('search') search?: string
  ) {
    const authenticatedUserId = req.user.userId;
    if (salonId !== authenticatedUserId) {
      throw new ForbiddenException('Accès interdit à ce salon.');
    }

    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 5;
    return await this.appointmentsService.getAllAppointmentsBySalon(
      authenticatedUserId,
      pageNumber, 
      limitNumber,
      status,
      period,
      tatoueurId,
      prestation,
      search
    );
  }

  //! RECUPERER LES RDV D'UN SALON PAR PLAGE DE DATES ✅
  @ApiOperation({ summary: 'RDV du salon sur une plage de dates (agenda public + auth)' })
  @ApiQuery({ name: 'start', required: true, example: '2026-01-01' })
  @ApiQuery({ name: 'end', required: true, example: '2026-01-31' })
  @ApiResponse({ status: 200, description: 'Liste des RDV sur la plage. En mode public: start/end uniquement.' })
  @ApiResponse({ status: 403, description: 'Accès interdit.' })
  @Get('salon/:id/range')
  async getAppointmentsBySalonRange(
    @Request() req: { user?: { userId?: string } },
    @Param('id') salonId: string,
    @Query('start') start: string,
    @Query('end') end: string
  ) {
    const authenticatedUserId = req.user?.userId;

    if (authenticatedUserId && salonId !== authenticatedUserId) {
      throw new ForbiddenException('Accès interdit à ce salon.');
    }

    const appointments = await this.appointmentsService.getAppointmentsBySalonRange(salonId, start, end);

    // Cote public (sans JWT), on expose uniquement les bornes des créneaux occupés.
    if (!authenticatedUserId && Array.isArray(appointments)) {
      return appointments.map((appointment) => ({
        start: appointment.start,
        end: appointment.end,
      }));
    }

    return appointments;
  }

  //! VOIR LES RDV DU JOUR POUR DASHBOARD ✅
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'RDV du jour (ou d\'une date) pour le dashboard' })
  @ApiQuery({ name: 'date', required: false, example: '2026-06-17', description: 'Date cible (YYYY-MM-DD). Défaut: aujourd\'hui.' })
  @ApiResponse({ status: 200, description: 'RDV de la journée.' })
  @UseGuards(JwtAuthGuard)
  @Get('today')
  async getTodaysAppointments(
    @Request() req: RequestWithUser,
    @Query('date') targetDate?: string
  ) {
    const userId = req.user.userId;
    return await this.appointmentsService.getTodaysAppointments(userId, targetDate);
  }

  //! Récupérer tous les RDV du client connecté
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'RDV du client connecté' })
  @ApiQuery({ name: 'status', required: false, example: 'CONFIRMED' })
  @ApiResponse({ status: 200, description: 'Liste paginée des RDV du client.' })
  @UseGuards(JwtAuthGuard)
  @Get('rdv-client')
  async getAllRdvForClient(
    @Request() req: RequestWithUser,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const appointmentsService = this.appointmentsService as {
      getAllRdvForClient: (params: {
        userId: string;
        status?: string;
        page?: number;
        limit?: number;
      }) => Promise<Record<string, any>>;
    };
    const userId = req.user.userId;
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;

    return await appointmentsService.getAllRdvForClient({
      userId,
      status,
      page: pageNumber,
      limit: limitNumber,
    });
  }

  @ApiOperation({ summary: 'Teintes de peau disponibles pour les RDV tattoo' })
  @ApiResponse({ status: 200, description: 'Liste des teintes de peau.' })
  @Get('skin-tones')
  getSkinTones() {
    return this.appointmentsService.getSkinTones();
  }

  //! TAUX DE REMPLISSAGE DES CRENEAUX PAR SEMAINE ✅
  @UseGuards(JwtAuthGuard)
  @Get('weekly-fill-rate')
  async getWeeklyFillRate(
    @Request() req: RequestWithUser,
    @Query('start') start: string,
    @Query('end') end: string
  ) {
    const userId = req.user.userId;
    return await this.appointmentsService.getWeeklyFillRate(userId, start, end);
  }

  //! TAUX D'ANNULATION DES RDV ✅
  @UseGuards(JwtAuthGuard)
  @Get('cancellation-rate')
  async getGlobalCancellationRate(@Request() req: RequestWithUser) {
    const userId = req.user.userId;
    return await this.appointmentsService.getGlobalCancellationRate(userId);
  }

  //! TOTAL DES RDV PAYES PAR MOIS ✅
  @UseGuards(JwtAuthGuard)
  @Get('monthly-paid-appointments')
  async getMonthlyPaidAppointments(
    @Request() req: RequestWithUser,
    @Query('month') month: number,
    @Query('year') year: number
  ) {
    const userId = req.user.userId;
    return await this.appointmentsService.getTotalPaidAppointmentsByMonth(userId, month, year);
  }

  // //! SOMME DES PRIX DES RDV PAYES PAR MOIS ✅
  // @UseGuards(JwtAuthGuard)
  // @Get('total-paid-appointments')
  // async getTotalPaidAppointments(
  //   @Request() req: RequestWithUser,
  //   @Query('month') month: number,
  //   @Query('year') year: number
  // ) {
  //   const userId = req.user.userId;
  //   return await this.appointmentsService.getTotalPaidAppointmentsByMonth(userId, month, year);
  // }

  //! RDV EN ATTENTE DE CONFIRMATION ✅
  @UseGuards(JwtAuthGuard)
  @Get('pending-confirmation')
  async getPendingConfirmationAppointments(@Request() req: RequestWithUser) {
    const userId = req.user.userId;
    return await this.appointmentsService.getPendingAppointments(userId);
  }

  //! RECUPERER LES RDV D'UN TATOUEUR PAR DATE ✅
  @Get('tatoueur-range')
  async getAppointmentsByTatoueurRange(
    @Query('tatoueurId') tatoueurId: string,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.appointmentsService.getAppointmentsByTatoueurRange(tatoueurId, start, end);
  }

  //! VOIR UN SEUL RDV ✅
  @Get(':id')
  async getOneAppointment(@Param('id') appointmentId: string) {
    return await this.appointmentsService.getOneAppointment(appointmentId);
  }

  //! SUPPRIMER UN RDV ✅
  @UseGuards(JwtAuthGuard)
  @Delete('delete/:id')
  async deleteAppointment(@Param('id') appointmentId: string) {
    return await this.appointmentsService.deleteAppointment(appointmentId);
  }

  //! MODIFIER UN RDV ✅
  @UseGuards(JwtAuthGuard)
  @Patch('update/:id')
  async updateAppointment(@Param('id') appointmentId: string, @Body() rdvBody: UpdateAppointmentDto) {
    console.log('Updating appointment with ID:', appointmentId, 'and body:', rdvBody);
    return await this.appointmentsService.updateAppointment(appointmentId, rdvBody);
  }

  //! MODIFIER UN RDV PAR LE CLIENT ✅
  @UseGuards(JwtAuthGuard)
  @Patch('client-update/:id')
  async updateAppointmentByClient(
    @Request() req: RequestWithUser,
    @Param('id') appointmentId: string,
    @Body() rdvBody: UpdateAppointmentDto
  ) {
    const userId = req.user.userId;
    return await this.appointmentsService.updateAppointmentByClient(appointmentId, userId, rdvBody);
  }

  //! CONFIRMER UN RDV ✅
  @UseGuards(JwtAuthGuard)
  @Patch('confirm/:id')
  async confirmAppointment(@Param('id') appointmentId: string, @Body() message: { message: string }) {
    return await this.appointmentsService.confirmAppointment(appointmentId, message.message);
  }

  //! COMPLETER UN RDV ✅
  @UseGuards(JwtAuthGuard)
  @Patch('change-status/:id')
  async changeAppointmentStatus(@Param('id') appointmentId: string, @Body() statusBody: { status: 'COMPLETED' | 'NO_SHOW' } | 'COMPLETED' | 'NO_SHOW') {
    return await this.appointmentsService.changeAppointmentStatus(appointmentId, statusBody);
  }

  //! ANNULER UN RDV ✅
  @UseGuards(JwtAuthGuard)
  @Patch('cancel/:id')
  async cancelAppointment(@Param('id') appointmentId: string, @Body() message: { message: string }) {
    return await this.appointmentsService.cancelAppointment(appointmentId, message.message);
  }

  //! ANNULER UN RDV PAR LE CLIENT ✅
  @UseGuards(JwtAuthGuard)
  @Patch('client-cancel/:id')
  async cancelAppointmentByClient(
    @Request() req: RequestWithUser, 
    @Param('id') appointmentId: string,
    @Body() body: { reason?: string }
  ) {
    const clientUserId = req.user.userId;
    return await this.appointmentsService.cancelAppointmentByClient(appointmentId, clientUserId, body.reason);
  }

  //! RDV PAYE ✅
  @UseGuards(JwtAuthGuard)
  @Patch('payed/:id')
  async markAppointmentAsPaid(@Param('id') appointmentId: string, @Body() body: { isPayed: boolean }) {
    return await this.appointmentsService.markAppointmentAsPaid(appointmentId, body.isPayed);
  }

  //! VOIR TOUS LES RDV D'UN TATOUEUR ✅
  @Get('tatoueur/:id')
  async getAppointmentsByTatoueurId(@Param('id') tatoueurId: string) {
    return await this.appointmentsService.getTatoueurAppointments(tatoueurId);
  }

  //! CONSOMMABLES - AJOUTER UN CONSOMMABLE A UN RDV
  @UseGuards(JwtAuthGuard)
  @Post(':appointmentId/consumables')
  async createAppointmentConsumable(
    @Request() req: RequestWithUser,
    @Param('appointmentId') appointmentId: string,
    @Body() dto: CreateAppointmentConsumableDto,
  ) {
    return this.appointmentsService.createAppointmentConsumable(
      appointmentId,
      req.user.userId,
      dto,
    );
  }

  //! CONSOMMABLES - LISTER LES CONSOMMABLES D'UN RDV
  @UseGuards(JwtAuthGuard)
  @Get(':appointmentId/consumables')
  async getAppointmentConsumables(
    @Request() req: RequestWithUser,
    @Param('appointmentId') appointmentId: string,
  ) {
    return this.appointmentsService.getAppointmentConsumables(appointmentId, req.user.userId);
  }

  //! CONSOMMABLES - RECHERCHE PAR LOT/REFERENCE/DATE
  @UseGuards(JwtAuthGuard)
  @Get('consumables/search')
  async searchAppointmentConsumables(
    @Request() req: RequestWithUser,
    @Query() query: SearchAppointmentConsumablesDto,
  ) {
    return this.appointmentsService.searchAppointmentConsumables(req.user.userId, query);
  }

  //! CONSOMMABLES - MODIFIER UN CONSOMMABLE
  @UseGuards(JwtAuthGuard)
  @Patch(':appointmentId/consumables/:consumableId')
  async updateAppointmentConsumable(
    @Request() req: RequestWithUser,
    @Param('appointmentId') appointmentId: string,
    @Param('consumableId') consumableId: string,
    @Body() dto: UpdateAppointmentConsumableDto,
  ) {
    return this.appointmentsService.updateAppointmentConsumable(
      appointmentId,
      consumableId,
      req.user.userId,
      dto,
    );
  }

  //! CONSOMMABLES - SUPPRIMER UN CONSOMMABLE
  @UseGuards(JwtAuthGuard)
  @Delete(':appointmentId/consumables/:consumableId')
  async deleteAppointmentConsumable(
    @Request() req: RequestWithUser,
    @Param('appointmentId') appointmentId: string,
    @Param('consumableId') consumableId: string,
  ) {
    return this.appointmentsService.deleteAppointmentConsumable(
      appointmentId,
      consumableId,
      req.user.userId,
    );
  }

  //! ENVOYER UN EMAIL PERSONNALISÉ À UN CLIENT ✅
  @UseGuards(JwtAuthGuard)
  @Post('send-custom-email/:appointmentId')
  async sendCustomEmail(
    @Param('appointmentId') appointmentId: string,
    @Body() emailData: SendCustomEmailDto
  ) {
    const { subject, message } = emailData;
    return await this.appointmentsService.sendCustomEmail(appointmentId, subject, message);
  }
}
