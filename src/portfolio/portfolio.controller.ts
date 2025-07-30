import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { AddPhotoDto } from './dto/add-photo.dto';

@Controller('portfolio')
export class PortfolioController {
   constructor(private readonly portfolioService: PortfolioService) {}

   //! AJOUTER UNE PHOTO AU PORTFOLIO
  @Post()
  async addPhotoToPortfolio(@Body() portfolioBody: AddPhotoDto) {
    return this.portfolioService.addPhotoToPortfolio({ portfolioBody });
  }

  //! VOIR TOUTES LES PHOTOS D'UN PORTFOLIO
  @Get(':userId')
  async getPortfolioPhotos(@Param('userId') userId: string) {
    return this.portfolioService.getPortfolioPhotos(userId);
  }

  //! MODIFIER UNE PHOTO DU PORTFOLIO
  @Put(':id')
  async updatePortfolioPhoto(@Param('id') id: string, @Body() updateData: Partial<AddPhotoDto>) {
    return this.portfolioService.updatePortfolioPhoto(id, updateData);
  }

  //! SUPPRIMER UNE PHOTO DU PORTFOLIO
  @Delete(':id')
  async deletePortfolioPhoto(@Param('id') id: string) {
    return this.portfolioService.deletePortfolioPhoto(id);
  }
}
