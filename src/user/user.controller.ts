import { Body, Controller, Get, Param, Patch, Query, UseGuards, Request } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateAppointmentBookingDto, UpdateConfirmationSettingDto } from './dto/update-confirmation-setting.dto';
import { UpdateColorProfileDto } from './dto/update-color-profile.dto';
import { GetUsersDto } from './dto/get-users.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequestWithUser } from '../auth/jwt.strategy';

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
    console.log("userId dans le controller:", body, userId);
    return this.userService.updateAppointmentBooking({
      userId,
      appointmentBookingEnabled: body.appointmentBookingEnabled,
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

  //! 2️⃣ ROUTES GÉNÉRIQUES (sans paramètres)
  //! GET ALL USERS
  @Get()
  async getUsers(@Query() dto: GetUsersDto) {
    const { query, city, style, page, limit } = dto;
    return this.userService.getUsers(query, city, style, page, limit);
  }

  //! 3️⃣ ROUTES AVEC PARAMÈTRES COMPLEXES
  //! RECUPERER LES PHOTOS DU SALON
  @Get(":userId/photos")
  getPhotosSalon(@Param('userId') userId: string) {
    return this.userService.getPhotosSalon({userId});
  }

  @Patch(":userId/photos")
  addOrUpdatePhotoSalon(@Param('userId') userId: string, @Body() body: string[] | {photoUrls: string[]}) {
    // Le body peut être soit un tableau directement, soit un objet avec photoUrls
    const salonPhotos = Array.isArray(body) ? body : body.photoUrls;
    return this.userService.addOrUpdatePhotoSalon({userId, salonPhotos});
  }

  @Patch(":userId/hours")
  updateHoursSalon(@Param('userId') userId: string,  @Body() salonHours: Record<string, { start: string; end: string } | null>) { // On récupère le paramètre dynamique userId
    return this.userService.updateHoursSalon({userId, salonHours: JSON.stringify(salonHours),}); // On appelle la méthode getUserById du service UserService
  }

  //! GET USER BY SLUG + LOCALISATION
  @Get(":nameSlug/:locSlug")
  getUserBySlugAndLocation(@Param('nameSlug') nameSlug: string, @Param('locSlug') locSlug: string) {
    console.log("nameSlug et locSlug dans le controller:", nameSlug, locSlug);
    return this.userService.getUserBySlugAndLocation({ nameSlug, locSlug });
  }

  //! 4️⃣ ROUTES AVEC PARAMÈTRES SIMPLES EN DERNIER
  @Get(":userId") // :userId est un paramètre dynamique qui sera récupéré dans la méthode getUser
  getUser(@Param('userId') userId: string) { // On récupère le paramètre dynamique userId
    return this.userService.getUserById({userId}); // On appelle la méthode getUserById du service UserService
  }
  
  @Patch(":userId") // :userId est un paramètre dynamique qui sera récupéré dans la méthode getUser
  updateUser(@Param('userId') userId: string, @Body() userBody: UpdateUserDto) { // On récupère le paramètre dynamique userId
    return this.userService.updateUser({userId, userBody}); // On appelle la méthode getUserById du service UserService
  }
}
