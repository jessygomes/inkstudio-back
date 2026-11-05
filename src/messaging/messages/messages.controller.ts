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
  Headers,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SecurityThrottle } from '../../auth/security-throttle';
import {
  AppointmentPhotoUploadService,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_UPLOAD,
} from '../../appointment-photos/appointment-photo-upload.service';
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
  constructor(
    private readonly messagesService: MessagesService,
    private readonly imageUploads: AppointmentPhotoUploadService,
  ) {}

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
   * POST /messaging/conversations/:conversationId/attachments/upload
   * Envoi d'images (multipart, champ « files ») pour l'app mobile : stockage UploadThing avec le quota du site.
   * Renvoie les pièces jointes à passer ensuite au message (socket `send-message`) ; le web, lui, passe par UploadThing.
   */
  @Post('conversations/:conversationId/attachments/upload')
  @UseGuards(ConversationAccessGuard)
  @SecurityThrottle('upload')
  @UseInterceptors(
    FilesInterceptor('files', MAX_PHOTOS_PER_UPLOAD, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS_PER_UPLOAD },
    }),
  )
  async uploadAttachments(
    @Request() req: RequestWithUser,
    @UploadedFiles() files: Express.Multer.File[],
    @Headers('authorization') authorization?: string,
  ) {
    // Mêmes formats que la validation des pièces jointes (MessageAttachmentDto).
    const images = await this.imageUploads.storeImages(req.user.userId, files ?? [], authorization, ['jpeg', 'png', 'webp', 'gif']);
    return images.map((image) => ({
      fileName: image.name,
      fileUrl: image.url,
      fileType: image.type,
      fileSize: image.size,
      uploadThingKey: image.key,
    }));
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
