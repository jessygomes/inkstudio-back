import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { ProposeRescheduleDto, ClientRescheduleRequestDto } from './dto/reschedule-appointment.dto';
// import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
// import { SaasLimitGuard } from 'src/saas/saas-limit.guard';
import { SaasLimit } from 'src/saas/saas-limit.decorator';
import { CreateAppointmentRequestDto } from './dto/create-appointment-request.dto';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  //! CREER UN RDV ✅
  @Post()
  // @UseGuards(SaasLimitGuard)
  @SaasLimit('appointment')
  async create(@Body() rdvBody: CreateAppointmentDto) {
    return await this.appointmentsService.create({ rdvBody });
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
  // @UseGuards(JwtAuthGuard)
  @Get('range')
  async getByDateRange(
    @Query('userId') userId: string,
    @Query('start') start: string,
    @Query('end') end: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 5;
    return this.appointmentsService.getAppointmentsByDateRange(userId, start, end, pageNumber, limitNumber);
  }

  //! VOIR TOUS LES RDV D'UN SALON AVEC PAGINATION ✅
  // @UseGuards(JwtAuthGuard)
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
  // @UseGuards(JwtAuthGuard) // Temporairement commenté pour debug
  @Get('today/:id')
  async getTodaysAppointments(
    @Param('id') userId: string,
    @Query('date') targetDate?: string
  ) {
    return await this.appointmentsService.getTodaysAppointments(userId, targetDate);
  }

  //! VOIR LES DEMANDES DE RDV D'UN SALON ✅
  @Get('appointment-requests/:userId')
  async getAppointmentRequests(@Param('userId') userId: string) {
    return await this.appointmentsService.getAppointmentRequestsBySalon(userId);
  }

  //! PROPOSER UN CRENEAU POUR UNE DEMANDE DE RDV CLIENT
  @Post('appointment-request/propose-slot/:requestId')
  async proposeSlotForAppointmentRequest(
    @Param('requestId') requestId: string,
    @Body() body: { proposedDate: string; proposedFrom: string; proposedTo: string, tatoueurId?: string, message?: string }
  ) {
    // Les dates sont envoyées en string, à convertir en Date
    const { proposedDate, proposedFrom, proposedTo, tatoueurId, message } = body;
    if (!proposedDate || !proposedFrom || !proposedTo) {
      throw new Error('All date fields (proposedDate, proposedFrom, proposedTo) are required.');
    }
    return await this.appointmentsService.proposeSlotForAppointmentRequest(
      requestId,
      new Date(proposedDate),
      new Date(proposedFrom),
      new Date(proposedTo),
      tatoueurId,
      message
    );
  }

  //! TAUX DE REMPLISSAGE DES CRENAUX PAR SEMAINE ✅
  // @UseGuards(JwtAuthGuard) // Temporairement commenté pour debug
  @Get('weekly-fill-rate/:id')
  async getWeeklyFillRate(
    @Param('id') userId: string,
    @Query('start') start: string,
    @Query('end') end: string
  ) {
    return await this.appointmentsService.getWeeklyFillRate(userId, start, end);
  }

  //! TAUX D'ANNULATION DES RDV ✅
  @Get('cancellation-rate/:id')
  async getGlobalCancellationRate(@Param('id') userId: string) {
    return await this.appointmentsService.getGlobalCancellationRate(userId);
  }

  //! TOTAL DES RDV PAYES PAR MOIS ✅
  @Get('monthly-paid-appointments/:id')
  async getMonthlyPaidAppointments(
    @Param('id') userId: string,
    @Query('month') month: number,
    @Query('year') year: number
  ) {
    return await this.appointmentsService.getTotalPaidAppointmentsByMonth(userId, month, year);
  }

  //! SOMME DES PRIX DES RDV PAYES PAR MOIS ✅
  @Get('total-paid-appointments/:id')
  async getTotalPaidAppointments(
    @Param('id') userId: string,
    @Query('month') month: number,
    @Query('year') year: number
  ) {
    return await this.appointmentsService.getTotalPaidAppointmentsByMonth(userId, month, year);
  }

  //! RDV EN ATTENTE DE CONFIRMATION ✅
  @Get('pending-confirmation/:id')
  async getPendingConfirmationAppointments(@Param('id') userId: string) {
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
  @Delete('delete/:id')
  async deleteAppointment(@Param('id') appointmentId: string) {
    return await this.appointmentsService.deleteAppointment(appointmentId);
  }

  //! MODIFIER UN RDV ✅
  @Patch('update/:id')
  async updateAppointment(@Param('id') appointmentId: string, @Body() rdvBody: UpdateAppointmentDto) {
    return await this.appointmentsService.updateAppointment(appointmentId, rdvBody);
  }

  //! CONFIRMER UN RDV ✅
  @Patch('confirm/:id')
  async confirmAppointment(@Param('id') appointmentId: string, @Body() message: { message: string }) {
    return await this.appointmentsService.confirmAppointment(appointmentId, message.message);
  }

  //! ANNULER UN RDV ✅
  @Patch('cancel/:id')
  async cancelAppointment(@Param('id') appointmentId: string, @Body() message: { message: string }) {
    return await this.appointmentsService.cancelAppointment(appointmentId, message.message);
  }

  //! RDV PAYE ✅
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
  // @UseGuards(JwtAuthGuard) // À décommenter quand l'auth sera activée
  @Post('propose-reschedule/:userId')
  async proposeReschedule(
    @Param('userId') userId: string,
    @Body() proposeData: ProposeRescheduleDto
  ) {
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

  //! VALIDER TOKEN DE DEMANDE
  @Get('validate-appointment-request-token/:token')
  async validateAppointmentRequestToken(@Param('token') token: string) {
    return await this.appointmentsService.validateAppointmentRequestToken(token);
  }

  //! REPONSE CLIENT POUR DEMANDE DE RDV (ACCEPTER OU DECLINER)
  @Post('appointment-request-response')
  async handleAppointmentRequestResponse(@Body() body: { token: string; action: 'accept' | 'decline'; reason?: string }) {
    const { token, action, reason } = body;
    return await this.appointmentsService.handleAppointmentRequestResponse(token, action, reason);
  }
}
