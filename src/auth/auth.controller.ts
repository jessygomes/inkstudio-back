/* eslint-disable prettier/prettier */
import { BadRequestException, Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RequestWithUser } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UserService } from 'src/user/user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { PrismaService } from 'src/database/prisma.service';


@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly userService: UserService, private readonly prisma: PrismaService) {}

  /*
  ** 1. Envoie d'un email et d'un mot de passe
    2. L'API vérifie si le user existe et si le mot de passe est correct
    3. Si le user n'existe pas, l'API renvoie une erreur
    4. Si le mot de passe est incorrect, l'API renvoie une erreur
    5. Si le mot de passe est correct, l'API renvoie un token d'authentification
  */
  @Post('login') // POST /auth/login
  async login(@Body() authBody: LoginUserDto) {
    return await this.authService.login({ authBody });
  }

  @Post('register') // POST /auth/register
  async register(@Body() registerBody: CreateUserDto) { // CreateUserDto est un DTO qui permet de valider les données : la fonction sera exécuté uniquement si les données sont valides
    return await this.authService.register({ registerBody });
  }

  // ici on utilise JWTStategy
  @UseGuards(JwtAuthGuard)
  @Get()
  async getAuthenticatedUser(@Request() request: RequestWithUser) {
    return await this.userService.getUserById({userId: request.user.userId});
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string, @Query('email') email: string) {
    const record = await this.prisma.verificationToken.findUnique({
      where: { email_token: { email, token } },
    });

    if (!record || record.expires < new Date()) {
      throw new BadRequestException("Lien invalide ou expiré.");
    }

    await this.prisma.user.update({
      where: { email },
      data: { emailVerified: new Date() },
    });

    await this.prisma.verificationToken.delete({
      where: { id: record.id },
    });

    return { message: "Email vérifié avec succès." };
  }

  @Post('forgot-password')
  async forgotPassword(@Body('email') email: string) {
    return this.authService.sendResetPasswordEmail(email);
  }

  @Post('reset-password')
  async resetPassword(
    @Body('email') email: string,
    @Body('token') token: string,
    @Body('password') password: string
  ) {
    return this.authService.resetPassword({ email, token, password });
  }
}
