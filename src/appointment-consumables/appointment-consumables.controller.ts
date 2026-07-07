import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { CreateAppointmentConsumableDto } from 'src/appointments/dto/create-appointment-consumable.dto';
import { SearchAppointmentConsumablesDto } from 'src/appointments/dto/search-appointment-consumables.dto';
import { UpdateAppointmentConsumableDto } from 'src/appointments/dto/update-appointment-consumable.dto';
import { AppointmentConsumablesService } from './appointment-consumables.service';

@Controller('appointments')
export class AppointmentConsumablesController {
  constructor(private readonly appointmentConsumablesService: AppointmentConsumablesService) {}

  @UseGuards(JwtAuthGuard)
  @Post(':appointmentId/consumables')
  async createAppointmentConsumable(
    @Request() req: RequestWithUser,
    @Param('appointmentId') appointmentId: string,
    @Body() dto: CreateAppointmentConsumableDto,
  ) {
    return this.appointmentConsumablesService.createAppointmentConsumable(
      appointmentId,
      req.user.userId,
      dto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get(':appointmentId/consumables')
  async getAppointmentConsumables(
    @Request() req: RequestWithUser,
    @Param('appointmentId') appointmentId: string,
  ) {
    return this.appointmentConsumablesService.getAppointmentConsumables(
      appointmentId,
      req.user.userId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('consumables/search')
  async searchAppointmentConsumables(
    @Request() req: RequestWithUser,
    @Query() query: SearchAppointmentConsumablesDto,
  ) {
    return this.appointmentConsumablesService.searchAppointmentConsumables(
      req.user.userId,
      query,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':appointmentId/consumables/:consumableId')
  async updateAppointmentConsumable(
    @Request() req: RequestWithUser,
    @Param('appointmentId') appointmentId: string,
    @Param('consumableId') consumableId: string,
    @Body() dto: UpdateAppointmentConsumableDto,
  ) {
    return this.appointmentConsumablesService.updateAppointmentConsumable(
      appointmentId,
      consumableId,
      req.user.userId,
      dto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':appointmentId/consumables/:consumableId')
  async deleteAppointmentConsumable(
    @Request() req: RequestWithUser,
    @Param('appointmentId') appointmentId: string,
    @Param('consumableId') consumableId: string,
  ) {
    return this.appointmentConsumablesService.deleteAppointmentConsumable(
      appointmentId,
      consumableId,
      req.user.userId,
    );
  }
}
