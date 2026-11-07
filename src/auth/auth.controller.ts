import { SecurityThrottle } from './security-throttle';
import { EmailRequestDto, EmailTokenDto, ResetPasswordDto } from './dto/email-security.dto';
import { BadRequestException, Body, Controller, Get, Header, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthService, AuthTokenResponse } from './auth.service';
import { RequestWithUser } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UserService } from 'src/user/user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PrismaService } from 'src/database/prisma.service';
import { CreateUserClientDto } from './dto/create-userClient.dto';
import { CreateTatoueurUserDto } from './dto/create-tatoueur-user.dto';
import { CachedUser } from 'utils/type';
import { RegistrationThrottleGuard } from './registration-throttle.guard';
import { invitationTokenHash } from './invitation-policy';
import { GoogleLoginDto } from './dto/google-login.dto';
import { AppleLoginDto } from './dto/apple-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
// import { GoogleAuthGuard } from './guards/google-auth/google-auth.guard';


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
  @SecurityThrottle('login')
  @Post('login') // POST /auth/login
  async login(@Body() authBody: LoginUserDto) {
    return await this.authService.login({ authBody });
  }

  // Renouvelle la session avec un jeton de rafraîchissement (rotation : l'ancien jeton est remplacé).
  @SecurityThrottle('refresh')
  @Post('refresh') // POST /auth/refresh
  @Header('Cache-Control', 'private, no-store')
  async refresh(@Body() body: RefreshTokenDto, @Request() request: { headers?: Record<string, string | string[] | undefined> }) {
    const agent = request.headers?.['user-agent'];
    return await this.authService.refresh(body.refreshToken, typeof agent === 'string' ? agent : undefined);
  }

  // Déconnexion de cet appareil : la session du jeton présenté est révoquée.
  @SecurityThrottle('refresh')
  @Post('logout') // POST /auth/logout
  async logout(@Body() body: RefreshTokenDto) {
    return await this.authService.logout(body.refreshToken);
  }

  // Déconnexion de tous les appareils.
  @UseGuards(JwtAuthGuard)
  @Post('logout-all') // POST /auth/logout-all
  async logoutAll(@Request() request: RequestWithUser) {
    return await this.authService.logoutAll(request.user.userId);
  }

  @SecurityThrottle('google')
  @Post('google') // POST /auth/google
  async googleLogin(@Body() body: GoogleLoginDto): Promise<AuthTokenResponse> {
    return await this.authService.loginWithGoogle({
      idToken: body.idToken,
    });
  }

  @SecurityThrottle('apple')
  @Post('apple') // POST /auth/apple
  async appleLogin(@Body() body: AppleLoginDto): Promise<AuthTokenResponse> {
    return await this.authService.loginWithApple({
      identityToken: body.identityToken,
      nonce: body.nonce,
      firstName: body.firstName,
      lastName: body.lastName,
    });
  }

  @Post('register') // POST /auth/register
  // Protection anti-bot: limite le nombre de tentatives d'inscription (IP + email).
  @UseGuards(RegistrationThrottleGuard)
  async register(@Body() registerBody: CreateUserDto) { // CreateUserDto est un DTO qui permet de valider les données : la fonction sera exécuté uniquement si les données sont valides
    return await this.authService.register({ registerBody });
  }

  @Get('invitation')
  async invitation(@Query('token') token: string) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new BadRequestException('Invitation invalide.');
    const invitation = await this.prisma.subscriptionInvitation.findUnique({ where: { tokenHash: invitationTokenHash(token) } });
    if (!invitation || invitation.revokedAt || invitation.useCount >= invitation.maxUses || invitation.expiresAt <= new Date()) {
      throw new BadRequestException('Invitation invalide, expirée ou quota atteint.');
    }
    return { email: invitation.email, role: invitation.role, plan: invitation.plan, durationMonths: invitation.durationMonths };
  }

  @Post('register_client') // POST /auth/register_client
  // Même protection anti-bot pour l'inscription client.
  @UseGuards(RegistrationThrottleGuard)
  async registerClient(@Body() registerBody: CreateUserClientDto) {
    return await this.authService.registerClient({ registerBody });
  }

  @Post('register_tatoueur') // POST /auth/register_tatoueur
  @UseGuards(RegistrationThrottleGuard)
  async registerTatoueur(@Body() registerBody: CreateTatoueurUserDto) {
    return await this.authService.registerTatoueur({ registerBody });
  }

  // @Get('google/login')
  // @UseGuards(GoogleAuthGuard)
  // googleLogin() {
  //   // Initiates the Google OAuth2 login flow
  // }

  // @Get('google/callback')
  // @UseGuards(GoogleAuthGuard)
  // async googleLoginCallback(@Req() req) {
  //   const response = await this.authService.login(req.user.id)
  // }

  // ici on utilise JWTStategy
  @UseGuards(JwtAuthGuard)
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async getAuthenticatedUser(@Request() request: RequestWithUser): Promise<CachedUser | null> {
    return await this.userService.getUserById({userId: request.user.userId});
  }

  @SecurityThrottle('verify')
  @Header('Cache-Control', 'private, no-store')
  @Get('verify-email')
  async verifyEmail(@Query() query: EmailTokenDto) {
    return this.authService.verifyEmail(query.email, query.token);
  }

  @SecurityThrottle('forgot')
  @Post('forgot-password')
  async forgotPassword(@Body() body: EmailRequestDto) {
    return this.authService.sendResetPasswordEmail(body.email);
  }

  @SecurityThrottle('reset')
  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body);
  }

  @SecurityThrottle('change')
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @Request() request: RequestWithUser,
    @Body() changePasswordDto: ChangePasswordDto
  ) {
    try {
      const userId = request.user.userId;
      const { currentPassword, newPassword, confirmPassword } = changePasswordDto;

      // Vérifier que les mots de passe de confirmation correspondent
      if (newPassword !== confirmPassword) {
        throw new BadRequestException('Les mots de passe de confirmation ne correspondent pas.');
      }

      return await this.authService.changePassword({
        userId,
        currentPassword,
        newPassword,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      throw new BadRequestException(errorMessage);
    }
  }
}
