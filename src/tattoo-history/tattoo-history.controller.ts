import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { TattooHistoryService } from './tattoo-history.service';
import { CreateTattooHistoryDto } from './dto/create-tattoohistory.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';

@Controller('tattoo-history')
export class TattooHistoryController {
  constructor(private readonly tattooHistoryService: TattooHistoryService) {}

  //! CREER UN HISTORIQUE DE TATOUAGE ✅
  @Post()
  async createHistory(@Body() body: CreateTattooHistoryDto) {
    return this.tattooHistoryService.createHistory(body);
  }

  //! MODIFIER UN HISTORIQUE DE TATOUAGE ✅
  @UseGuards(JwtAuthGuard)
  @Patch('update/:id')
  async updateHistory(@Request() req: RequestWithUser, @Param('id') id: string, @Body() body: CreateTattooHistoryDto) {
    return this.tattooHistoryService.updateHistory(id, body, req.user.userId);
  }

  //! SUPPRIMER UN HISTORIQUE DE TATOUAGE ✅
  @UseGuards(JwtAuthGuard)
  @Delete('delete/:id')
  async deleteHistory(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.tattooHistoryService.deleteHistory(id, req.user.userId);
  }

  //! TODO : AFFICHER TOUS LES HISTORIQUES DES TATOUAGES DE TOUS LES CLIENTS DU SALON ✅
  @UseGuards(JwtAuthGuard)
  @Get('by-salon')
  async getAllFromSalon(@Request() req: { user: { userId: string } }) {
    return this.tattooHistoryService.getSalonTattooHistories(req.user.userId);
  }
}
