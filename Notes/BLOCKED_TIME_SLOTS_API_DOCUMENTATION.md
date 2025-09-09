# API Documentation - Blocked Time Slots Module

## Vue d'ensemble

Le module `blocked-time-slots` gère les créneaux bloqués dans le système de tatouage. Il permet de bloquer des créneaux horaires pour empêcher la prise de rendez-vous, soit pour un tatoueur spécifique, soit pour l'ensemble du salon.

## Architecture du Module

### Fichiers principaux
- **Controller**: `blocked-time-slots.controller.ts` - 7 routes
- **Service**: `blocked-time-slots.service.ts` - 8 méthodes principales
- **DTOs**: Validation des données d'entrée

### Base URL
```
/blocked-slots
```

## Routes API

### 1. Créer un créneau bloqué
```http
POST /blocked-slots
```

**Authentification**: JWT obligatoire
**Guard**: `JwtAuthGuard`

**Headers requis**:
```json
{
  "Authorization": "Bearer <token>"
}
```

**Body (CreateBlockedSlotDto)**:
```json
{
  "startDate": "2024-01-15T09:00:00.000Z",
  "endDate": "2024-01-15T17:00:00.000Z",
  "reason": "Congés", // optionnel
  "tatoueurId": "uuid-tatoueur" // optionnel, si null bloque pour tous
}
```

**Validation des données**:
- `startDate`: Requis, format ISO string
- `endDate`: Requis, format ISO string
- `reason`: Optionnel, string
- `tatoueurId`: Optionnel, string (UUID)

**Logique métier**:
```typescript
async createBlockedSlot(blockedSlotData: CreateBlockedSlotDto, userId: string) {
  // 1. Validation des données requises
  if (!startDate || !endDate || !userId) {
    return { error: true, message: 'Champs requis manquants' };
  }

  // 2. Conversion et validation des dates
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { error: true, message: 'Dates invalides' };
  }

  // 3. Vérification logique des dates
  if (start >= end) {
    return { error: true, message: 'Date de fin antérieure au début' };
  }

  // 4. Création du créneau bloqué
  const blockedSlot = await this.prisma.blockedTimeSlot.create({
    data: {
      startDate: start,
      endDate: end,
      reason: reason || null,
      tatoueurId: tatoueurId || null,
      userId, // Récupéré du token JWT
    },
    include: {
      tatoueur: {
        select: { id: true, name: true }
      }
    }
  });
}
```

**Réponse succès**:
```json
{
  "error": false,
  "message": "Créneau bloqué créé avec succès.",
  "blockedSlot": {
    "id": "uuid",
    "startDate": "2024-01-15T09:00:00.000Z",
    "endDate": "2024-01-15T17:00:00.000Z",
    "reason": "Congés",
    "tatoueurId": "uuid-tatoueur",
    "userId": "uuid-salon",
    "tatoueur": {
      "id": "uuid-tatoueur",
      "name": "Jean Dupont"
    }
  }
}
```

### 2. Voir tous les créneaux bloqués d'un salon
```http
GET /blocked-slots/salon/:userId
```

**Authentification**: Non requise
**Paramètres**: 
- `userId` (path): ID du salon

**Logique métier**:
```typescript
async getBlockedSlotsBySalon(userId: string) {
  const blockedSlots = await this.prisma.blockedTimeSlot.findMany({
    where: { userId },
    include: {
      tatoueur: {
        select: { id: true, name: true }
      }
    },
    orderBy: { startDate: 'asc' }
  });
}
```

**Réponse**:
```json
{
  "error": false,
  "blockedSlots": [
    {
      "id": "uuid",
      "startDate": "2024-01-15T09:00:00.000Z",
      "endDate": "2024-01-15T17:00:00.000Z",
      "reason": "Congés",
      "tatoueurId": "uuid-tatoueur",
      "userId": "uuid-salon",
      "tatoueur": {
        "id": "uuid-tatoueur",
        "name": "Jean Dupont"
      }
    }
  ]
}
```

### 3. Voir tous les créneaux bloqués d'un tatoueur
```http
GET /blocked-slots/tatoueur/:tatoueurId
```

**Authentification**: Non requise
**Paramètres**: 
- `tatoueurId` (path): ID du tatoueur

**Logique métier**:
```typescript
async getBlockedSlotsByTatoueur(tatoueurId: string) {
  const blockedSlots = await this.prisma.blockedTimeSlot.findMany({
    where: { tatoueurId },
    include: {
      tatoueur: {
        select: { id: true, name: true }
      }
    },
    orderBy: { startDate: 'asc' }
  });
}
```

### 4. Voir les créneaux proposés par le salon
```http
GET /blocked-slots/propose-creneau?tatoueurId=uuid&start=date&end=date
```

**Authentification**: Non requise
**Query parameters**:
- `tatoueurId`: ID du tatoueur
- `start`: Date de début (ISO string)
- `end`: Date de fin (ISO string)

**Logique métier**:
```typescript
async getProposedSlotsForSalon(tatoueurId: string, startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const proposedSlots = await this.prisma.proposedSlot.findMany({
    where: {
      tatoueurId,
      status: 'PENDING',
      from: { gte: start },
      to: { lte: end }
    },
    include: {
      appointmentRequest: {
        select: {
          id: true,
          clientFirstname: true,
          clientLastname: true,
          clientEmail: true,
          status: true,
          prestation: true,
          createdAt: true
        }
      }
    },
    orderBy: { from: 'asc' }
  });
}
```

**Réponse**:
```json
[
  {
    "id": "uuid",
    "from": "2024-01-15T09:00:00.000Z",
    "to": "2024-01-15T11:00:00.000Z",
    "status": "PENDING",
    "tatoueurId": "uuid-tatoueur",
    "appointmentRequest": {
      "id": "uuid-request",
      "clientFirstname": "Marie",
      "clientLastname": "Martin",
      "clientEmail": "marie@email.com",
      "status": "PENDING",
      "prestation": "Tatouage bras",
      "createdAt": "2024-01-10T10:00:00.000Z"
    }
  }
]
```

### 5. Vérifier si un créneau est bloqué
```http
GET /blocked-slots/check?startDate=date&endDate=date&tatoueurId=uuid&userId=uuid
```

**Authentification**: Non requise
**Query parameters**:
- `startDate`: Date de début à vérifier
- `endDate`: Date de fin à vérifier
- `tatoueurId`: (optionnel) ID du tatoueur
- `userId`: (optionnel) ID du salon

**Logique métier complexe**:
```typescript
async isTimeSlotBlocked(startDate: Date, endDate: Date, tatoueurId?: string, userId?: string): Promise<boolean> {
  // Construction des conditions de recherche
  const whereConditions = {
    AND: [
      {
        startDate: {
          lt: endDate // Le blocage commence avant la fin du créneau
        }
      },
      {
        endDate: {
          gt: startDate // Le blocage se termine après le début du créneau
        }
      }
    ]
  };

  // Si on cherche pour un tatoueur spécifique
  if (tatoueurId) {
    whereConditions.OR = [
      { tatoueurId: tatoueurId }, // Bloqué spécifiquement pour ce tatoueur
      { tatoueurId: null }        // Bloqué pour tous les tatoueurs du salon
    ];
    
    if (userId) {
      whereConditions.userId = userId; // S'assurer qu'on reste dans le bon salon
    }
  } else if (userId) {
    // Si on cherche pour le salon en général
    whereConditions.userId = userId;
  }

  const blockedSlot = await this.prisma.blockedTimeSlot.findFirst({
    where: whereConditions
  });

  return !!blockedSlot; // Retourne true si un blocage est trouvé
}
```

**Réponse**:
```json
{
  "isBlocked": true,
  "message": "Ce créneau est bloqué"
}
```

### 6. Modifier un créneau bloqué
```http
PUT /blocked-slots/:id
```

**Authentification**: JWT obligatoire
**Guard**: `JwtAuthGuard`

**Paramètres**: 
- `id` (path): ID du créneau bloqué

**Body (UpdateBlockedSlotDto)**:
```json
{
  "startDate": "2024-01-15T10:00:00.000Z", // optionnel
  "endDate": "2024-01-15T18:00:00.000Z",   // optionnel
  "reason": "Nouvelle raison",              // optionnel
  "tatoueurId": "nouveau-uuid"              // optionnel
}
```

**Logique métier**:
```typescript
async updateBlockedSlot(id: string, updateData: UpdateBlockedSlotDto) {
  // 1. Vérifier l'existence du créneau
  const existingSlot = await this.prisma.blockedTimeSlot.findUnique({
    where: { id }
  });

  if (!existingSlot) {
    return { error: true, message: 'Créneau bloqué introuvable.' };
  }

  // 2. Préparer les données de mise à jour
  const updatePayload = {};
  if (updateData.startDate) updatePayload.startDate = new Date(updateData.startDate);
  if (updateData.endDate) updatePayload.endDate = new Date(updateData.endDate);
  if (updateData.reason !== undefined) updatePayload.reason = updateData.reason;
  if (updateData.tatoueurId !== undefined) updatePayload.tatoueurId = updateData.tatoueurId || null;

  // 3. Validation des dates
  const startDate = updatePayload.startDate || existingSlot.startDate;
  const endDate = updatePayload.endDate || existingSlot.endDate;

  if (startDate >= endDate) {
    return { error: true, message: 'Date de fin antérieure au début' };
  }

  // 4. Mise à jour
  const updatedSlot = await this.prisma.blockedTimeSlot.update({
    where: { id },
    data: updatePayload,
    include: {
      tatoueur: { select: { id: true, name: true } }
    }
  });
}
```

### 7. Supprimer un créneau bloqué
```http
DELETE /blocked-slots/:id
```

**Authentification**: JWT obligatoire
**Guard**: `JwtAuthGuard`

**Paramètres**: 
- `id` (path): ID du créneau bloqué

**Logique métier**:
```typescript
async deleteBlockedSlot(id: string) {
  // 1. Vérifier l'existence
  const existingSlot = await this.prisma.blockedTimeSlot.findUnique({
    where: { id }
  });

  if (!existingSlot) {
    return { error: true, message: 'Créneau bloqué introuvable.' };
  }

  // 2. Suppression
  await this.prisma.blockedTimeSlot.delete({
    where: { id }
  });

  return {
    error: false,
    message: 'Créneau bloqué supprimé avec succès.'
  };
}
```

## Modèle de données Prisma

### BlockedTimeSlot
```prisma
model BlockedTimeSlot {
  id         String   @id @default(cuid())
  startDate  DateTime
  endDate    DateTime
  reason     String?
  tatoueurId String?
  userId     String
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  tatoueur   Tatoueur? @relation(fields: [tatoueurId], references: [id])
  user       User      @relation(fields: [userId], references: [id])
}
```

### ProposedSlot (utilisé dans getProposedSlotsForSalon)
```prisma
model ProposedSlot {
  id                  String           @id @default(cuid())
  from                DateTime
  to                  DateTime
  status              ProposedSlotStatus @default(PENDING)
  tatoueurId          String
  appointmentRequestId String
  createdAt           DateTime         @default(now())

  tatoueur            Tatoueur         @relation(fields: [tatoueurId], references: [id])
  appointmentRequest  AppointmentRequest @relation(fields: [appointmentRequestId], references: [id])
}
```

## Logique de blocage des créneaux

### Types de blocage
1. **Blocage par tatoueur**: `tatoueurId` spécifié - bloque uniquement ce tatoueur
2. **Blocage général**: `tatoueurId` null - bloque tous les tatoueurs du salon

### Algorithme de vérification de conflit
La méthode `isTimeSlotBlocked` utilise une logique sophistiquée :

```typescript
// Conditions pour détecter un conflit :
// 1. Le blocage commence avant la fin du créneau à tester
// 2. Le blocage se termine après le début du créneau à tester

const hasOverlap = (
  blockStart < testEnd && 
  blockEnd > testStart
);
```

### Priorités de blocage
1. Blocage spécifique au tatoueur (`tatoueurId` défini)
2. Blocage général du salon (`tatoueurId` null)
3. Validation par salon (`userId`)

## Gestion des erreurs

### Erreurs de validation
- Dates invalides (format ISO requis)
- Date de fin antérieure à la date de début
- Champs requis manquants

### Erreurs métier
- Créneau bloqué introuvable (404)
- Conflit de dates lors de la modification

### Réponses d'erreur standardisées
```json
{
  "error": true,
  "message": "Description de l'erreur"
}
```

## Cas d'usage principaux

### 1. Congés d'un tatoueur
```json
{
  "startDate": "2024-08-01T00:00:00.000Z",
  "endDate": "2024-08-15T23:59:59.999Z",
  "reason": "Congés d'été",
  "tatoueurId": "uuid-tatoueur"
}
```

### 2. Fermeture du salon
```json
{
  "startDate": "2024-12-25T00:00:00.000Z",
  "endDate": "2024-12-25T23:59:59.999Z",
  "reason": "Fermeture Noël",
  "tatoueurId": null
}
```

### 3. Formation/événement
```json
{
  "startDate": "2024-06-10T14:00:00.000Z",
  "endDate": "2024-06-10T18:00:00.000Z",
  "reason": "Convention tatouage",
  "tatoueurId": null
}
```

## Intégration avec d'autres modules

### Avec le module Appointments
- Vérification automatique des conflits lors de la création de RDV
- Validation des créneaux disponibles

### Avec le module Time-Slots
- Calcul des créneaux disponibles excluant les blocages
- Génération des horaires de disponibilité

### Avec le système de propositions
- Gestion des créneaux proposés suite aux demandes clients
- Suivi du statut des propositions (PENDING, ACCEPTED, REJECTED)

## Notes techniques

### Performance
- Index sur `userId` et `tatoueurId` pour les requêtes fréquentes
- Tri par `startDate` pour l'affichage chronologique

### Sécurité
- JWT obligatoire pour les opérations de modification
- Validation stricte des données d'entrée
- Isolation par salon (userId) pour la sécurité des données

### Maintenance
- Logs détaillés pour le debugging
- Gestion d'erreurs robuste avec try/catch
- Messages d'erreur localisés en français
