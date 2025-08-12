import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { GetUsersDto } from './dto/get-users.dto';

@Controller('users')
export class UserController {
  constructor(private userService: UserService) {}
  //! GET ALL USERS
  @Get()
  async getUsers(@Query() dto: GetUsersDto) {
    const { query, city, page, limit } = dto;
    return this.userService.getUsers(query, city, page, limit);
  }

  //! RECUPERER LES VILLES
  @Get('cities')
  async getDistinctCities() {
    return this.userService.getDistinctCities();
  }

  //! SEARCH USERS (pour la barre de recherche du front)
  @Get('search')
  async searchUsers(@Query('query') query: string) {
    return await this.userService.searchUsers(query);
  }

  //! GET USER BY SLUG + LOCALISATION
  @Get(":nameSlug/:locSlug")
  getUserBySlugAndLocation(@Param('nameSlug') nameSlug: string, @Param('locSlug') locSlug: string) {
    return this.userService.getUserBySlugAndLocation({ nameSlug, locSlug });
  }

  //! Routes spécifiques AVANT les routes avec paramètres
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

  //! Routes génériques APRÈS les routes spécifiques
  @Get(":userId") // :userId est un paramètre dynamique qui sera récupéré dans la méthode getUser
  getUser(@Param('userId') userId: string) { // On récupère le paramètre dynamique userId
    return this.userService.getUserById({userId}); // On appelle la méthode getUserById du service UserService
  }
  
  @Patch(":userId") // :userId est un paramètre dynamique qui sera récupéré dans la méthode getUser
  updateUser(@Param('userId') userId: string, @Body() userBody: UpdateUserDto) { // On récupère le paramètre dynamique userId
    return this.userService.updateUser({userId, userBody}); // On appelle la méthode getUserById du service UserService
  }
}
