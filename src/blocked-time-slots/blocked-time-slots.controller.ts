import { Controller, Post, Get, Put, Delete, Body, Param, Query, ValidationPipe, UsePipes, UseGuards, Request } from '@nestjs/common';
import { BlockedTimeSlotsService } from './blocked-time-slots.service';
import { CreateBlockedSlotDto } from './dto/create-blocked-slot.dto';
import { UpdateBlockedSlotDto } from './dto/update-blocked-slot.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';

@Controller('blocked-slots')
export class BlockedTimeSlotsController {
  constructor(private readonly blockedSlotsService: BlockedTimeSlotsService) {}

  //! CRÉER UN CRÉNEAU BLOQUÉ
  @UseGuards(JwtAuthGuard)
  @Post()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async createBlockedSlot(@Request() req: RequestWithUser, @Body() createBlockedSlotDto: CreateBlockedSlotDto) {
    const userId = req.user.userId;
    return this.blockedSlotsService.createBlockedSlot(createBlockedSlotDto, userId);
  }

  //! VOIR TOUS LES CRÉNEAUX BLOQUÉS D'UN SALON
  @Get('salon/:userId')
  async getBlockedSlotsBySalon(@Param('userId') userId: string) {
    return this.blockedSlotsService.getBlockedSlotsBySalon(userId);
  }

  //! VOIR TOUS LES CRÉNEAUX BLOQUÉS D'UN TATOUEUR
  @Get('tatoueur/:tatoueurId')
  async getBlockedSlotsByTatoueur(@Param('tatoueurId') tatoueurId: string) {
    return this.blockedSlotsService.getBlockedSlotsByTatoueur(tatoueurId);
  }

  //! VOIR LES CRENEAU PROPOSE PAR LE SALON SUITE A UNE DEMANDE DE RDV CLIENT
  @Get('propose-creneau')
  async getProposedSlotsForSalon(
    @Query('tatoueurId') tatoueurId: string,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.blockedSlotsService.getProposedSlotsForSalon(tatoueurId, start, end);
  }

  //! VÉRIFIER SI UN CRÉNEAU EST BLOQUÉ
  @Get('check')
  async checkIfBlocked(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('tatoueurId') tatoueurId?: string,
    @Query('userId') userId?: string
  ) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    const isBlocked = await this.blockedSlotsService.isTimeSlotBlocked(start, end, tatoueurId, userId);
    
    return {
      isBlocked,
      message: isBlocked ? 'Ce créneau est bloqué' : 'Ce créneau est disponible'
    };
  }

  //! MODIFIER UN CRÉNEAU BLOQUÉ
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async updateBlockedSlot(
    @Param('id') id: string,
    @Body() updateBlockedSlotDto: UpdateBlockedSlotDto
  ) {
    return this.blockedSlotsService.updateBlockedSlot(id, updateBlockedSlotDto);
  }

  //! SUPPRIMER UN CRÉNEAU BLOQUÉ
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteBlockedSlot(@Param('id') id: string) {
    return this.blockedSlotsService.deleteBlockedSlot(id);
  }
}
