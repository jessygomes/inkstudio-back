import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ConversationsService } from './conversations.service';
import { ConversationAccessGuard } from './guards/conversation-access.guard';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ConversationResponseDto } from './dto/conversation-response.dto';
import { PaginatedConversationsDto } from './dto/paginated-conversations.dto';
import { ConversationStatus } from '@prisma/client';
import { RequestWithUser } from '../../auth/jwt.strategy';
import { MessageNotificationService } from '../notifications/message-notification.service';

@Controller('messaging/conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly notificationService: MessageNotificationService,
  ) {}

  /**
   * POST /messaging/conversations
   * Créer une nouvelle conversation
   */
  @Post()
  async createConversation(
    @Request() req: RequestWithUser,
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationResponseDto> {
    return this.conversationsService.createConversation(req.user.userId, dto);
  }

  /**
   * GET /messaging/conversations
   * Récupérer toutes les conversations de l'utilisateur
   */
  @Get()
  async getConversations(
    @Request() req: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: ConversationStatus,
  ): Promise<PaginatedConversationsDto> {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    return this.conversationsService.getConversations(
      req.user.userId,
      pageNum,
      limitNum,
      status,
    );
  }

  /**
   * GET /messaging/conversations/unread/total
   * Récupérer le nombre total de messages non lus pour l'utilisateur
   */
  @Get('unread/total')
  async getTotalUnreadCount(
    @Request() req: RequestWithUser,
  ): Promise<{ totalUnread: number }> {
    const totalUnread = await this.notificationService.getTotalUnreadCount(
      req.user.userId,
    );
    return { totalUnread };
  }

  /**
   * GET /messaging/conversations/:id
   * Récupérer une conversation par ID
   */
  @Get(':id')
  @UseGuards(ConversationAccessGuard)
  async getConversationById(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<ConversationResponseDto> {
    return this.conversationsService.getConversationById(id, req.user.userId);
  }

  /**
   * PATCH /messaging/conversations/:id
   * Mettre à jour une conversation (subject, status)
   */
  @Patch(':id')
  @UseGuards(ConversationAccessGuard)
  async updateConversation(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ): Promise<ConversationResponseDto> {
    return this.conversationsService.updateConversation(
      id,
      req.user.userId,
      dto,
    );
  }

  /**
   * PATCH /messaging/conversations/:id/archive
   * Archiver une conversation (salon uniquement)
   */
  @Patch(':id/archive')
  @UseGuards(ConversationAccessGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async archiveConversation(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.conversationsService.archiveConversation(id, req.user.userId);
  }

  /**
   * PATCH /messaging/conversations/:id/mark-read
   * Marquer tous les messages d'une conversation comme lus
   */
  @Patch(':id/mark-read')
  @UseGuards(ConversationAccessGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllAsRead(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.conversationsService.markAllAsRead(id, req.user.userId);
  }

  /**
   * DELETE /messaging/conversations/:id
   * Supprimer une conversation (hard delete - salon uniquement)
   */
  @Delete(':id')
  @UseGuards(ConversationAccessGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConversation(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.conversationsService.deleteConversation(id, req.user.userId);
  }
}
