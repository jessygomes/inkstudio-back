import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationPreference } from '@prisma/client';

@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Récupère les préférences d'un utilisateur, crée les valeurs par défaut si inexistantes
   */
  async getPreferences(userId: string): Promise<NotificationPreference> {
    let prefs = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });

    if (!prefs) {
      prefs = await this.prisma.notificationPreference.create({
        data: { userId, emailFrequency: 'HOURLY' },
      });
    }

    if (prefs.emailFrequency === 'IMMEDIATE') {
      prefs = await this.prisma.notificationPreference.update({ where: { userId }, data: { emailFrequency: 'HOURLY' } });
    }
    return prefs;
  }

  /**
   * Met à jour (ou crée) les préférences d'un utilisateur
   */
  async updatePreferences(
    userId: string,
    data: Partial<NotificationPreference>,
  ): Promise<NotificationPreference> {
    if (data.emailFrequency && !['HOURLY', 'DAILY', 'NEVER'].includes(data.emailFrequency)) {
      throw new BadRequestException('Choisissez une fréquence horaire, quotidienne ou jamais.');
    }
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      update: data,
      create: { userId, emailFrequency: 'HOURLY', ...data },
    });
  }

  /**
   * Ajoute une conversation à la liste des conversations muettes
   */
  async muteConversation(userId: string, conversationId: string): Promise<void> {
    const prefs = await this.getPreferences(userId);
    const muted = new Set(prefs.mutedConversations);
    muted.add(conversationId);

    await this.updatePreferences(userId, {
      mutedConversations: Array.from(muted),
    });
  }

  /**
   * Retire une conversation de la liste des conversations muettes
   */
  async unmuteConversation(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const prefs = await this.getPreferences(userId);
    const muted = new Set(prefs.mutedConversations);
    muted.delete(conversationId);

    await this.updatePreferences(userId, {
      mutedConversations: Array.from(muted),
    });
  }
}
