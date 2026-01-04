import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { MessagesService } from './messages.service';
import { MessageAccessGuard } from './guards/message-access.guard';
import { ConversationAccessGuard } from '../conversations/guards/conversation-access.guard';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { PaginatedMessagesDto } from './dto/paginated-messages.dto';
import { RequestWithUser } from '../../auth/jwt.strategy';

@Controller('messaging')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  /**
   * POST /messaging/conversations/:conversationId/messages
   * Envoyer un nouveau message
   */
  @Post('conversations/:conversationId/messages')
  @UseGuards(ConversationAccessGuard)
  async sendMessage(
    @Request() req: RequestWithUser,
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateMessageDto,
  ): Promise<MessageResponseDto> {
    // S'assurer que le conversationId du DTO correspond au param
    dto.conversationId = conversationId;
    return this.messagesService.sendMessage(req.user.userId, dto);
  }

  /**
   * GET /messaging/conversations/:conversationId/messages
   * Récupérer les messages d'une conversation (paginé)
   */
  @Get('conversations/:conversationId/messages')
  @UseGuards(ConversationAccessGuard)
  async getMessages(
    @Request() req: RequestWithUser,
    @Param('conversationId') conversationId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedMessagesDto> {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;

    return this.messagesService.getMessages(
      conversationId,
      req.user.userId,
      pageNum,
      limitNum,
    );
  }

  /**
   * PATCH /messaging/messages/:messageId/read
   * Marquer un message comme lu
   */
  @Patch('messages/:messageId/read')
  @UseGuards(MessageAccessGuard)
  async markAsRead(
    @Request() req: RequestWithUser,
    @Param('messageId') messageId: string,
  ): Promise<MessageResponseDto> {
    return this.messagesService.markAsRead(messageId, req.user.userId);
  }

  /**
   * DELETE /messaging/messages/:messageId
   * Supprimer un message (auteur uniquement)
   */
  @Delete('messages/:messageId')
  @UseGuards(MessageAccessGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMessage(
    @Request() req: RequestWithUser,
    @Param('messageId') messageId: string,
  ): Promise<void> {
    return this.messagesService.deleteMessage(messageId, req.user.userId);
  }
}
