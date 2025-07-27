/* eslint-disable prettier/prettier */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  //! CREER UN RDV ✅
  @Post()
  async create(@Body() rdvBody: CreateAppointmentDto) {

    return await this.appointmentsService.create({ rdvBody });
  }

  //! VOIR TOUS LES RDV ✅
  @Get()
  async getAllAppointments(@Param('id') userId: string) {
    return await this.appointmentsService.getAllAppointments(userId);
  }

    //! VOIR TOUS LES RDV PAR DATE ✅
  @Get('range')
  async getByDateRange(
    @Query('userId') userId: string,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.appointmentsService.getAppointmentsByDateRange(userId, start, end);
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
  async confirmAppointment(@Param('id') appointmentId: string) {
    return await this.appointmentsService.confirmAppointment(appointmentId);
  }

  //! ANNULER UN RDV ✅
  @Patch('cancel/:id')
  async cancelAppointment(@Param('id') appointmentId: string) {
    return await this.appointmentsService.cancelAppointment(appointmentId);
  }

  //! VOIR TOUS LES RDV D'UN TATOUEUR ✅
  @Get('tatoueur/:id')
  async getAppointmentsByTatoueurId(@Param('id') tatoueurId: string) {
    return await this.appointmentsService.getTatoueurAppointments(tatoueurId);
  }
}
