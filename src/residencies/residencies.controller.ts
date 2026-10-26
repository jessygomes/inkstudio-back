import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { ResidenciesService } from './residencies.service';
import {
  JoinSalonDto,
  ResidencyPermissionsDto,
  ResidencyPresenceDto,
  CurrentSalonDto,
  RespondResidencyDto,
} from './dto';

@Controller('residencies')
export class ResidenciesController {
  constructor(private readonly service: ResidenciesService) {}
  @Get('public/:artistId') publicSalons(@Param('artistId') id: string) {
    return this.service.publicSalons(id);
  }
  @Get('availability') slots(
    @Query('artistId') artistId: string,
    @Query('salonId') salonId: string,
    @Query('date') date: string,
  ) {
    return this.service.slots(artistId, salonId, date);
  }
  @UseGuards(JwtAuthGuard) @Get('my-availability') ownSlots(
    @Request() req: RequestWithUser,
    @Query('artistId') artistId: string,
    @Query('salonId') salonId: string,
    @Query('date') date: string,
    @Query('appointmentId') appointmentId?: string,
  ) {
    return this.service.slots(
      artistId,
      salonId,
      date,
      req.user.userId,
      false,
      appointmentId,
    );
  }
  @UseGuards(JwtAuthGuard) @Get() list(@Request() req: RequestWithUser) {
    return this.service.list(req.user.userId);
  }
  @UseGuards(JwtAuthGuard) @Get('salons/search') search(
    @Query('q') query = '',
  ) {
    return this.service.searchSalons(query);
  }
  @UseGuards(JwtAuthGuard) @Get('requests') requests(
    @Request() req: RequestWithUser,
  ) {
    return this.service.requests(req.user.userId);
  }
  @UseGuards(JwtAuthGuard) @Post('requests') join(
    @Request() req: RequestWithUser,
    @Body() body: JoinSalonDto,
  ) {
    return this.service.requestJoin(
      req.user.userId,
      body.salonId,
      body.message,
    );
  }
  @UseGuards(JwtAuthGuard) @Patch('requests/:id/respond') respond(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: RespondResidencyDto,
  ) {
    return this.service.respondRequest(id, req.user.userId, body.action);
  }
  @UseGuards(JwtAuthGuard) @Patch(':id/permissions') permissions(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: ResidencyPermissionsDto,
  ) {
    return this.service.updatePermissions(id, req.user.userId, body);
  }
  @UseGuards(JwtAuthGuard) @Patch('current') current(
    @Request() req: RequestWithUser,
    @Body() body: CurrentSalonDto,
  ) {
    return this.service.setCurrentSalon(
      req.user.userId,
      body.residencyId || null,
    );
  }
  @UseGuards(JwtAuthGuard) @Patch(':id/presence') presence(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: ResidencyPresenceDto,
  ) {
    return this.service.setPresence(id, req.user.userId, body.presence);
  }
  @UseGuards(JwtAuthGuard) @Delete(':id') leave(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ) {
    return this.service.leave(id, req.user.userId);
  }
}
