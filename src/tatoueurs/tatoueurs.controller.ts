import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { TatoueursService } from './tatoueurs.service';
import { CreateTatoueurDto } from './dto/create-tatoueur.dto';

@Controller('tatoueurs')
export class TatoueursController {
  constructor(private readonly tatoueursService: TatoueursService) {}

  //! CREER UN TATOUEUR ✅
  @Post()
  create(@Body() tatoueurBody: CreateTatoueurDto) {
    return this.tatoueursService.create({ tatoueurBody });
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

  //! VOIR UN SEUL TATOUEUR ✅
  @Get(':id')
  getOneTatoueur(@Param('id') id: string) {
    return this.tatoueursService.getOneTatoueur(id);
  }

  //! MODIFIER UN TATOUEUR ✅
  @Patch('update/:id')
  updateTatoueur(@Param('id') id: string, @Body() tatoueurBody: CreateTatoueurDto) {
    return this.tatoueursService.updateTatoueur(id, tatoueurBody);
  }

  //! SUPPRIMER UN TATOUEUR ✅
  @Delete('delete/:id')
  deleteTatoueur(@Param('id') id: string) {
    return this.tatoueursService.deleteTatoueur(id);
  }
}
