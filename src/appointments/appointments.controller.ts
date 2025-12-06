import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { ProposeRescheduleDto, ClientRescheduleRequestDto } from './dto/reschedule-appointment.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
// import { SaasLimitGuard } from 'src/saas/saas-limit.guard';
// import { SaasLimit } from 'src/saas/saas-limit.decorator';
import { CreateAppointmentRequestDto } from './dto/create-appointment-request.dto';
import { SendCustomEmailDto } from './dto/send-custom-email.dto';
import { RequestWithUser } from 'src/auth/jwt.strategy';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  //! CREER UN RDV ✅
  @UseGuards(JwtAuthGuard)
  @Post()
  // @SaasLimit('appointment')
  async create(@Request() req: RequestWithUser, @Body() rdvBody: CreateAppointmentDto) {
    const userId = req.user.userId; // Permettre aussi de passer userId dans le body pour les RDV clients
    return await this.appointmentsService.create({userId, rdvBody });
  }

  @Post('by-client')
  async createByClient(@Body() body: { userId: string; rdvBody: CreateAppointmentDto }) {
    console.log('Creating appointment by client with body:', body);
    const { userId, rdvBody } = body;
    console.log('User ID:', userId);
    console.log('RDV Body:', rdvBody);
    return await this.appointmentsService.createByClient({ userId, rdvBody });
  }

  //! DEMANDE DE RDV CLIENT
  @Post('appointment-request')
  async createAppointmentRequest(@Body() dto: CreateAppointmentRequestDto) {
    return await this.appointmentsService.createAppointmentRequest(dto);
  }

  //! VOIR TOUS LES RDV ✅
  @Get()
  async getAllAppointments(@Param('id') userId: string) {
    return await this.appointmentsService.getAllAppointments(userId);
  }

  //! VOIR TOUS LES RDV PAR DATE ✅
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
  @UseGuards(JwtAuthGuard)
  @Get('salon/:id')
  async getAllAppointmentsBySalon(
    @Param('id') salonId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 5;
    return await this.appointmentsService.getAllAppointmentsBySalon(salonId, pageNumber, limitNumber);
  }

  //! VOIR LES RDV DU JOUR POUR DASHBOARD ✅
  @UseGuards(JwtAuthGuard)
  @Get('today')
  async getTodaysAppointments(
    @Request() req: RequestWithUser,
    @Query('date') targetDate?: string
  ) {
    const userId = req.user.userId;
    return await this.appointmentsService.getTodaysAppointments(userId, targetDate);
  }

  //! VOIR LES DEMANDES DE RDV D'UN SALON ✅
  @UseGuards(JwtAuthGuard)
  @Get('appointment-requests')
  async getAppointmentRequests(
  @Request() req: RequestWithUser,
  @Query('page') page?: string,
  @Query('limit') limit?: string,
  @Query('status') status?: string,
  ) {
    const userId = req.user.userId;
    return await this.appointmentsService.getAppointmentRequestsBySalon( userId, Number(page) || 1, Number(limit) || 10, status);
  }

  //! RECUPERER LES DEMANDES DE RDV D'UN SALON (tous sauf les CONFIRMER)
  @UseGuards(JwtAuthGuard)
  @Get('appointment-requests/not-confirmed')
  async getPendingAppointmentRequests(@Request() req: RequestWithUser) {
    const userId = req.user.userId;
    return await this.appointmentsService.getAppointmentRequestsBySalonNotConfirmed(userId);
  }

  //! RECUPERER LE NOMBRE DE DEMANDE EN ATTENTE
  @Get('appointment-requests/not-confirmed/count/:userId')
  async getPendingAppointmentRequestsCount(@Param('userId') userId: string) {
    return await this.appointmentsService.getPendingAppointmentRequestsCount(userId);
  }

  //! PROPOSER UN CRENEAU POUR UNE DEMANDE DE RDV CLIENT
  // @UseGuards(JwtAuthGuard)
  // @Post('appointment-request/propose-slot/:requestId')
  // async proposeSlotForAppointmentRequest(
  //   @Param('requestId') requestId: string,
  //   @Body() body: { slots: Array<{ from: Date; to: Date; tatoueurId?: string }>, message?: string }
  // ) {
  //   // Les dates sont envoyées en string, à convertir en Date
  //   const { slots, message } = body;
  //   if (!slots || slots.length === 0) {
  //     throw new Error('At least one slot is required.');
  //   }

  //   const normalized = slots.map(s => ({
  //     from: new Date(s.from),
  //     to: new Date(s.to),
  //     tatoueurId: s.tatoueurId,
  //   }));

  //   return await this.appointmentsService.proposeSlotForAppointmentRequest(
  //     requestId,
  //     normalized,
  //     message,
  //   );
  // }

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

  //! PROPOSER UNE REPROGRAMMATION DE RDV ✅
  @UseGuards(JwtAuthGuard)
  @Post('propose-reschedule')
  async proposeReschedule(
    @Request() req: RequestWithUser,
    @Body() proposeData: ProposeRescheduleDto
  ) {
    console.log('Proposing reschedule with data:', proposeData); 
    const userId = req.user.userId;
    return await this.appointmentsService.proposeReschedule(proposeData, userId);
  }

  //! VALIDER TOKEN DE REPROGRAMMATION ✅
  @Get('validate-reschedule-token/:token')
  async validateRescheduleToken(@Param('token') token: string) {
    return await this.appointmentsService.validateRescheduleToken(token);
  }

  //! RÉPONSE CLIENT POUR REPROGRAMMATION ✅
  @Post('client-reschedule-response')
  async handleClientRescheduleRequest(@Body() rescheduleData: ClientRescheduleRequestDto) {
    return await this.appointmentsService.handleClientRescheduleRequest(rescheduleData);
  }

  // //! VALIDER TOKEN DE DEMANDE
  // @Get('validate-appointment-request-token/:token')
  // async validateAppointmentRequestToken(@Param('token') token: string) {
  //   return await this.appointmentsService.validateAppointmentRequestToken(token);
  // }

  // //! REPONSE CLIENT POUR DEMANDE DE RDV (ACCEPTER OU DECLINER)
  // @Post('appointment-request-response')
  // async handleAppointmentRequestResponse(@Body() body: { token: string; action: 'accept' | 'decline'; slotId: string; reason?: string }) {
  //   const { token, action, slotId, reason } = body;
  //   return await this.appointmentsService.handleAppointmentRequestResponse(token, action, slotId, reason);
  // }
  
  // //! SALON : REFUSER LA DEMANDE DE RDV D'UN CLIENT
  // @UseGuards(JwtAuthGuard)
  // @Patch('decline-appointment-request')
  // async declineAppointmentRequest(@Body() body: { appointmentRequestId: string; reason: string }) {
  //   const { appointmentRequestId, reason } = body;
  //   return await this.appointmentsService.declineAppointmentRequest(appointmentRequestId, reason);
  // }

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
