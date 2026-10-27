import { PublicProfile } from '../user/public-profile-access';
import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { AddPhotoDto } from './dto/add-photo.dto';
import { AddPhotosBatchDto } from './dto/add-photos-batch.dto';
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

  //! AJOUTER PLUSIEURS PHOTOS AU PORTFOLIO (PAR LOT)
  @UseGuards(JwtAuthGuard)
  @Post('batch')
  async addPhotosBatch(@Request() req: RequestWithUser, @Body() batchBody: AddPhotosBatchDto) {
    const userId = req.user.userId;
    return this.portfolioService.addPhotosBatchToPortfolio({ batchBody, userId });
  }

  //! LISTER LES CATEGORIES DE TATOUAGE
  @Get('categories')
  getCategories() {
    return this.portfolioService.getCategories();
  }

  //! LISTER LES STYLES (tous, ou ceux présents dans le portfolio de userId)
  @Get('styles')
  getStyles(@Query('userId') userId?: string, @Query('tatoueurId') tatoueurId?: string) {
    return this.portfolioService.getStyles({ userId, tatoueurId });
  }

  //! SUGGESTIONS DE STYLES PENDANT LA SAISIE
  @UseGuards(JwtAuthGuard)
  @Get('styles/suggest')
  suggestStyles(@Query('q') q?: string) {
    return this.portfolioService.suggestStyles(q);
  }

  //! VOIR TOUTES LES IMAGES D'INSPIRATION DES SALONS
  @Get('inspirations')
  getInspirationPortfolioPhotos(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('city') city?: string,
    @Query('style') style?: string,
    @Query('hashtag') hashtag?: string,
    @Query('category') category?: string,
    @Query('pieceSize') pieceSize?: string,
  ) {
    const pageNumber = page ? Number.parseInt(page, 10) : 1;
    const limitNumber = limit ? Number.parseInt(limit, 10) : 12;
    return this.portfolioService.getInspirationPortfolioPhotos({
      page: pageNumber,
      limit: limitNumber,
      city,
      style,
      hashtag,
      category,
      pieceSize,
    });
  }

  //! VOIR TOUTES LES PHOTOS D'UN PORTFOLIO
  @PublicProfile()
  @Get(':userId')
  async getPortfolioPhotos(
    @Param('userId') userId: string,
    @Query('tatoueurId') tatoueurId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('style') style?: string,
    @Query('hashtag') hashtag?: string,
    @Query('category') category?: string,
    @Query('pieceSize') pieceSize?: string,
    @Request() req?: RequestWithUser,
  ) {
    const pageNumber = page ? Number.parseInt(page, 10) : 1;
    const limitNumber = limit ? Number.parseInt(limit, 10) : undefined;
    return this.portfolioService.getPortfolioPhotos(userId, tatoueurId, pageNumber, limitNumber, {
      style,
      hashtag,
      category,
      pieceSize,
    }, req?.user?.userId !== userId && req?.user?.role !== 'admin');
  }

  //! MODIFIER UNE PHOTO DU PORTFOLIO
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async updatePortfolioPhoto(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updateData: Partial<AddPhotoDto>,
  ) {
    const userId = req.user.userId;
    return this.portfolioService.updatePortfolioPhoto(id, updateData, userId);
  }

  //! SUPPRIMER UNE PHOTO DU PORTFOLIO
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deletePortfolioPhoto(@Request() req: RequestWithUser, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.portfolioService.deletePortfolioPhoto(id, userId);
  }
}
