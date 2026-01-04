# Phase 3 : Implémentation WebSocket - Documentation

## Overview

La Phase 3 ajoute la communication en temps réel via Socket.IO au système de messagerie. Cela permet aux clients et au salon de communiquer instantanément sans nécessiter de rafraîchir la page.

## Fichiers Créés

### 1. `src/messaging/websocket/message-events.ts`
**Description**: Définition des interfaces TypeScript pour tous les événements WebSocket.

**Événements Client → Server**:
- `CreateMessagePayload`: Envoyer un message avec contenu et pièces jointes
- `MarkAsReadPayload`: Marquer un message comme lu
- `MarkConversationAsReadPayload`: Marquer tous les messages d'une conversation comme lus
- `JoinConversationPayload`: Rejoindre une room de conversation
- `LeaveConversationPayload`: Quitter une room de conversation
- `UserTypingPayload`: Signaler que l'utilisateur écrit
- `UserStoppedTypingPayload`: Signaler que l'utilisateur a arrêté d'écrire

**Événements Server → Client**:
- `NewMessageEvent`: Notification d'un nouveau message
- `MessageReadEvent`: Notification qu'un message a été lu
- `UserTypingEvent`: Notification qu'un utilisateur écrit
- `UserStoppedTypingEvent`: Notification que l'utilisateur a arrêté d'écrire
- `UserOnlineEvent`: Notification qu'un utilisateur est en ligne
- `UserOfflineEvent`: Notification qu'un utilisateur est hors ligne
- `UnreadCountUpdatedEvent`: Mise à jour du compteur de messages non lus
- `ConversationCreatedEvent`: Notification de création d'une nouvelle conversation

### 2. `src/messaging/websocket/messages.gateway.ts`
**Description**: Gateway WebSocket principal gérant toutes les connexions et événements.

**Responsabilités**:
- Authentification des connexions via token JWT
- Gestion du cycle de vie des connexions (connexion/déconnexion)
- Tracking des utilisateurs connectés et de leurs sessions
- Gestion des rooms Socket.IO (une room par conversation)
- Broadcasting des événements aux utilisateurs et conversations appropriés
- Gestion des indicateurs de typing

**Propriétés Principales**:
```typescript
private userConnections: Map<string, Set<string>>  // userId → Set<socketId>
private socketUserMap: Map<string, string>         // socketId → userId
private typingUsers: Map<string, Set<string>>      // conversationId → Set<userId>
```

**Handlers Implémentés**:
- `handleConnection()`: Authentifier et enregistrer une nouvelle connexion
- `handleDisconnect()`: Nettoyer les traces de déconnexion
- `handleJoinConversation()`: Ajouter l'utilisateur à une room et charger l'historique
- `handleLeaveConversation()`: Retirer l'utilisateur d'une room
- `handleSendMessage()`: Créer un message et le broadcaster
- `handleMarkAsRead()`: Marquer un message comme lu
- `handleMarkConversationAsRead()`: Marquer tous les messages d'une conversation comme lus
- `handleUserTyping()`: Broadcaster l'indicateur de typing
- `handleUserStoppedTyping()`: Arrêter l'indicateur de typing

**Méthodes Utilitaires**:
- `notifyUser(userId, event, data)`: Envoyer une notification à un utilisateur
- `notifyConversation(conversationId, event, data)`: Envoyer une notification à une conversation

### 3. `src/messaging/websocket/websocket-auth.service.ts`
**Description**: Service pour valider les tokens JWT dans les connexions WebSocket.

**Méthodes**:
- `validateToken(token)`: Vérifier et extraire le userId du token JWT
- `extractTokenFromHeader(authHeader)`: Extraire le token du header Authorization
- `validateAuthHeader(authHeader)`: Valider un token depuis le header Authorization

## Dépendances Installées

```bash
npm install @nestjs/websockets socket.io @types/socket.io
```

Les packages suivants ont été ajoutés au projet:
- `@nestjs/websockets`: Intégration WebSocket avec NestJS
- `socket.io`: Bibliothèque de transport en temps réel
- `@types/socket.io`: Définitions TypeScript pour Socket.IO

## Configuration

### Application Principale (`src/main.ts`)
Le fichier main.ts a été mis à jour pour supporter WebSocket tout en maintenant la configuration CORS existante.

### Messaging Module (`src/messaging/messaging.module.ts`)
Le module a été mis à jour pour:
- Importer le `JwtModule` pour la validation des tokens
- Ajouter `MessagesGateway` aux providers
- Ajouter `WebSocketAuthService` aux providers

### WebSocket Gateway Configuration
```typescript
@WebSocketGateway({
  namespace: '/messaging',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})
```

## Architecture Exemple

### 1. Connexion Client

**Frontend**:
```javascript
const socket = io('http://localhost:3000/messaging', {
  auth: {
    token: 'your-jwt-token'
  }
});

socket.on('connect', () => {
  console.log('Connecté au serveur');
});

socket.on('unread-count-updated', (data) => {
  console.log('Nouveaux messages non lus:', data.totalUnread);
});

socket.on('error', (error) => {
  console.error('Erreur WebSocket:', error);
});
```

### 2. Rejoindre une Conversation

**Frontend**:
```javascript
socket.emit('join-conversation', {
  conversationId: 'conv-123'
});

socket.on('conversation-history', (data) => {
  console.log('Historique chargé:', data.messages);
});

socket.on('user-joined', (data) => {
  console.log(`${data.userId} a rejoint la conversation`);
});
```

### 3. Envoyer un Message

**Frontend**:
```javascript
socket.emit('send-message', {
  conversationId: 'conv-123',
  content: 'Bonjour!',
  attachments: [
    {
      url: 'https://uploadthing.com/...',
      type: 'image/jpeg'
    }
  ]
});

socket.on('new-message', (message) => {
  console.log('Nouveau message reçu:', message);
});
```

### 4. Indicateur de Typing

**Frontend** (avec debounce):
```javascript
let typingTimeout;

input.addEventListener('input', () => {
  socket.emit('user-typing', {
    conversationId: 'conv-123'
  });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('user-stopped-typing', {
      conversationId: 'conv-123'
    });
  }, 300);
});

socket.on('user-typing', (data) => {
  console.log(`${data.userName} est en train d'écrire...`);
});

socket.on('user-stopped-typing', (data) => {
  console.log(`${data.userName} a arrêté d'écrire`);
});
```

### 5. Marquer comme Lu

**Frontend**:
```javascript
socket.emit('mark-as-read', {
  messageId: 'msg-456'
});

// Ou marquer toute la conversation comme lue:
socket.emit('mark-conversation-as-read', {
  conversationId: 'conv-123'
});

socket.on('message-read', (data) => {
  console.log(`Message ${data.messageId} lu à ${data.readAt}`);
});
```

## Authentification WebSocket

### Comment ça fonctionne

1. **Handshake avec Token**:
   - Le client envoie le token JWT dans `auth.token` lors de la connexion
   - Le gateway reçoit le token dans `client.handshake.auth.token`

2. **Validation**:
   - Le `WebSocketAuthService` valide le token avec `JwtService`
   - Si invalide, le client est immédiatement déconnecté

3. **Extraction du UserId**:
   - Le payload JWT doit contenir un champ `userId`
   - Ce userId est utilisé pour toutes les opérations futures

### Format du Token JWT

Le token doit contenir au minimum:
```json
{
  "userId": "user-123",
  "email": "user@example.com",
  "role": "client|salon"
}
```

## Gestion des Sessions Multiples

Le système supporte un utilisateur connecté sur plusieurs appareils/onglets:

```typescript
private userConnections: Map<string, Set<string>>
// userId "user-123" → Set { "socket-id-1", "socket-id-2", "socket-id-3" }
```

Quand un événement est broadcasté à un utilisateur, il est envoyé à **tous** ses sockets connectés.

## Rooms Socket.IO

### Convention de Nommage
```
conversation-{conversationId}
```

Exemple:
```
conversation-conv-550e8400-e29b-41d4-a716-446655440000
```

### Utilisation
```typescript
// Rejoindre une room
client.join(`conversation-${conversationId}`);

// Quitter une room
client.leave(`conversation-${conversationId}`);

// Broadcaster à tous les membres d'une room
this.server.to(`conversation-${conversationId}`).emit('new-message', message);
```

## Logging

Le gateway utilise NestJS Logger pour tracer toutes les opérations importantes:

```
[MessagesGateway] Client socket-id-1 connecté - User user-123
[MessagesGateway] User user-123 a rejoint la conversation conv-123
[MessagesGateway] Message créé dans la conversation conv-123 par user-123
[MessagesGateway] User user-123 complètement déconnecté
```

## Gestion des Erreurs

Tous les handlers implémentent la gestion des erreurs:

```typescript
try {
  // Opération WebSocket
} catch (error) {
  this.logger.error('Erreur handleXXX:', error);
  client.emit('error', {
    message: 'Message d\'erreur lisible'
  });
}
```

Le client reçoit un événement `error` avec un message descriptif.

## Performance & Optimisations

### Débouncing (Frontend Recommandé)
L'indicateur de typing devrait être débounced côté frontend (300ms) pour éviter trop d'événements.

### Caching (Future)
Redis peut être utilisé pour:
- Cacher l'état "online/offline" des utilisateurs
- Stocker les salons actifs
- Persister les données de typing

### Scalabilité (Multi-serveur)
Pour déployer sur plusieurs serveurs:
1. Installer l'adapter Redis: `npm install @socket.io/redis-adapter`
2. Configurer le Redis adapter dans le gateway:
```typescript
const { createAdapter } = require('@socket.io/redis-adapter');
this.server.adapter(createAdapter(pubClient, subClient));
```

## Prochaines Étapes

### Phase 4: Notifications Email
- Envoyer un email quand un nouveau message arrive (si utilisateur hors ligne)
- Utiliser Bull pour la queue et MailService existant

### Phase 5: Optimisations
- Implémenter Redis pour caching de présence
- Ajouter la compression des messages
- Implémenter la pagination du chargement initial

### Phase 6: Archivage Automatique
- Implémenter la tâche Bull pour archiver les conversations après 90 jours
- Créer une tâche de nettoyage des messages supprimés

## Vérification du Fonctionnement

### Build
```bash
npm run build
# ✅ Succès - Aucune erreur TypeScript
```

### Démarrer le serveur
```bash
npm run dev
# Le gateway sera initialisé et écoutera sur /messaging
```

### Test avec Socket.IO Client
```bash
npm install -g socket.io-client
```

Puis tester manuellement avec un client Socket.IO ou Postman.

## Fichiers Modifiés

1. **`src/messaging/messaging.module.ts`**: Ajout du gateway et du service auth
2. **`src/main.ts`**: Amélioration de la configuration CORS pour WebSocket

## Résumé des Améliorations

✅ Authentification sécurisée via JWT  
✅ Support de sessions multiples par utilisateur  
✅ Rooms Socket.IO pour les conversations  
✅ Indicateurs de typing  
✅ Notifications en temps réel  
✅ Tracking de présence (online/offline)  
✅ Gestion complète du cycle de vie  
✅ Logging détaillé  
✅ Gestion des erreurs robuste  
