# Feature : Relier / Délier un tatoueur à un salon

## Vue d'ensemble

Cette feature permet à un **salon** d'inviter un **tatoueur inscrit** (`role: user_tatoueur`) à rejoindre son équipe.  
Le tatoueur reçoit une demande, peut l'accepter ou la refuser.  
Une fois accepté, il est rattaché au salon et apparaît dans son équipe publique.  
Lui-même ou le salon peut mettre fin au rattachement à tout moment.

---

## Modèle de données

### Rattachement direct : champ `salonId` sur `User`

```prisma
model User {
  // ...
  salonId        String?
  salon          User?   @relation("SalonTatoueurs", fields: [salonId], references: [id])
  linkedTatoueurs User[] @relation("SalonTatoueurs")
  // ...
}
```

Quand un tatoueur accepte une demande, son `User.salonId` est mis à l'id du salon.  
Quand il quitte / est retiré, `User.salonId` repasse à `null`.

---

### Table intermédiaire : `SalonTatoueurTeamRequest`

```prisma
model SalonTatoueurTeamRequest {
  id             String            @id @default(cuid())
  salonId        String            // Salon qui invite
  tatoueurUserId String            // Tatoueur invité
  message        String?           // Message optionnel d'invitation
  status         TeamRequestStatus @default(PENDING)
  respondedAt    DateTime?
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  salon          User @relation("TeamRequestsSentBySalon",           fields: [salonId],        references: [id], onDelete: Cascade)
  tatoueurUser   User @relation("TeamRequestsReceivedByTatoueur",    fields: [tatoueurUserId], references: [id], onDelete: Cascade)

  @@unique([salonId, tatoueurUserId, status])   // Empêche les doublons par statut
  @@index([salonId])
  @@index([tatoueurUserId])
  @@index([status])
}

enum TeamRequestStatus {
  PENDING   // En attente de réponse
  ACCEPTED  // Acceptée
  REFUSED   // Refusée
}
```

> **Contrainte `@@unique([salonId, tatoueurUserId, status])`**  
> Un même duo salon/tatoueur ne peut avoir qu'une seule ligne par statut.  
> Avant de passer une ligne à `ACCEPTED` ou `REFUSED`, les lignes déjà dans cet état sont supprimées (voir `respondToTeamRequest`).

---

## Endpoints

Tous les endpoints sont préfixés par `/tatoueurs`.

| Méthode | Route | Rôle requis | Description |
|---------|-------|-------------|-------------|
| `GET` | `team-requests/search?q=` | salon | Rechercher des tatoueurs inscrits à inviter |
| `POST` | `team-requests` | salon | Envoyer une demande d'invitation |
| `GET` | `team-requests/outgoing` | salon | Lister les demandes envoyées par le salon |
| `GET` | `team-requests/incoming` | tatoueur | Lister les demandes reçues par le tatoueur |
| `GET` | `team-requests/linked-salons` | tatoueur | Lister les salons actuels et historiques du tatoueur |
| `PATCH` | `team-requests/:requestId/respond` | tatoueur | Accepter ou refuser une demande |
| `DELETE` | `team-requests/linked/:tatoueurUserId` | salon | Retirer un tatoueur de l'équipe |
| `DELETE` | `team-requests/linked/me/leave` | tatoueur | Quitter son salon actuel |

---

## DTOs

### `CreateTeamRequestDto` — envoi d'invitation

```typescript
// src/tatoueurs/dto/create-team-request.dto.ts
export class CreateTeamRequestDto {
  @IsString()
  @IsNotEmpty()
  tatoueurUserId: string;     // ID du tatoueur invité

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;           // Message d'invitation (optionnel)
}
```

### `RespondTeamRequestDto` — réponse du tatoueur

```typescript
// src/tatoueurs/dto/respond-team-request.dto.ts
export class RespondTeamRequestDto {
  @IsIn(['accept', 'refuse'])
  action!: 'accept' | 'refuse';
}
```

---

## Flux complet

```
Salon                               Tatoueur
  │                                    │
  │── GET team-requests/search ──────► │ (recherche par nom/email)
  │
  │── POST team-requests ────────────► │ (création PENDING)
  │
  │                        ◄─── GET team-requests/incoming
  │
  │                        ◄─── PATCH team-requests/:id/respond { action: "accept" }
  │                                    │
  │                             salonId = salon.id (sur User)
  │                             demande PENDING → ACCEPTED
  │
  │── GET team-requests/outgoing ────► (liste avec statuts)
  │
  │── DELETE linked/:tatoueurUserId    (salon retire le tatoueur)
  │   OU
  │                        ◄─── DELETE linked/me/leave (tatoueur part)
  │                                    │
  │                             salonId = null (sur User)
  │                             ligne ACCEPTED supprimée
```

---

## Logique métier détaillée

### 1. Rechercher un tatoueur à inviter

```typescript
// src/tatoueurs/tatoueurs.service.ts — searchTatoueurUsers()
async searchTatoueurUsers({ salonUserId, salonRole, query }) {
  // Seuls les salons peuvent chercher
  if (salonRole !== 'user_salon' && salonRole !== 'user') { ... }

  const users = await this.prisma.user.findMany({
    where: {
      role: Role.user_tatoueur,
      OR: trimmedQuery ? [
        { firstName: { contains: trimmedQuery, mode: 'insensitive' } },
        { lastName:  { contains: trimmedQuery, mode: 'insensitive' } },
        { email:     { contains: trimmedQuery, mode: 'insensitive' } },
      ] : undefined,
    },
    select: {
      // ...infos de base
      salonId: true,                   // Pour savoir s'il est déjà dans l'équipe
      receivedTeamRequests: {          // Demande PENDING existante de CE salon
        where: { salonId: salonUserId, status: TeamRequestStatus.PENDING },
        take: 1,
      },
    },
    take: 30,
  });

  // Enrichissement pour le front
  return tatoueurs.map(user => ({
    ...
    isAlreadyInTeam: user.salonId === salonUserId,
    hasPendingRequestFromThisSalon: user.receivedTeamRequests.length > 0,
  }));
}
```

---

### 2. Envoyer une invitation

```typescript
// src/tatoueurs/tatoueurs.service.ts — createTeamRequest()
async createTeamRequest({ salonUserId, salonRole, body }) {
  // Vérifications :
  // - rôle salon
  // - le destinataire est bien un user_tatoueur
  // - il n'est pas déjà dans l'équipe (salonId === salonUserId)
  // - pas de demande PENDING en doublon

  await this.prisma.salonTatoueurTeamRequest.create({
    data: {
      salonId:       salonUserId,
      tatoueurUserId: body.tatoueurUserId,
      message:       body.message,
      status:        TeamRequestStatus.PENDING,
    },
  });
}
```

---

### 3. Accepter ou refuser une demande (côté tatoueur)

```typescript
// src/tatoueurs/tatoueurs.service.ts — respondToTeamRequest()
async respondToTeamRequest({ requestId, tatoueurUserId, tatoueurRole, action }) {
  // Vérification : la demande appartient bien à ce tatoueur + statut PENDING

  const nextStatus = action === 'accept' ? ACCEPTED : REFUSED;

  await this.prisma.$transaction(async (tx) => {
    // 1. Supprime les anciennes lignes au même statut final
    //    (contournement contrainte @@unique)
    await tx.salonTatoueurTeamRequest.deleteMany({
      where: { salonId: request.salonId, tatoueurUserId, status: nextStatus, id: { not: requestId } },
    });

    // 2. Met à jour le statut de la demande
    await tx.salonTatoueurTeamRequest.update({
      where: { id: requestId },
      data: { status: nextStatus, respondedAt: new Date() },
    });

    // 3. Si accepté : rattache le tatoueur au salon
    if (nextStatus === ACCEPTED) {
      await tx.user.update({
        where: { id: tatoueurUserId },
        data: { salonId: request.salonId },
      });
    }
  });

  // Invalide le cache de l'équipe du salon
  await this.cacheService.del(`tatoueurs:user:${request.salonId}`);
}
```

---

### 4. Retirer un tatoueur (côté salon)

```typescript
// src/tatoueurs/tatoueurs.service.ts — unlinkLinkedTatoueur()
async unlinkLinkedTatoueur({ salonUserId, salonRole, tatoueurUserId }) {
  // Vérifie que le tatoueur est bien rattaché à CE salon

  // 1. Détache le tatoueur
  await this.prisma.user.update({
    where: { id: tatoueurUserId },
    data: { salonId: null },
  });

  // 2. Supprime la ligne ACCEPTED pour permettre une future ré-invitation
  await this.prisma.salonTatoueurTeamRequest.deleteMany({
    where: { salonId: salonUserId, tatoueurUserId, status: TeamRequestStatus.ACCEPTED },
  });

  // Invalide le cache
  await this.cacheService.del(`tatoueurs:user:${salonUserId}`);
}
```

---

### 5. Quitter un salon (côté tatoueur)

```typescript
// src/tatoueurs/tatoueurs.service.ts — leaveCurrentSalon()
async leaveCurrentSalon({ tatoueurUserId, tatoueurRole }) {
  // Vérifie que le tatoueur est bien rattaché à un salon

  const formerSalonId = tatoueur.salonId;

  // 1. Détache le tatoueur
  await this.prisma.user.update({
    where: { id: tatoueurUserId },
    data: { salonId: null },
  });

  // 2. Supprime la ligne ACCEPTED (même logique que unlinkLinkedTatoueur)
  await this.prisma.salonTatoueurTeamRequest.deleteMany({
    where: { salonId: formerSalonId, tatoueurUserId, status: TeamRequestStatus.ACCEPTED },
  });

  await this.cacheService.del(`tatoueurs:user:${formerSalonId}`);
}
```

---

### 6. Voir les salons liés (côté tatoueur)

```typescript
// src/tatoueurs/tatoueurs.service.ts — getLinkedSalons()
// Retourne le salon actuel + l'historique des salons ACCEPTED
// Tri : salon actuel en premier, puis par date décroissante
```

---

## Impact sur les autres fonctions

### `getTatoueurByUserId` — équipe d'un salon

Fusionne les tatoueurs **internes** (modèle `Tatoueur`) et les tatoueurs **linked** (`User.salonId`).  
Les linked sont enrichis avec `isLinkedUser: true` et `isReadOnly: true`.

```typescript
// Tatoueurs internes (créés dans le salon)
const tatoueursInternes = await this.prisma.tatoueur.findMany({ where: { userId } });

// Tatoueurs users liés au salon
const linkedTatoueurs = await this.prisma.user.findMany({
  where: { salonId: userId, role: Role.user_tatoueur },
  select: { id, firstName, lastName, style, prestations, ... },
});

// Merge
return [
  ...tatoueursInternes.map(t => ({ ...t, isLinkedUser: false, isReadOnly: false })),
  ...linkedTatoueurs.map(u => ({
    id: `linked_${u.id}`,
    linkedUserId: u.id,
    isLinkedUser: true,
    isReadOnly: true,
    ...
  })),
];
```

---

### `getUserBySlugAndLocation` — profil public d'un utilisateur

Branchement par rôle :

- **`user_salon`** → retourne `Tatoueur[]` (internes + linked) avec `profileUserId`, `salonName`, `city`, `postalCode` sur les linked pour construire le lien vers leur propre profil Inkera.
- **`user_tatoueur`** → retourne `linkedSalons[]` (actuel + historiques ACCEPTED) à la place de l'équipe.

```typescript
if (found.role === 'user_tatoueur') {
  // Récupère salonId actuel + toutes les demandes ACCEPTED
  // Construit linkedSalons[] trié (actuel en premier)
  enrichedFound = { ...found, Tatoueur: [], linkedSalons };
} else {
  // Fusionne tatoueurs internes + linked users
  // Ajoute profileUserId / profileSalonName / profileCity / profilePostalCode sur les linked
  enrichedFound = { ...found, Tatoueur: [...internalTatoueurs, ...linkedTatoueurs], linkedSalons: [] };
}
```

---

## Gestion du cache Redis

| Action | Clés invalidées |
|--------|----------------|
| Invitation créée | *(pas de cache à invalider)* |
| Invitation acceptée/refusée | `tatoueurs:user:{salonId}`, `tatoueurs:user:{salonId}:appointment-enabled` |
| Retrait par le salon | `tatoueurs:user:{salonId}`, `tatoueurs:user:{salonId}:appointment-enabled` |
| Départ du tatoueur | `tatoueurs:user:{formerSalonId}`, `tatoueurs:user:{formerSalonId}:appointment-enabled` |

---

## Points de vigilance

| Problème | Solution |
|----------|----------|
| Contrainte `@@unique([salonId, tatoueurUserId, status])` bloque la ré-invitation | Suppression des lignes au statut cible avant update (`deleteMany`) |
| Un tatoueur ne peut pas être dans plusieurs salons simultanément | `User.salonId` est un champ simple (non tableau) |
| Le salon interne (`Tatoueur`) et le linked (`User`) ont des IDs de même type | Les linked ont le préfixe `linked_` sur leur `id` dans les réponses API |
