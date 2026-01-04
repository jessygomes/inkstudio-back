# 🚀 Phase 4 : Email Notifications - Planification

## 📋 Aperçu

La Phase 4 ajoute la notification par email quand un utilisateur reçoit un message et n'est pas en ligne.

**Objectif**: Assurer qu'aucun message n'est manqué même si l'utilisateur est hors ligne.

## 🎯 Fonctionnalités Planifiées

### 1. Notification Email Simple
- Email envoyé quand nouveau message reçu
- Uniquement si destinataire n'est pas connecté
- Link direct vers la conversation
- Template personnalisé en français

### 2. Smart Notifications
- Ne pas envoyer si utilisateur a consulté le message dans les 5 mins
- Grouper les messages (ex: 3 messages → 1 email)
- Rate limiting (max 1 email par conversation par heure)

### 3. Préférences Utilisateur
- Paramètre pour désactiver les notifications email
- Fréquence: Immédiat, Hourly, Daily, Never
- Exceptions par conversation

## 📂 Architecture Prévue

```
Phase 4 Structure:
├── src/messaging/
│   ├── notifications/
│   │   ├── message-notification.service.ts (EXISTS)
│   │   ├── email-notification.service.ts (NEW)
│   │   └── notification-preference.service.ts (NEW)
│   └── jobs/
│       └── send-email-notifications.job.ts (NEW)
├── src/database/
│   └── prisma.service.ts (uses Prisma Client)
└── prisma/
    └── migrations/
        └── add_notification_preferences/
```

## 🛠️ Implémentation Prévue

### 1. Extension du Modèle Prisma

```prisma
// prisma/schema.prisma - À ajouter

model NotificationPreference {
  id String @id @default(cuid())
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  emailNotificationsEnabled Boolean @default(true)
  emailFrequency String @default("IMMEDIATE") // IMMEDIATE, HOURLY, DAILY, NEVER
  mutedConversations String[] @default([]) // conversationIds
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId])
}

model EmailNotificationQueue {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(fields: [conversationId], references: [id])
  recipientUserId String
  messageCount Int @default(1)
  
  status String @default("PENDING") // PENDING, SENT, FAILED
  sentAt DateTime?
  failureReason String?
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([recipientUserId])
  @@index([status])
  @@index([conversationId])
}
```

### 2. EmailNotificationService

```typescript
// src/messaging/notifications/email-notification.service.ts

@Injectable()
export class EmailNotificationService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private notificationPreferenceService: NotificationPreferenceService
  ) {}

  /**
   * Vérifier si on doit envoyer une notification email
   */
  async shouldSendNotification(
    conversationId: string,
    recipientUserId: string
  ): Promise<boolean> {
    // 1. Vérifier préférences utilisateur
    const prefs = await this.notificationPreferenceService.getPreferences(
      recipientUserId
    );
    
    if (!prefs.emailNotificationsEnabled) return false;
    if (prefs.mutedConversations.includes(conversationId)) return false;

    // 2. Vérifier si utilisateur est en ligne (via gateway)
    // Pour l'instant, on considère tous hors ligne

    // 3. Vérifier si email a été envoyé récemment (rate limiting)
    const recentEmail = await this.prisma.emailNotificationQueue.findFirst({
      where: {
        conversationId,
        recipientUserId,
        status: 'SENT',
        sentAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } // 1 heure
      }
    });

    if (recentEmail) return false; // Rate limit: max 1 email/heure par conv

    return true;
  }

  /**
   * Queuer une notification email
   */
  async queueNotification(
    conversationId: string,
    recipientUserId: string
  ): Promise<void> {
    // Vérifier si déjà en queue
    const existing = await this.prisma.emailNotificationQueue.findFirst({
      where: {
        conversationId,
        recipientUserId,
        status: 'PENDING'
      }
    });

    if (existing) {
      // Incrémenter le compteur
      await this.prisma.emailNotificationQueue.update({
        where: { id: existing.id },
        data: { messageCount: existing.messageCount + 1 }
      });
    } else {
      // Créer nouvelle entry
      await this.prisma.emailNotificationQueue.create({
        data: {
          conversationId,
          recipientUserId,
          messageCount: 1
        }
      });
    }
  }

  /**
   * Envoyer l'email (appelé par Bull job)
   */
  async sendNotification(queueId: string): Promise<void> {
    const queue = await this.prisma.emailNotificationQueue.findUnique({
      where: { id: queueId },
      include: {
        conversation: {
          include: {
            salon: true,
            clientUser: true,
            messages: {
              take: -1, // Derniers messages
              orderBy: { createdAt: 'desc' }
            }
          }
        }
      }
    });

    if (!queue) return;

    const { conversation, recipientUserId, messageCount } = queue;
    const recipient = conversation.clientUserId === recipientUserId
      ? conversation.clientUser
      : conversation.salon;

    const sender = conversation.clientUserId === recipientUserId
      ? conversation.salon
      : conversation.clientUser;

    // Préparer le contenu email
    const subject = messageCount > 1
      ? `${messageCount} nouveaux messages de ${sender.salonName || sender.firstName}`
      : `Nouveau message de ${sender.salonName || sender.firstName}`;

    const html = this.generateEmailHTML({
      recipientName: recipient.firstName,
      senderName: sender.salonName || sender.firstName,
      messageCount,
      conversationLink: `${process.env.FRONTEND_URL}/conversations/${conversation.id}`,
      latestMessages: conversation.messages.slice(0, 3)
    });

    // Envoyer l'email
    try {
      await this.mailService.sendMail({
        to: recipient.email,
        subject,
        html
      });

      // Marquer comme SENT
      await this.prisma.emailNotificationQueue.update({
        where: { id: queueId },
        data: {
          status: 'SENT',
          sentAt: new Date()
        }
      });
    } catch (error) {
      // Marquer comme FAILED
      await this.prisma.emailNotificationQueue.update({
        where: { id: queueId },
        data: {
          status: 'FAILED',
          failureReason: error.message
        }
      });
    }
  }

  /**
   * Générer le template HTML de l'email
   */
  private generateEmailHTML(data: {
    recipientName: string;
    senderName: string;
    messageCount: number;
    conversationLink: string;
    latestMessages: Message[];
  }): string {
    const { recipientName, senderName, messageCount, conversationLink, latestMessages } = data;

    return `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2>Bonjour ${recipientName},</h2>
          
          <p>
            ${messageCount === 1
              ? `Vous avez reçu un nouveau message de ${senderName}`
              : `Vous avez reçu ${messageCount} nouveaux messages de ${senderName}`
            }
          </p>

          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            ${latestMessages.map(msg => `
              <div style="margin-bottom: 10px;">
                <strong>${senderName}:</strong>
                <p>${msg.content}</p>
                <small style="color: #999;">${new Date(msg.createdAt).toLocaleString('fr-FR')}</small>
              </div>
            `).join('')}
          </div>

          <a href="${conversationLink}" 
             style="display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px;">
            Voir la conversation
          </a>

          <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;">
          
          <small style="color: #999;">
            <p>Vous recevez cet email parce que ${senderName} vous a envoyé un message.</p>
            <a href="${process.env.FRONTEND_URL}/settings/notifications">Gérer vos préférences de notification</a>
          </small>
        </body>
      </html>
    `;
  }
}
```

### 3. NotificationPreferenceService

```typescript
// src/messaging/notifications/notification-preference.service.ts

@Injectable()
export class NotificationPreferenceService {
  constructor(private prisma: PrismaService) {}

  async getPreferences(userId: string): Promise<NotificationPreference> {
    let prefs = await this.prisma.notificationPreference.findUnique({
      where: { userId }
    });

    if (!prefs) {
      // Créer les préférences par défaut
      prefs = await this.prisma.notificationPreference.create({
        data: { userId }
      });
    }

    return prefs;
  }

  async updatePreferences(
    userId: string,
    data: Partial<NotificationPreference>
  ): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data }
    });
  }

  async muteConversation(userId: string, conversationId: string): Promise<void> {
    const prefs = await this.getPreferences(userId);
    const muted = new Set(prefs.mutedConversations);
    muted.add(conversationId);

    await this.updatePreferences(userId, {
      mutedConversations: Array.from(muted)
    });
  }

  async unmuteConversation(userId: string, conversationId: string): Promise<void> {
    const prefs = await this.getPreferences(userId);
    const muted = new Set(prefs.mutedConversations);
    muted.delete(conversationId);

    await this.updatePreferences(userId, {
      mutedConversations: Array.from(muted)
    });
  }
}
```

### 4. Bull Job pour Envoyer les Emails

```typescript
// src/messaging/jobs/send-email-notifications.job.ts

import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { EmailNotificationService } from '../notifications/email-notification.service';

@Processor('email-notifications')
export class SendEmailNotificationsJob {
  constructor(private emailNotificationService: EmailNotificationService) {}

  @Process('send-queued')
  async sendQueued(job: Job) {
    // Récupérer les emails en attente
    const prisma = job.data.prismaService;
    
    const pendingEmails = await prisma.emailNotificationQueue.findMany({
      where: { status: 'PENDING' }
    });

    for (const email of pendingEmails) {
      await this.emailNotificationService.sendNotification(email.id);
    }

    return { sent: pendingEmails.length };
  }
}
```

### 5. Intégration dans MessagesGateway

```typescript
// Modification de messages.gateway.ts

export class MessagesGateway {
  constructor(
    // ... autres injections
    private emailNotificationService: EmailNotificationService
  ) {}

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CreateMessagePayload,
  ) {
    // ... message creation code

    // Après le message créé:
    const otherUserId = conversation.salonId === userId
      ? conversation.clientUserId
      : conversation.salonId;

    // Vérifier si on doit envoyer une notification email
    const shouldNotify = await this.emailNotificationService.shouldSendNotification(
      conversationId,
      otherUserId
    );

    if (shouldNotify) {
      await this.emailNotificationService.queueNotification(
        conversationId,
        otherUserId
      );
    }
  }
}
```

## 📊 Endpoints REST (Phase 4)

### Settings de Notifications

```http
GET  /messaging/notifications/preferences
     Récupérer les préférences de l'utilisateur
     Response: NotificationPreference

PATCH /messaging/notifications/preferences
      Mettre à jour les préférences
      Body: { emailNotificationsEnabled?, emailFrequency? }
      Response: NotificationPreference

POST  /messaging/conversations/:conversationId/mute
      Mute les notifications d'une conversation
      Response: 204

POST  /messaging/conversations/:conversationId/unmute
      Unmute les notifications d'une conversation
      Response: 204
```

## 🗓️ Timeline Estimée

| Tâche | Durée | Dépendances |
|-------|-------|-------------|
| Ajouter tables Prisma | 0.5h | Phase 3 ✅ |
| Migration DB | 0.5h | Schéma Prisma |
| EmailNotificationService | 2h | MailService existant |
| NotificationPreferenceService | 1h | EmailNotification |
| Bull Job config | 1h | Bull 4.16.5 déjà installé |
| Intégration Gateway | 1h | Services prêts |
| Endpoints REST | 1.5h | Services prêts |
| Tests unitaires | 2h | Services prêts |
| Documentation | 1h | Code final |
| **TOTAL** | **10h** | - |

## ✅ Checklist Phase 4

- [ ] Design du schéma NotificationPreference
- [ ] Créer migration Prisma
- [ ] Implémenter EmailNotificationService
- [ ] Implémenter NotificationPreferenceService
- [ ] Configurer Bull pour les emails
- [ ] Intégrer dans MessagesGateway
- [ ] Créer endpoints REST pour préférences
- [ ] Tests unitaires (services + job)
- [ ] Tests E2E (envoi d'email)
- [ ] Documentation complète
- [ ] Déployer en staging
- [ ] Tests en production

## 🔌 Configuration Bull (Phase 4)

```typescript
// app.module.ts

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'email-notifications',
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379')
      }
    })
  ]
})
export class AppModule {}
```

## 📝 Variables d'Environnement (Phase 4)

```env
# Email (déjà existant)
MAILGUN_API_KEY=...
MAILGUN_DOMAIN=...

# Bull/Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Frontend (pour les liens)
FRONTEND_URL=https://salon.example.com
```

## 🎯 Résultats Attendus (Phase 4)

### Avant Phase 4
- Utilisateur hors ligne ne reçoit une notification que via WebSocket (perdue)
- Aucun moyen de savoir qu'il y a des messages si on n'ouvre pas l'app

### Après Phase 4
- Email envoyé immédiatement quand message reçu (utilisateur offline)
- Link direct vers la conversation dans l'email
- Préférences utilisateur pour contrôler les notifications
- Option pour mute une conversation
- Rate limiting: max 1 email par heure par conversation

## 🚀 Intégration Future (Phase 5+)

### SMS Notifications (Phase 5+)
```typescript
// Optional: Twilio integration
await this.smsService.sendSMS(recipientPhone, message);
```

### Push Notifications (Phase 5+)
```typescript
// Optional: Firebase Cloud Messaging
await this.pushService.sendPush(recipientUserId, notification);
```

### WebSocket Notification (Phase 5+)
```typescript
// Tell user via WebSocket about pending emails
this.messagesGateway.notifyUser(userId, 'email-notification-sent', data);
```

## 📚 Documentation Phase 4

Fichiers à créer:
1. `Notes/PHASE4_EMAIL_NOTIFICATIONS.md` - Docs complètes
2. `Notes/EMAIL_NOTIFICATION_SETUP.md` - Instructions setup
3. `Notes/NOTIFICATION_PREFERENCES_API.md` - API docs

## 🔒 Considérations Sécurité (Phase 4)

- Vérifier l'email avant d'envoyer
- Rate limit: max 10 emails/minute par utilisateur
- Sanitizer le contenu HTML pour éviter XSS
- Logs de tous les envois d'emails
- Soft-fail: erreur d'email ne bloque pas le message

---

## 📍 Statut Actuel

✅ **Phase 3: WebSocket** - COMPLÈTE  
⏳ **Phase 4: Email Notifications** - À DÉMARRER  
⏳ **Phase 5: Optimizations** - À PLANIFIER  
⏳ **Phase 6: Auto-archival** - À PLANIFIER  
⏳ **Phase 7: Tests & Docs** - À PLANIFIER

**Prochaine action**: Démarrer Phase 4 - Email Notifications
