import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { TatoueursService } from './tatoueurs.service';
import { CreateTatoueurDto } from './dto/create-tatoueur.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';

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
