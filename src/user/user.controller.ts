/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UserController {
  constructor(private userService: UserService) {}
  @Get()
  getUsers() {
    return this.userService.getUsers();
  }

  @Get(":userId") // :userId est un paramètre dynamique qui sera récupéré dans la méthode getUser
  getUser(@Param('userId') userId: string) { // On récupère le paramètre dynamique userId
    return this.userService.getUserById({userId}); // On appelle la méthode getUserById du service UserService
  }

  @Patch(":userId") // :userId est un paramètre dynamique qui sera récupéré dans la méthode getUser
  updateUser(@Param('userId') userId: string, @Body() userBody: UpdateUserDto) { // On récupère le paramètre dynamique userId
    return this.userService.updateUser({userId, userBody}); // On appelle la méthode getUserById du service UserService
  }
}
