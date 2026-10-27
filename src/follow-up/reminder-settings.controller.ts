import {
  Body,
  Controller,
  Get,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/auth/jwt.strategy';
import { ReminderSettingsService } from './reminder-settings.service';
import { REMINDER_CHANNELS, ReminderChannel } from './reminder-settings';

export class UpdateReminderSettingsDto {
  @IsInt()
  @Min(1)
  @Max(365)
  followUpEmailDelayDays: number;
  @IsInt()
  @Min(1)
  @Max(365)
  retouchEmailDelayDays: number;
  @IsIn(REMINDER_CHANNELS)
  followUpDeliveryChannel: ReminderChannel;
  @IsIn(REMINDER_CHANNELS)
  retouchDeliveryChannel: ReminderChannel;
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  followUpMessage: string;
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  retouchMessage: string;
}

@Controller('follow-up/settings')
@UseGuards(JwtAuthGuard)
export class ReminderSettingsController {
  constructor(private readonly settings: ReminderSettingsService) {}
  @Get()
  get(@Request() req: RequestWithUser) {
    return this.settings.get(req.user.userId);
  }
  @Patch()
  update(
    @Request() req: RequestWithUser,
    @Body() body: UpdateReminderSettingsDto,
  ) {
    return this.settings.update(req.user.userId, body);
  }
}
