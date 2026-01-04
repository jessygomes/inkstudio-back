# 🎯 Système de Messagerie - Résumé Technique Complet

## Vue d'Ensemble

Un système de messagerie **production-ready** entre le salon et les clients avec :
- ✅ Communication REST pour les opérations statiques
- ✅ Communication WebSocket temps réel avec Socket.IO
- ✅ Authentification JWT sécurisée
- ✅ Gestion complète du cycle de vie
- ✅ Support multi-sessions (plusieurs onglets/appareils)
- ✅ TypeScript strict mode

## Architecture Globale

```
┌─────────────┐                    ┌──────────────┐
│   CLIENT    │                    │  SALON ADMIN │
│  (Frontend) │◄──────WebSocket───►│  (Frontend)  │
└─────────────┘                    └──────────────┘
      │                                   │
      └─────────────────┬─────────────────┘
                        │ 
                        ▼
              ┌──────────────────┐
              │  NestJS Backend  │
              │   (Port 3000)    │
              └──────────────────┘
                        │
                        ├─── REST Endpoints (Conversations, Messages)
                        ├─── WebSocket Gateway (/messaging)
                        └─── Database (PostgreSQL + Prisma)
```

## 🗄️ Modèle de Données

```sql
-- Tables principales
CREATE TABLE Conversation {
  id UUID PRIMARY KEY
  salonId UUID (Foreign Key → User)
  clientUserId UUID (Foreign Key → User)
  appointmentId UUID (Foreign Key → Appointment) UNIQUE
  status ENUM('ACTIVE', 'ARCHIVED')
  subject String
  createdAt DateTime
  updatedAt DateTime
  lastMessageAt DateTime
}

CREATE TABLE Message {
  id UUID PRIMARY KEY
  conversationId UUID (Foreign Key → Conversation)
  authorId UUID (Foreign Key → User)
  content String
  isDeleted Boolean DEFAULT false
  readAt DateTime (nullable)
  createdAt DateTime
  updatedAt DateTime
}

CREATE TABLE MessageAttachment {
  id UUID PRIMARY KEY
  messageId UUID (Foreign Key → Message)
  url String
  type String (MIME type)
  createdAt DateTime
}

CREATE TABLE MessageNotification {
  id UUID PRIMARY KEY
  conversationId UUID (Foreign Key → Conversation)
  userId UUID (Foreign Key → User)
  unreadCount Int DEFAULT 0
  createdAt DateTime
  updatedAt DateTime
  UNIQUE(conversationId, userId)
}
```

## 📡 Endpoints REST

### Conversations

```http
POST   /messaging/conversations
       Créer une conversation
       Body: { clientUserId, appointmentId?, subject, firstMessage? }
       Response: ConversationResponseDto

GET    /messaging/conversations?page=1&limit=20&status=ACTIVE
       Lister les conversations
       Response: PaginatedConversationsDto

GET    /messaging/conversations/:id
       Détails d'une conversation
       Response: ConversationResponseDto

PATCH  /messaging/conversations/:id
       Mettre à jour subject/status
       Body: { subject?, status? }
       Response: ConversationResponseDto

PATCH  /messaging/conversations/:id/archive
       Archiver une conversation (salon uniquement)
       Response: 204 No Content

PATCH  /messaging/conversations/:id/mark-read
       Marquer tous les messages comme lus
       Response: 204 No Content

DELETE /messaging/conversations/:id
       Supprimer une conversation (salon uniquement)
       Response: 204 No Content
```

### Messages

```http
POST   /messaging/conversations/:conversationId/messages
       Envoyer un message
       Body: { content, attachments[] }
       Response: MessageResponseDto (201)

GET    /messaging/conversations/:conversationId/messages?page=1&limit=50
       Lister les messages
       Response: PaginatedMessagesDto

PATCH  /messaging/messages/:messageId/read
       Marquer un message comme lu
       Response: MessageResponseDto

DELETE /messaging/messages/:messageId
       Supprimer un message (auteur uniquement)
       Response: 204 No Content
```

## 🔌 Événements WebSocket

### Namespace: `/messaging`

#### Client → Server

```typescript
// Rejoindre une conversation
socket.emit('join-conversation', {
  conversationId: string
})

// Quitter une conversation
socket.emit('leave-conversation', {
  conversationId: string
})

// Envoyer un message
socket.emit('send-message', {
  conversationId: string
  content: string
  attachments?: Array<{
    url: string
    type: string // image/jpeg, image/png, etc.
  }>
})

// Marquer un message comme lu
socket.emit('mark-as-read', {
  messageId: string
})

// Marquer une conversation comme lue
socket.emit('mark-conversation-as-read', {
  conversationId: string
})

// Indicateur : utilisateur écrit
socket.emit('user-typing', {
  conversationId: string
})

// Indicateur : utilisateur arrête d'écrire
socket.emit('user-stopped-typing', {
  conversationId: string
})
```

#### Server → Client

```typescript
// Nouveau message reçu
socket.on('new-message', {
  id: string
  conversationId: string
  content: string
  authorId: string
  attachments: MessageAttachment[]
  createdAt: DateTime
})

// Message marqué comme lu
socket.on('message-read', {
  messageId: string
  readAt: DateTime
})

// Utilisateur en train d'écrire
socket.on('user-typing', {
  conversationId: string
  userId: string
  userName: string
})

// Utilisateur a arrêté d'écrire
socket.on('user-stopped-typing', {
  conversationId: string
  userId: string
})

// Utilisateur en ligne
socket.on('user-online', {
  userId: string
  userName: string
})

// Utilisateur hors ligne
socket.on('user-offline', {
  userId: string
})

// Compteur de messages non lus
socket.on('unread-count-updated', {
  totalUnread: number
})

// Erreur
socket.on('error', {
  message: string
})
```

## 🔐 Authentification

### JWT Token Structure

```json
{
  "userId": "user-550e8400",
  "email": "user@salon.com",
  "role": "salon",
  "iat": 1704067200,
  "exp": 1704153600
}
```

### WebSocket Handshake

```javascript
// Client
const socket = io('http://localhost:3000/messaging', {
  auth: {
    token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  }
});

// Server
// 1. Reçoit le token dans client.handshake.auth.token
// 2. Valide avec JwtService
// 3. Extrait userId du payload
// 4. Enregistre socket → userId mapping
// 5. Déconnecte si token invalide
```

## 🎯 Flux Principal d'Utilisation

### 1. Création d'une Conversation (Auto-trigger)

```
Client crée un RDV
        ↓
AppointmentsService.create() ou createByClient()
        ↓
ConversationsService.createConversation()
        ↓
Message système créé en français
        ↓
Conversation créée avec appointmentId unique
        ↓
Client peut commencer à converser
```

### 2. Échange de Messages

```
Client/Salon envoie message (REST ou WebSocket)
        ↓
MessagesService.sendMessage()
        ↓
Message créé + attachments
        ↓
lastMessageAt de conversation mise à jour
        ↓
unreadCount incrémenté pour l'autre participant
        ↓
new-message broadcasted via WebSocket
        ↓
Autre client reçoit notification instantanée
```

### 3. Marquer Comme Lu

```
Client/Salon marks message as read
        ↓
MessagesService.markAsRead()
        ↓
readAt timestamp enregistré
        ↓
message-read broadcasted
        ↓
unreadCount décrémenté
        ↓
unread-count-updated notifié
```

## 📊 Flow de Données Complet

```
┌──────────────────────────────────────────────────────────┐
│                    FRONTEND SALON                         │
│  • Affiche conversations + messages                       │
│  • Envoie/reçoit messages                                 │
│  • Voit les clients en ligne/hors ligne                   │
└──────────────────────────────────────────────────────────┘
              WebSocket ↕ REST
┌──────────────────────────────────────────────────────────┐
│                  BACKEND NESTJS                           │
│                                                            │
│  Controllers (REST Endpoints)                            │
│  ├─ ConversationsController                              │
│  └─ MessagesController                                   │
│                                                            │
│  Services                                                 │
│  ├─ ConversationsService                                 │
│  ├─ MessagesService                                       │
│  ├─ MessageNotificationService                           │
│  └─ WebSocketAuthService                                 │
│                                                            │
│  Gateway (WebSocket)                                     │
│  └─ MessagesGateway                                      │
│     ├─ onConnect: Auth + Register                        │
│     ├─ onDisconnect: Cleanup                             │
│     ├─ handleJoinConversation: Join room                 │
│     ├─ handleSendMessage: Create + Broadcast            │
│     ├─ handleMarkAsRead: Update + Broadcast              │
│     └─ handleUserTyping: Broadcast indicator             │
│                                                            │
│  Database (Prisma)                                        │
│  ├─ Conversation                                          │
│  ├─ Message + MessageAttachment                          │
│  └─ MessageNotification                                  │
└──────────────────────────────────────────────────────────┘
              Database ↕ PostgreSQL
```

## 🔄 Intégration avec Appointments

```typescript
// Dans AppointmentsService

async create(createAppointmentDto: CreateAppointmentDto) {
  // Créer le RDV
  const appointment = await this.prisma.appointment.create({
    data: { /* ... */ }
  });

  // Auto-créer conversation si client existe
  if (clientUser?.id) {
    try {
      await this.conversationsService.createConversation(
        salonId,
        {
          clientUserId: clientUser.id,
          appointmentId: appointment.id,
          subject: `Appointment: ${appointmentLabel}`,
          firstMessage: `Bonjour ${clientUser.firstName}, votre rendez-vous a été confirmé...`
        }
      );
    } catch (error) {
      // Log mais ne bloque pas la création de RDV
      this.logger.error('Failed to create conversation', error);
    }
  }

  return appointment;
}
```

## 📈 Performances & Optimisations

### Actuelles (Phase 3)
- ✅ Pagination des conversations (20 par page)
- ✅ Pagination des messages (50 par page)
- ✅ Indexes sur conversationId et userId
- ✅ Unique constraint sur (conversationId, userId)
- ✅ Caching du compteur de messages non lus

### Futures (Phase 5)
- [ ] Redis adapter pour multi-serveur
- [ ] Redis cache pour user online status
- [ ] Compression des messages WebSocket
- [ ] Lazy-loading des attachments
- [ ] CDN pour images (UploadThing)

### Indices Base de Données
```sql
CREATE INDEX idx_conversation_salonId ON Conversation(salonId);
CREATE INDEX idx_conversation_clientUserId ON Conversation(clientUserId);
CREATE INDEX idx_message_conversationId ON Message(conversationId);
CREATE INDEX idx_message_authorId ON Message(authorId);
CREATE INDEX idx_message_createdAt ON Message(createdAt DESC);
```

## 🧪 Scénarios de Test

### 1. Création Conversation
```
1. Créer RDV via API
2. Vérifier conversation créée
3. Vérifier message système
4. Vérifier appointmentId unique
```

### 2. Envoi Message
```
1. Connecter 2 clients WebSocket
2. Client 1 envoie message
3. Client 2 reçoit new-message instant
4. unreadCount incremented for Client 2
```

### 3. Marquer Comme Lu
```
1. Message créé avec readAt = null
2. Client marque comme lu
3. readAt timestamp enregistré
4. Autre client reçoit message-read
```

### 4. Typing Indicator
```
1. Client 1 tape
2. Client 1 émet user-typing
3. Client 2 reçoit user-typing
4. Client 1 arrête (300ms)
5. Client 1 émet user-stopped-typing
6. Client 2 reçoit user-stopped-typing
```

### 5. Présence Online/Offline
```
1. Client 1 se connecte
2. Tous reçoivent user-online
3. Client 1 se déconnecte
4. Tous reçoivent user-offline
```

## 🚀 Déploiement

### Prérequis
- Node.js 18+
- PostgreSQL 14+
- Redis 6+ (optionnel, pour Phase 5)

### Variables d'Environnement
```env
# JWT
JWT_SECRET=your-secret-key-min-32-chars

# WebSocket/CORS
FRONTEND_URL=https://salon.example.com
FRONTEND_URL_BIS=https://www.salon.example.com
FRONTEND_URL_FR=https://salon.fr
FRONTEND_URL_FR_BIS=https://www.salon.fr

# Database
DATABASE_URL=postgresql://user:password@host/dbname

# Server
PORT=3000
NODE_ENV=production
```

### Build & Run
```bash
# Development
npm install
npm run dev

# Production
npm install
npm run build
npm run start:prod
```

## 📚 Fichiers Clés

| Fichier | Lignes | Responsabilité |
|---------|--------|-----------------|
| `src/messaging/conversations/conversations.service.ts` | 350+ | CRUD conversations |
| `src/messaging/messages/messages.service.ts` | 280+ | CRUD messages |
| `src/messaging/notifications/message-notification.service.ts` | 80+ | Compteur non lus |
| `src/messaging/websocket/messages.gateway.ts` | 420+ | Temps réel WebSocket |
| `src/messaging/websocket/websocket-auth.service.ts` | 50+ | Auth JWT WebSocket |
| `src/appointments/appointments.service.ts` | ~25 lignes modifiées | Auto-création conversations |

## 🔍 Monitoring & Logging

### Logs Gateway
```
[MessagesGateway] MessagesGateway initialized
[MessagesGateway] Client socket-abc123 connecté - User user-550e
[MessagesGateway] User user-550e a rejoint la conversation conv-123
[MessagesGateway] Message créé dans la conversation conv-123
[MessagesGateway] User user-550e a quitté la conversation conv-123
[MessagesGateway] Client socket-abc123 déconnecté - User user-550e
[MessagesGateway] User user-550e complètement déconnecté
```

### Métriques à Tracker
- Nombre de connections WebSocket actives
- Latence des messages WebSocket
- Nombre de messages envoyés/hour
- Taux de conversations archivées
- Temps moyen de réponse REST endpoints

## 🎓 Considérations Techniques

### État Distribué
```typescript
// Gateway maintient un état in-memory:
private userConnections: Map<string, Set<string>>  // userId → socketIds
private socketUserMap: Map<string, string>         // socketId → userId
private typingUsers: Map<string, Set<string>>      // conversationId → userIds

// ⚠️ En multi-serveur, utiliser Redis pour partager cet état
// Redis Adapter: @socket.io/redis-adapter
```

### Gestion des Erreurs
```typescript
try {
  // Opération WebSocket
} catch (error) {
  logger.error('Error occurred:', error);
  client.emit('error', { message: 'User-friendly error' });
  // Ne pas crasher le gateway
}
```

### Cycle de Vie Socket
```
1. Client se connecte avec token
2. handleConnection: Auth + Register dans userConnections
3. Client émet events: join-conversation, send-message, etc.
4. Client se déconnecte
5. handleDisconnect: Nettoyer le socket + test si complètement offline
```

## 🔑 Points Clés d'Implémentation

1. **JWT Auth**: Token passé dans `auth.token` au handshake
2. **Rooms**: `conversation-{conversationId}` pour targeting
3. **Broadcasting**: `server.to(room).emit()` pour audience
4. **Erreurs**: Toujours `client.emit('error', {message})`
5. **Typing**: Debounce 300ms recommandé côté frontend
6. **Sessions**: Map<userId, Set<socketId>> pour multi-onglets

## ✅ Checklist Pré-Production

- [ ] FRONTEND_URL configuré correctement
- [ ] JWT_SECRET changé (min 32 chars)
- [ ] Database migrations appliquées
- [ ] Indices de performance vérifiés
- [ ] Logging configuré
- [ ] CORS whitelisting correct
- [ ] Rate limiting ? (optionnel)
- [ ] Monitoring/alerting en place
- [ ] Backup strategy
- [ ] Tests manuels avec Socket.IO client

---

**Statut:** Phase 3 Complète ✅  
**Build:** Successful ✅  
**Prêt pour:** Déploiement ou Phase 4
