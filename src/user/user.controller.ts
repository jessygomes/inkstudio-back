import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards, Request } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateAppointmentBookingDto, UpdateConfirmationSettingDto } from './dto/update-confirmation-setting.dto';
import { UpdateColorProfileDto } from './dto/update-color-profile.dto';
import { GetUsersDto } from './dto/get-users.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequestWithUser } from '../auth/jwt.strategy';
import { UpdateUserClientDto } from './dto/update-userClient.dto';
import { SendPublicContactEmailDto } from './dto/send-public-contact-email.dto';
import { PublicContactThrottleGuard } from './public-contact-throttle.guard';

@Controller('users')
export class UserController {
  constructor(private userService: UserService) {}

  //! 1️⃣ ROUTES STATIQUES SPÉCIFIQUES EN PREMIER
  //! RECUPERER LES VILLES
  @Get('cities')
  async getDistinctCities() {
    return this.userService.getDistinctCities();
  }

  //! RECUPERER LES STYLES
  @Get('styleTattoo')
  async getDistinctStyles() {
    return this.userService.getDistinctStyles();
  }

  //! SEARCH USERS (pour la barre de recherche du front)
  @Get('search')
  async searchUsers(@Query('query') query: string) {
    return await this.userService.searchUsers(query);
  }

  //! RECUPERER LE PARAMÈTRE DE CONFIRMATION DES RDV
  @UseGuards(JwtAuthGuard)
  @Get('confirmation-setting')
  getConfirmationSetting(@Request() req: RequestWithUser) {
    const userId = req.user.userId;
    return this.userService.getConfirmationSetting({ userId });
  }

  //! MISE À JOUR DU PARAMÈTRE DE CONFIRMATION DES RDV
  @UseGuards(JwtAuthGuard)
  @Patch('confirmation-setting')
  updateConfirmationSetting(@Body() body: UpdateConfirmationSettingDto, @Request() req: RequestWithUser) {
    const userId = req.user.userId;
    return this.userService.updateConfirmationSetting({
      userId,
      addConfirmationEnabled: body.addConfirmationEnabled,
    });
  }

  //! RECUPERER LE PARAMÈTRE DE PRISE DES RDV
  @UseGuards(JwtAuthGuard)
  @Get('appointment-setting')
  getAppointmentBooking(@Request() req: RequestWithUser) {
    const userId = req.user.userId;
    return this.userService.getAppointmentBooking({ userId });
  }

  //! RECUPERER LES FACTURES DU SALON
  @Get("factures")
  @UseGuards(JwtAuthGuard)
  getFactureSalon(
    @Request() req: RequestWithUser, 
    @Query('page') page?: string, 
    @Query('limit') limit?: string,
    @Query('search') search: string = '',
    @Query('isPayed') isPayed?: string
  ) {
    const userId = req.user.userId;
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    return this.userService.getFactureSalon({userId, page: pageNumber, limit: limitNumber, search, isPayed});
  }

  //! RECUPERER LES COULEURS DU PROFIL
  @UseGuards(JwtAuthGuard)
  @Get('color-profile')
  getColorProfile(@Request() req: RequestWithUser) {
    const userId = req.user.userId;
    return this.userService.getColorProfile({ userId });
  }

  //! MISE À JOUR DU PARAMÈTRE DE PRISE DES RDV
  @UseGuards(JwtAuthGuard)
  @Patch('appointment-setting')
  updateAppointmentBooking(@Body() body: UpdateAppointmentBookingDto, @Request() req: RequestWithUser) {
    const userId = req.user.userId;
    return this.userService.updateAppointmentBooking({
      userId,
      agendaMode: body.agendaMode,
      projectAppointmentDurationMinutes: body.projectAppointmentDurationMinutes,
      projectAppointmentIsFree: body.projectAppointmentIsFree,
      projectAppointmentPrice: body.projectAppointmentPrice,
      followUpEmailDelayDays: body.followUpEmailDelayDays,
      retouchEmailDelayDays: body.retouchEmailDelayDays,
    });
  }

  //! MISE À JOUR DES COULEURS DU PROFIL
  @UseGuards(JwtAuthGuard)
  @Patch('color-profile')
  updateColorProfile(@Body() body: UpdateColorProfileDto, @Request() req: RequestWithUser) {
    const userId = req.user.userId;
    return this.userService.updateColorProfile({
      userId,
      colorProfile: body.colorProfile,
      colorProfileBis: body.colorProfileBis,
    });
  }

  //! BASCULER LE STATUT D'INSPIRATION DU SALON
  @UseGuards(JwtAuthGuard)
  @Patch('inspiration-salon')
  toggleInspirationSalon(@Request() req: RequestWithUser) {
    const userId = req.user.userId;
    return this.userService.toggleInspirationSalon({
      userId,
      role: req.user.role,
    });
  }

  //! ROUTES SPÉCIFIQUES AUX CLIENTS CONNECTÉS (AVANT LES PARAMÈTRES)
  
  //! Récupérer les salons favoris
  @UseGuards(JwtAuthGuard)
  @Get('favorites')
  getFavoriteSalons(@Request() req: RequestWithUser) {
    const userId = req.user.userId;
    
    return this.userService.getFavoriteSalons({ userId });
  }

  //! Récupérer les images de portfolio favorites
  @UseGuards(JwtAuthGuard)
  @Get('favorites/portfolio')
  getFavoritePortfolioImages(@Request() req: RequestWithUser) {
    const userId = req.user.userId;

    return this.userService.getFavoritePortfolioImages({ userId });
  }

  //! Ajouter/Supprimer un salon des favoris
  @UseGuards(JwtAuthGuard)
  @Patch('favorites/:salonId')
  toggleFavoriteSalon(@Request() req: RequestWithUser, @Param('salonId') salonId: string) {
    const userId = req.user.userId;
    
    return this.userService.toggleFavoriteSalon({ userId, salonId });
  }

  //! Ajouter/Supprimer une image de portfolio des favoris
  @UseGuards(JwtAuthGuard)
  @Patch('favorites/portfolio/:portfolioId')
  toggleFavoritePortfolio(@Request() req: RequestWithUser, @Param('portfolioId') portfolioId: string) {
    const userId = req.user.userId;

    return this.userService.toggleFavoritePortfolio({
      userId,
      portfolioId,
      role: req.user.role,
    });
  }

  //! ROUTES DE MISE À JOUR DES PROFILS UTILISATEURS
  @UseGuards(JwtAuthGuard)
  @Patch("userClient")
  updateUserClient(@Request() req: RequestWithUser, @Body() userBody: UpdateUserClientDto) {
    const userId = req.user.userId;
    return this.userService.updateUserClient({userId, userBody});
  }
  
  @UseGuards(JwtAuthGuard)
  @Patch()
  updateUser(@Request() req: RequestWithUser, @Body() userBody: UpdateUserDto) {
    const userId = req.user.userId;
    return this.userService.updateUser({userId, userBody});
  }

    //! COMPTER LE NOMBRE DE CLIENTS QUI ONT MIS EN FAVORI CE SALON
  @UseGuards(JwtAuthGuard)
  @Get('favorites/count')
  async getFavoritesCount(@Request() req: RequestWithUser,) {
    const salonId = req.user.userId;
    return await this.userService.getFavoritesCount(salonId);
  }

  //! 2️⃣ ROUTES GÉNÉRIQUES (sans paramètres)
  //! GET ALL USERS
  @Get()
  async getUsers(@Query() dto: GetUsersDto) {
    const { query, city, style, page, limit } = dto;
    return this.userService.getUsers(query, city, style, page, limit);
  }

  //! 3️⃣ ROUTES AVEC PARAMÈTRES COMPLEXES
  //! ENVOI D'UN MESSAGE DE CONTACT DEPUIS LE PROFIL PUBLIC
  @UseGuards(PublicContactThrottleGuard)
  @Post(':userId/contact')
  async sendPublicContactEmail(
    @Param('userId') userId: string,
    @Body() body: SendPublicContactEmailDto,
    @Request() req: { ip?: string },
  ): Promise<{ error: boolean; message: string }> {
    return await this.userService.sendPublicContactEmail({
      targetUserId: userId,
      payload: body,
      requesterIp: req?.ip,
    });
  }

  //! RECUPERER LES PHOTOS DU SALON
  @Get(":userId/photos")
  getPhotosSalon(@Param('userId') userId: string) {
    return this.userService.getPhotosSalon({userId});
  }

  @UseGuards(JwtAuthGuard)
  @Patch(":userId/photos")
  addOrUpdatePhotoSalon(
    @Param('userId') userId: string,
    @Request() req: RequestWithUser,
    @Body() body: string[] | {photoUrls: string[]},
  ) {
    if (req.user.userId !== userId) {
      throw new ForbiddenException('Vous ne pouvez modifier que vos propres photos.');
    }

    // Le body peut être soit un tableau directement, soit un objet avec photoUrls
    const salonPhotos = Array.isArray(body) ? body : body.photoUrls;
    return this.userService.addOrUpdatePhotoSalon({
      userId,
      requesterUserId: req.user.userId,
      salonPhotos,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Patch(":userId/hours")
  updateHoursSalon(
    @Param('userId') userId: string,
    @Request() req: RequestWithUser,
    @Body() salonHours: Record<string, { start: string; end: string } | null>,
  ) { // On récupère le paramètre dynamique userId
    if (req.user.userId !== userId) {
      throw new ForbiddenException('Vous ne pouvez modifier que vos propres horaires.');
    }

    return this.userService.updateHoursSalon({
      userId,
      requesterUserId: req.user.userId,
      salonHours: JSON.stringify(salonHours),
    }); // On appelle la méthode getUserById du service UserService
  }

  @Get(":userId/param") // :userId est un paramètre dynamique qui sera récupéré dans la méthode getUser
  getUserParam(@Param('userId') userId: string) { // On récupère le paramètre dynamique userId
    return this.userService.getUserParamById({userId});
  } 

  //! GET USER BY SLUG + LOCALISATION
  @Get(":nameSlug/:locSlug")
  getUserBySlugAndLocation(@Param('nameSlug') nameSlug: string, @Param('locSlug') locSlug: string) {
    return this.userService.getUserBySlugAndLocation({ nameSlug, locSlug });
  }

  //! 4️⃣ ROUTES AVEC PARAMÈTRES SIMPLES EN DERNIER
  @Get(":userId") // :userId est un paramètre dynamique qui sera récupéré dans la méthode getUser
  getUser(@Param('userId') userId: string) { // On récupère le paramètre dynamique userId
    return this.userService.getUserById({userId}); // On appelle la méthode getUserById du service UserService
  } 
  
  //! Récupérer les RDV du client connecté
  // @UseGuards(JwtAuthGuard)
  // @Get('my-appointments')
  // getMyAppointments(@Request() req: RequestWithUser, @Query('status') status?: string) {
  //   const userId = req.user.userId;
  //   const userRole = req.user.role;
    
  //   if (userRole !== 'client') {
  //     throw new Error('Accès réservé aux clients');
  //   }
    
  //   return this.userService.getClientAppointments({ userId, status });
  // }

  // //! Prendre un RDV en tant que client connecté
  // @UseGuards(JwtAuthGuard)
  // @Post('book-appointment')
  // bookAppointment(@Request() req: RequestWithUser, @Body() appointmentData: any) {
  //   const clientUserId = req.user.userId;
  //   const userRole = req.user.role;
    
  //   if (userRole !== 'client') {
  //     throw new Error('Accès réservé aux clients');
  //   }
    
  //   return this.userService.bookAppointmentAsClient({ clientUserId, appointmentData });
  // }

  // //! Récupérer les salons favoris
  // @UseGuards(JwtAuthGuard)
  // @Get('favorites')
  // getFavoriteSalons(@Request() req: RequestWithUser) {
  //   const clientId = req.user.userId;
  //   const userRole = req.user.role;
    
  //   if (userRole !== 'client') {
  //     throw new Error('Accès réservé aux clients');
  //   }
    
  //   return this.userService.getFavoriteSalons({ clientId });
  // }

  // //! Ajouter/Supprimer un salon des favoris
  // @UseGuards(JwtAuthGuard)
  // @Post('favorites/:salonId')
  // toggleFavoriteSalon(@Request() req: RequestWithUser, @Param('salonId') salonId: string) {
  //   const clientId = req.user.userId;
  //   const userRole = req.user.role;
    
  //   if (userRole !== 'client') {
  //     throw new Error('Accès réservé aux clients');
  //   }
    
  //   return this.userService.toggleFavoriteSalon({ clientId, salonId });
  // }

  // //! Laisser un avis sur un salon
  // @UseGuards(JwtAuthGuard)
  // @Post('reviews')
  // createSalonReview(@Request() req: RequestWithUser, @Body() reviewData: any) {
  //   const authorId = req.user.userId;
  //   const userRole = req.user.role;
    
  //   if (userRole !== 'client') {
  //     throw new Error('Accès réservé aux clients');
  //   }
    
  //   return this.userService.createSalonReview({ authorId, reviewData });
  // }


}
