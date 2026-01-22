import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Logger,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { NotificationPreferenceService } from './notification-preference.service';
import {
  UpdateNotificationPreferenceDto,
  MuteConversationDto,
  NotificationPreferenceResponseDto,
} from './dto/notification-preference.dto';

interface RequestWithUser extends Request {
  user?: { userId: string };
}

@Controller('notification-preferences')
@UseGuards(JwtAuthGuard)
export class NotificationPreferencesController {
  private readonly logger = new Logger('NotificationPreferencesController');

  constructor(
    private readonly notificationPreferenceService: NotificationPreferenceService,
  ) {}

  /**
   * Récupère les préférences de notification de l'utilisateur connecté
   */
  @Get()
  async getPreferences(
    @Request() req: RequestWithUser,
  ): Promise<NotificationPreferenceResponseDto> {
    const userId = req.user?.userId;
    if (!userId) {
      throw new Error('User ID not found in request');
    }
    return this.notificationPreferenceService.getPreferences(userId);
  }

  /**
   * Met à jour les préférences de notification
   */
  @Patch()
  async updatePreferences(
    @Request() req: RequestWithUser,
    @Body() dto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreferenceResponseDto> {
    const userId = req.user?.userId;
    if (!userId) {
      throw new Error('User ID not found in request');
    }
    return this.notificationPreferenceService.updatePreferences(userId, dto);
  }

  /**
   * Ajoute une conversation à la liste des conversations muettes
   */
  @Post('mute')
  async muteConversation(
    @Request() req: RequestWithUser,
    @Body() dto: MuteConversationDto,
  ): Promise<void> {
    const userId = req.user?.userId;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    this.logger.log(
      `Muting conversation ${dto.conversationId} for user ${userId}`,
    );
    await this.notificationPreferenceService.muteConversation(
      userId,
      dto.conversationId,
    );
  }

  /**
   * Retire une conversation de la liste des conversations muettes
   */
  @Delete('mute/:conversationId')
  async unmuteConversation(
    @Request() req: RequestWithUser,
    @Param('conversationId') conversationId: string,
  ): Promise<void> {
    const userId = req.user?.userId;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    this.logger.log(
      `Unmuting conversation ${conversationId} for user ${userId}`,
    );
    await this.notificationPreferenceService.unmuteConversation(
      userId,
      conversationId,
    );
  }
}
