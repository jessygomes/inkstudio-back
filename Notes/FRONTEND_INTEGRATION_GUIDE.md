# 🎯 Guide d'Intégration Frontend - Système de Messagerie

## Installation

### 1. Installer les Dépendances

```bash
npm install socket.io-client
```

## Configuration de Connexion

### 1. Initialiser le Socket

```typescript
import io from 'socket.io-client';

const socket = io('http://localhost:3000/messaging', {
  auth: {
    token: 'your-jwt-token-here' // Token JWT du localStorage/SessionStorage
  },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5
});
```

### 2. Gérer la Connexion

```typescript
// Connexion établie
socket.on('connect', () => {
  console.log('✅ Connecté au serveur de messagerie');
});

// Erreur de connexion
socket.on('connect_error', (error) => {
  console.error('❌ Erreur de connexion:', error);
  // Rediriger vers login si auth error
});

// Déconnexion
socket.on('disconnect', (reason) => {
  console.warn('⚠️ Déconnecté:', reason);
  // Afficher notification "Hors ligne"
});
```

## Gestion des Événements

### A. Rejoindre une Conversation

```typescript
// Quand l'utilisateur ouvre une conversation
socket.emit('join-conversation', {
  conversationId: 'conv-550e8400-e29b-41d4'
});

// Recevoir l'historique
socket.on('conversation-history', (data) => {
  console.log('Messages reçus:', data.messages);
  // data.messages = Array<Message>
  // Afficher les 50 derniers messages
});

// Notification quand l'autre utilisateur rejoint
socket.on('user-joined', (data) => {
  console.log(`${data.userId} a rejoint la conversation`);
});
```

### B. Quitter une Conversation

```typescript
// Quand l'utilisateur ferme la conversation
socket.emit('leave-conversation', {
  conversationId: 'conv-550e8400-e29b-41d4'
});

// (Optionnel) Écouter la confirmation
socket.on('user-left', (data) => {
  console.log(`${data.userId} a quitté la conversation`);
});
```

### C. Envoyer un Message

#### Option 1: Message Simple (Sans Attachments)

```typescript
socket.emit('send-message', {
  conversationId: 'conv-550e8400-e29b-41d4',
  content: 'Bonjour, comment allez-vous?',
  attachments: []
});
```

#### Option 2: Message avec Images (UploadThing)

```typescript
// 1. D'abord uploader les images avec UploadThing
const uploadedFiles = await utapi.uploadFiles(files);

// 2. Puis créer les attachments
const attachments = uploadedFiles.map(file => ({
  url: file.url,          // URL public UploadThing
  type: file.type         // 'image/jpeg', 'image/png', etc.
}));

// 3. Envoyer le message avec attachments
socket.emit('send-message', {
  conversationId: 'conv-550e8400-e29b-41d4',
  content: 'Voici mes photos:',
  attachments: attachments
});
```

#### Recevoir les Nouveaux Messages

```typescript
socket.on('new-message', (message) => {
  console.log('Nouveau message:', message);
  // {
  //   id: 'msg-123',
  //   conversationId: 'conv-abc',
  //   content: 'Bonjour!',
  //   authorId: 'user-xyz',
  //   attachments: [{ url: '...', type: 'image/jpeg' }],
  //   createdAt: '2024-01-15T10:30:00Z'
  // }
  
  // Ajouter le message à la liste
  setMessages(prev => [...prev, message]);
});
```

### D. Indicateurs de Typing

#### Envoyer (avec Debounce)

```typescript
let typingTimeout: NodeJS.Timeout;

const handleInputChange = (text: string) => {
  // Envoyer signal de typing
  socket.emit('user-typing', {
    conversationId: currentConversationId
  });

  // Attendre 300ms avant de dire que l'utilisateur arrête
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('user-stopped-typing', {
      conversationId: currentConversationId
    });
  }, 300);
};
```

#### Recevoir

```typescript
const [typingUsers, setTypingUsers] = useState<string[]>([]);

// Quelqu'un écrit
socket.on('user-typing', (data) => {
  // data.userId, data.userName, data.conversationId
  setTypingUsers(prev => {
    if (!prev.includes(data.userId)) {
      return [...prev, data.userId];
    }
    return prev;
  });
});

// Quelqu'un arrête d'écrire
socket.on('user-stopped-typing', (data) => {
  setTypingUsers(prev => 
    prev.filter(id => id !== data.userId)
  );
});

// Afficher dans le UI
{typingUsers.length > 0 && (
  <p className="text-sm text-gray-500">
    {typingUsers.map(id => usersMap[id]?.name).join(', ')} écrit...
  </p>
)}
```

### E. Marquer un Message Comme Lu

#### Option 1: Marquer un Message Spécifique

```typescript
socket.emit('mark-as-read', {
  messageId: 'msg-123'
});

// Recevoir la confirmation
socket.on('message-read', (data) => {
  // data.messageId, data.readAt
  setMessages(prev => 
    prev.map(m => 
      m.id === data.messageId 
        ? { ...m, readAt: data.readAt }
        : m
    )
  );
});
```

#### Option 2: Marquer Toute la Conversation

```typescript
socket.emit('mark-conversation-as-read', {
  conversationId: 'conv-550e8400-e29b-41d4'
});
```

#### Auto-marquer au Charger la Page

```typescript
// Quand on reçoit l'historique
socket.on('conversation-history', (data) => {
  const unreadMessages = data.messages.filter(m => !m.readAt);
  
  // Marquer tous comme lus
  unreadMessages.forEach(msg => {
    socket.emit('mark-as-read', { messageId: msg.id });
  });
});
```

### F. Compteur de Messages Non Lus

```typescript
const [unreadCount, setUnreadCount] = useState(0);

// Recevoir la mise à jour
socket.on('unread-count-updated', (data) => {
  setUnreadCount(data.totalUnread);
  
  // Mettre à jour le badge
  if (data.totalUnread > 0) {
    document.title = `(${data.totalUnread}) Messages`;
  }
});

// Afficher dans le UI
<div className="badge">{unreadCount}</div>
```

### G. Présence Online/Offline

```typescript
const [userStatus, setUserStatus] = useState<'online' | 'offline'>('online');

// Utilisateur en ligne
socket.on('user-online', (data) => {
  // data.userId, data.userName
  setOnlineUsers(prev => [...prev, data.userId]);
});

// Utilisateur hors ligne
socket.on('user-offline', (data) => {
  // data.userId
  setOnlineUsers(prev => prev.filter(id => id !== data.userId));
  setUserStatus('offline');
});

// Afficher l'état
<div className={`status ${userStatus}`}>
  {userStatus === 'online' ? '🟢 En ligne' : '⚫ Hors ligne'}
</div>
```

### H. Gestion des Erreurs

```typescript
socket.on('error', (error) => {
  console.error('Erreur WebSocket:', error.message);
  
  // Afficher une notification
  showNotification({
    type: 'error',
    message: error.message
  });
});
```

## Architecture React Recommandée

### 1. Custom Hook

```typescript
// useMessaging.ts
import { useEffect, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';

interface Message {
  id: string;
  conversationId: string;
  content: string;
  authorId: string;
  attachments: any[];
  readAt?: string;
  createdAt: string;
}

export const useMessaging = (token: string) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialiser la connexion
  useEffect(() => {
    const newSocket = io('http://localhost:3000/messaging', {
      auth: { token }
    });

    newSocket.on('connect', () => {
      console.log('✅ Connecté');
    });

    newSocket.on('error', (err) => {
      setError(err.message);
    });

    newSocket.on('new-message', (message) => {
      setMessages(prev => [...prev, message]);
    });

    newSocket.on('unread-count-updated', (data) => {
      setUnreadCount(data.totalUnread);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [token]);

  const joinConversation = useCallback((conversationId: string) => {
    socket?.emit('join-conversation', { conversationId });
  }, [socket]);

  const sendMessage = useCallback(
    (conversationId: string, content: string, attachments = []) => {
      socket?.emit('send-message', {
        conversationId,
        content,
        attachments
      });
    },
    [socket]
  );

  const markAsRead = useCallback((messageId: string) => {
    socket?.emit('mark-as-read', { messageId });
  }, [socket]);

  const emitTyping = useCallback((conversationId: string) => {
    socket?.emit('user-typing', { conversationId });
  }, [socket]);

  return {
    socket,
    messages,
    unreadCount,
    error,
    joinConversation,
    sendMessage,
    markAsRead,
    emitTyping
  };
};
```

### 2. Component d'Utilisation

```typescript
// ConversationView.tsx
import { useMessaging } from './useMessaging';
import { useEffect, useState } from 'react';

export const ConversationView = ({ 
  conversationId, 
  token 
}: Props) => {
  const {
    messages,
    unreadCount,
    error,
    joinConversation,
    sendMessage,
    markAsRead
  } = useMessaging(token);

  const [inputValue, setInputValue] = useState('');
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout>();

  useEffect(() => {
    joinConversation(conversationId);
  }, [conversationId, joinConversation]);

  const handleSend = async () => {
    if (!inputValue.trim()) return;

    sendMessage(conversationId, inputValue);
    setInputValue('');
  };

  const handleInputChange = (text: string) => {
    setInputValue(text);

    // Typing indicator avec debounce
    clearTimeout(typingTimeout);
    const timeout = setTimeout(() => {
      // emit stopped typing
    }, 300);
    setTypingTimeout(timeout);
  };

  return (
    <div className="conversation">
      <div className="messages">
        {messages.map(msg => (
          <div key={msg.id} className="message">
            <p>{msg.content}</p>
            {msg.attachments?.map((att, i) => (
              <img key={i} src={att.url} alt="attachment" />
            ))}
            {msg.readAt && <span className="read-status">✓✓</span>}
          </div>
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="input-area">
        <input
          value={inputValue}
          onChange={e => handleInputChange(e.target.value)}
          placeholder="Votre message..."
        />
        <button onClick={handleSend}>Envoyer</button>
      </div>
    </div>
  );
};
```

## Best Practices

### 1. Token Management
```typescript
// Récupérer le token
const token = localStorage.getItem('auth_token');

// Actualiser le socket quand le token change
useEffect(() => {
  if (socket && token) {
    socket.auth = { token };
    socket.connect();
  }
}, [token]);
```

### 2. Debounce pour Typing
```typescript
// Minimum 300ms entre les émissions
const debouncedTyping = useCallback(
  debounce((conversationId: string) => {
    emitTyping(conversationId);
  }, 300),
  [emitTyping]
);
```

### 3. Error Handling
```typescript
// Toujours vérifier socket avant d'émettre
const safeEmit = useCallback(
  (event: string, data: any) => {
    if (!socket) {
      console.error('Socket not connected');
      return;
    }
    socket.emit(event, data);
  },
  [socket]
);
```

### 4. Memory Leaks
```typescript
// Nettoyer les listeners
useEffect(() => {
  socket?.on('new-message', handleNewMessage);

  return () => {
    socket?.off('new-message', handleNewMessage);
  };
}, [socket, handleNewMessage]);
```

### 5. Fallback REST API
```typescript
// Si WebSocket échoue, utiliser REST
const getMessages = async (conversationId: string) => {
  try {
    const response = await fetch(
      `/messaging/conversations/${conversationId}/messages`
    );
    return response.json();
  } catch (error) {
    console.error('Failed to fetch messages');
  }
};
```

## Gestion d'État avec Redux (Optionnel)

```typescript
// messagingSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface MessagingState {
  conversations: Conversation[];
  currentMessages: Message[];
  unreadCount: number;
  typingUsers: string[];
  isOnline: boolean;
}

const messagingSlice = createSlice({
  name: 'messaging',
  initialState: {
    conversations: [],
    currentMessages: [],
    unreadCount: 0,
    typingUsers: [],
    isOnline: false
  } as MessagingState,
  reducers: {
    newMessage: (state, action: PayloadAction<Message>) => {
      state.currentMessages.push(action.payload);
    },
    unreadCountUpdated: (state, action: PayloadAction<number>) => {
      state.unreadCount = action.payload;
    },
    userTyping: (state, action: PayloadAction<string>) => {
      if (!state.typingUsers.includes(action.payload)) {
        state.typingUsers.push(action.payload);
      }
    },
    setOnlineStatus: (state, action: PayloadAction<boolean>) => {
      state.isOnline = action.payload;
    }
  }
});

export default messagingSlice.reducer;
```

## Checklist d'Implémentation

- [ ] Installer `socket.io-client`
- [ ] Créer le custom hook `useMessaging`
- [ ] Implémenter la connexion WebSocket
- [ ] Ajouter les event listeners
- [ ] Créer le composant de conversation
- [ ] Ajouter la gestion des erreurs
- [ ] Tester avec 2 clients simultanément
- [ ] Ajouter les optimisations de performance
- [ ] Documenter pour l'équipe
- [ ] Déployer en production

## Débogage

### Vérifier la Connexion
```javascript
// Console du navigateur
socket.connected  // true/false
socket.id         // 'socket-abc123'
```

### Voir tous les événements
```typescript
socket.onAny((event, ...args) => {
  console.log(`📡 ${event}`, args);
});
```

### Logs du Serveur
```
[MessagesGateway] Client socket-abc123 connecté - User user-550e
[MessagesGateway] User user-550e a rejoint la conversation conv-123
```

---

**Version:** 1.0  
**Statut:** Prêt pour développement  
**Support:** Contacter l'équipe backend si besoin
