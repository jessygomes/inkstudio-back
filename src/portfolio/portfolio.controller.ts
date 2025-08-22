import { Body, Controller, Delete, Get, Param, Post, Put, Request, UseGuards } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { AddPhotoDto } from './dto/add-photo.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

   //! AJOUTER UNE PHOTO AU PORTFOLIO
  @UseGuards(JwtAuthGuard)
  @Post()
  async addPhotoToPortfolio(@Request() req: RequestWithUser, @Body() portfolioBody: AddPhotoDto) {
    const userId = req.user.userId;
    return this.portfolioService.addPhotoToPortfolio({ portfolioBody, userId });
  }

  //! VOIR TOUTES LES PHOTOS D'UN PORTFOLIO
  @Get(':userId')
  async getPortfolioPhotos(@Param('userId') userId: string) {
    return this.portfolioService.getPortfolioPhotos(userId);
  }

  //! MODIFIER UNE PHOTO DU PORTFOLIO
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async updatePortfolioPhoto(@Param('id') id: string, @Body() updateData: Partial<AddPhotoDto>) {
    return this.portfolioService.updatePortfolioPhoto(id, updateData);
  }

  //! SUPPRIMER UNE PHOTO DU PORTFOLIO
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deletePortfolioPhoto(@Param('id') id: string) {
    return this.portfolioService.deletePortfolioPhoto(id);
  }
}
