import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, Query } from '@nestjs/common';
import { SalonReviewService } from './salon-review.service';
import { CreateSalonReviewDto } from './dto/create-salon-review.dto';
// import { UpdateSalonReviewDto } from './dto/update-salon-review.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';

@Controller('salon-review')
export class SalonReviewController {
  constructor(private readonly salonReviewService: SalonReviewService) {}

  //! CRÉER UN AVIS SUR UN SALON ✅
  @UseGuards(JwtAuthGuard)
  @Post()
  async createReview(
    @Request() req: RequestWithUser,
    @Body() createSalonReviewDto: CreateSalonReviewDto
  ) {
    const clientUserId = req.user.userId;
    return await this.salonReviewService.createReview(createSalonReviewDto, clientUserId);
  }

  //! RÉCUPÉRER TOUS LES AVIS DONNÉS PAR UN CLIENT ✅
  @UseGuards(JwtAuthGuard)
  @Get('client/my-reviews')
  async findAllReviewsByClient(
    @Request() req: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: 'recent' | 'rating' | 'oldest'
  ) {
    const clientUserId = req.user.userId;
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    
    return await this.salonReviewService.findAllReviewsByClient(
      clientUserId, 
      pageNumber, 
      limitNumber,
      sortBy || 'recent'
    );
  }

  //! RÉCUPÉRER LES DERNIERS AVIS RÉCENTS (< 10 JOURS) D'UN SALON ✅
    @UseGuards(JwtAuthGuard)
  @Get('salon/recent')
  async getRecentReviewsBySalon(
    @Request() req: RequestWithUser,
    @Query('limit') limit?: string
  ) {
    const limitNumber = limit ? parseInt(limit, 10) : 5;
    const salonId = req.user.userId;
    return await this.salonReviewService.getRecentReviewsBySalon(salonId, limitNumber);
  }

  //! RÉCUPÉRER TOUS LES AVIS D'UN SALON AVEC PAGINATION ✅
  @Get('salon/:salonId')
  async findAllReviewBySalon(
    @Param('salonId') salonId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: 'recent' | 'rating' | 'oldest',
    @Query('filterRating') filterRating?: string
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    const ratingFilter = filterRating ? parseInt(filterRating, 10) : undefined;
    
    return await this.salonReviewService.findAllReviewBySalon(
      salonId, 
      pageNumber, 
      limitNumber,
      sortBy || 'recent',
      ratingFilter
    );
  }

  //! MODIFIER LA VISIBILITÉ D'UN AVIS (SALON) ✅
  @UseGuards(JwtAuthGuard)
  @Patch(':id/visibility')
  async updateReviewVisibility(
    @Request() req: RequestWithUser,
    @Param('id') reviewId: string,
    @Body('isVisible') isVisible: boolean | string
  ) {
    const salonUserId = req.user.userId;
    const visibility = typeof isVisible === 'string' ? isVisible === 'true' : !!isVisible;
    return await this.salonReviewService.updateReviewVisibility(reviewId, salonUserId, visibility);
  }

  //! RÉPONDRE À UN AVIS (SALON) ✅
  @UseGuards(JwtAuthGuard)
  @Post(':id/response')
  async respondToReview(
    @Request() req: RequestWithUser,
    @Param('id') reviewId: string,
    @Body('response') response: string
  ) {
    const salonUserId = req.user.userId;
    return await this.salonReviewService.respondToReview(reviewId, salonUserId, response);
  }

  //! SUPPRIMER LA RÉPONSE D'UN AVIS (SALON) ✅
  @UseGuards(JwtAuthGuard)
  @Delete(':id/response')
  async removeReviewResponse(
    @Request() req: RequestWithUser,
    @Param('id') reviewId: string
  ) {
    const salonUserId = req.user.userId;
    return await this.salonReviewService.removeReviewResponse(reviewId, salonUserId);
  }

  //! SUPPRIMER UN AVIS (CLIENT AUTEUR) ✅
  @UseGuards(JwtAuthGuard)
  @Delete('client/:id')
  async deleteReviewByClient(
    @Request() req: RequestWithUser,
    @Param('id') reviewId: string
  ) {
    const clientUserId = req.user.userId;
    return await this.salonReviewService.deleteReviewByClient(reviewId, clientUserId);
  }
}
