import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CacheService } from 'src/redis/cache.service';
import { UpdateReminderSettingsDto } from './reminder-settings.controller';
import {
  DEFAULT_FOLLOW_UP_MESSAGE,
  DEFAULT_RETOUCH_MESSAGE,
  REMINDER_VARIABLES,
} from './reminder-settings';

@Injectable()
export class ReminderSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private async professional(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        followUpEmailDelayDays: true,
        retouchEmailDelayDays: true,
        followUpDeliveryChannel: true,
        retouchDeliveryChannel: true,
        followUpMessage: true,
        retouchMessage: true,
      },
    });
    if (!user || !['user_salon', 'user_tatoueur', 'user'].includes(user.role))
      throw new ForbiddenException(
        'Ces réglages sont réservés aux professionnels.',
      );
    return user;
  }

  async get(userId: string) {
    const { role: _role, ...user } = await this.professional(userId);
    void _role;
    return {
      settings: {
        ...user,
        followUpMessage: user.followUpMessage || DEFAULT_FOLLOW_UP_MESSAGE,
        retouchMessage: user.retouchMessage || DEFAULT_RETOUCH_MESSAGE,
      },
      defaults: {
        followUpMessage: DEFAULT_FOLLOW_UP_MESSAGE,
        retouchMessage: DEFAULT_RETOUCH_MESSAGE,
      },
    };
  }

  async update(userId: string, settings: UpdateReminderSettingsDto) {
    await this.professional(userId);
    for (const text of [settings.followUpMessage, settings.retouchMessage]) {
      if (!text.trim())
        throw new BadRequestException('Le message ne peut pas être vide.');
      const unknown = [...text.matchAll(/\{([^{}]+)\}/g)].find(
        (match) =>
          !(REMINDER_VARIABLES as readonly string[]).includes(match[1]),
      );
      if (unknown)
        throw new BadRequestException(`Variable inconnue : {${unknown[1]}}.`);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        followUpEmailDelayDays: settings.followUpEmailDelayDays,
        retouchEmailDelayDays: settings.retouchEmailDelayDays,
        followUpDeliveryChannel: settings.followUpDeliveryChannel,
        retouchDeliveryChannel: settings.retouchDeliveryChannel,
        followUpMessage: settings.followUpMessage.trim(),
        retouchMessage: settings.retouchMessage.trim(),
      },
    });
    await Promise.all([
      this.cache.del(`user:${userId}`),
      this.cache.del(`user:appointment-booking:${userId}`),
      this.cache.delPattern('user:slug:*'),
    ]);
    return this.get(userId);
  }
}
