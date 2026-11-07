import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NOTIFICATION_CATEGORIES, NotificationCategory } from './notification-catalog';
import { NotificationsService } from './notifications.service';

class ListQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() unreadOnly?: boolean;
}

class UpdatePreferenceDto {
  @IsIn([...NOTIFICATION_CATEGORIES]) category: NotificationCategory;
  @IsOptional() @IsBoolean() inApp?: boolean;
  @IsOptional() @IsBoolean() push?: boolean;
}

type AuthedRequest = { user?: { userId?: string } };
const uid = (req: AuthedRequest): string => {
  const id = req.user?.userId;
  if (!id) throw new BadRequestException('Utilisateur introuvable');
  return id;
};

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query() q: ListQuery) {
    return this.service.list(uid(req), { cursor: q.cursor, limit: q.limit, unreadOnly: q.unreadOnly });
  }

  @Get('unread-count')
  async unread(@Req() req: AuthedRequest) {
    return { unreadCount: await this.service.unreadCount(uid(req)) };
  }

  @Get('preferences')
  preferences(@Req() req: AuthedRequest) {
    return this.service.getPreferences(uid(req));
  }

  @Patch('preferences')
  updatePreference(@Req() req: AuthedRequest, @Body() dto: UpdatePreferenceDto) {
    return this.service.updatePreference(uid(req), dto.category, { inApp: dto.inApp, push: dto.push });
  }

  @Post('read-all')
  readAll(@Req() req: AuthedRequest) {
    return this.service.markAllRead(uid(req));
  }

  @Patch(':id/read')
  read(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.service.markRead(uid(req), id);
  }

  @Delete(':id')
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.service.remove(uid(req), id);
  }
}
