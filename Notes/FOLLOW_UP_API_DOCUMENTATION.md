# 🔄 API Documentation - Module Follow-up

## Table des matières

1. [🔗 Validation de token](#validation-de-token)
2. [📸 Soumission client](#soumission-client)
3. [📊 Consultation des suivis](#consultation-des-suivis)
4. [💬 Réponse salon](#réponse-salon)
5. [🗑️ Suppression de suivi](#suppression-de-suivi)
6. [⏰ Système de planification](#système-de-planification)
7. [🔧 Architecture technique](#architecture-technique)

---

## 🔗 Validation de token

### 1. Valider un token de suivi
**Route :** `GET /follow-up/requests/:token`  
**Authentification :** Non requise

```typescript
@Get('requests/:token')
async validateToken(@Param('token') token: string) {
  try {
    const req = await this.prisma.followUpRequest.findUnique({
      where: { token },
      include: { submission: true, appointment: true },
    });
    
    if (!req) {
      throw new BadRequestException('Lien invalide');
    }
    
    if (req.submission) {
      throw new BadRequestException('Déjà soumis');
    }
    
    if (req.expiresAt && req.expiresAt < new Date()) {
      throw new BadRequestException('Lien expiré');
    }
    
    return { ok: true };
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException('Erreur lors de la validation du token');
  }
}
```

**Logique de validation :**
- **Token inexistant** → `"Lien invalide"`
- **Déjà soumis** → `"Déjà soumis"`
- **Expiré (14 jours)** → `"Lien expiré"`
- **Valide** → `{ ok: true }`

**Usage :** Vérification côté frontend avant affichage du formulaire

---

## 📸 Soumission client

### 2. Soumettre un suivi
**Route :** `POST /follow-up/submissions`  
**Authentification :** Non requise

```typescript
@Post('submissions')
async submit(
  @Body() body: { 
    token: string; 
    rating: number; 
    review?: string; 
    photoUrl: string; 
    userId?: string; 
    isPhotoPublic?: boolean; 
  },
) {
  // Vérifier et récupérer la demande de suivi
  const req = await this.prisma.followUpRequest.findUnique({ 
    where: { token: body.token }, 
    include: { appointment: true, submission: true }
  });
  
  if (!req) throw new BadRequestException('Token invalide');
  if (req.submission) {
    throw new BadRequestException('Ce suivi a déjà été soumis');
  }
  if (req.expiresAt && req.expiresAt < new Date()) {
    throw new BadRequestException('Lien expiré');
  }

  // Créer la soumission
  const submission = await this.prisma.followUpSubmission.create({
    data: {
      appointmentId: req.appointmentId,
      clientId: req.appointment?.clientId ?? null,
      rating: body.rating,
      review: body.review,
      photoUrl: body.photoUrl,
      isPhotoPublic: body.isPhotoPublic ?? false,
      userId: req.appointment?.userId || '',
    },
  });

  // Marquer comme soumis
  await this.prisma.followUpRequest.update({
    where: { token: body.token },
    data: { 
      status: 'SUBMITTED',
      submissionId: submission.id
    },
  });

  return { ok: true };
}
```

**Données de soumission :**
- **rating** : Note de 1 à 5 (obligatoire)
- **review** : Commentaire optionnel
- **photoUrl** : Photo de cicatrisation (obligatoire)
- **isPhotoPublic** : Autorisation publication (défaut: false)

**Logique transactionnelle :**
1. Validation du token (même que route précédente)
2. Création `FollowUpSubmission`
3. Mise à jour `FollowUpRequest` (statut + lien)

---

## 📊 Consultation des suivis

### 3. Suivis non répondus (salon)
**Route :** `GET /follow-up/unanswered`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('unanswered')
async getUnansweredFollowUps(@Request() req: RequestWithUser) {
  const userId = req.user.userId;
  const followUps = await this.prisma.followUpSubmission.findMany({
    where: { isAnswered: false, userId },
    include: { 
      appointment: {
        select: {
          id: true, title: true, start: true, end: true,
          client: { select: { id: true, firstName: true, lastName: true } },
          tatoueur: { select: { id: true, name: true } },
        }
      }
    },
  });
  return { followUps };
}
```

**Usage :** Notifications temps réel, dashboard salon

### 4. Nombre de suivis non répondus
**Route :** `GET /follow-up/unanswered/:userId/number`  
**Authentification :** Non requise

```typescript
@Get('unanswered/:userId/number')
async getUnansweredNumberFollowUps(@Param('userId') userId: string) {
  const count = await this.prisma.followUpSubmission.count({
    where: { isAnswered: false, userId },
  });
  return { count };
}
```

**Usage :** Badge de notification, compteur header

### 5. Tous les suivis avec filtres
**Route :** `GET /follow-up/all`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('all')
async getAllFollowUps(
  @Request() req: RequestWithUser,
  @Query('page') page = '1',
  @Query('limit') limit = '10',
  @Query('status') status?: 'all' | 'answered' | 'unanswered',
  @Query('tatoueurId') tatoueurId?: string,
  @Query('q') q?: string,
) {
  const userId = req.user.userId;
  const currentPage = Math.max(1, Number(page) || 1);
  const perPage = Math.min(50, Math.max(1, Number(limit) || 10));
  const skip = (currentPage - 1) * perPage;

  const where: Record<string, unknown> = { userId };

  if (status && status !== 'all') {
    where.isAnswered = status === 'answered';
  }
  if (tatoueurId && tatoueurId !== 'all') {
    where.appointment = { tatoueurId };
  }
  if (q && q.trim() !== '') {
    const query = q.trim();
    where.OR = [
      { appointment: { client: { firstName: { contains: query, mode: 'insensitive' } } } },
      { appointment: { client: { lastName:  { contains: query, mode: 'insensitive' } } } },
    ];
  }

  const [total, followUps] = await this.prisma.$transaction([
    this.prisma.followUpSubmission.count({ where }),
    this.prisma.followUpSubmission.findMany({
      where,
      include: {
        appointment: {
          select: {
            id: true, title: true, start: true, end: true,
            client: { select: { id: true, firstName: true, lastName: true } },
            tatoueur: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip, take: perPage,
    }),
  ]);

  // Retourne pagination complète
}
```

**Filtres disponibles :**
- **status** : 'all' | 'answered' | 'unanswered'
- **tatoueurId** : ID tatoueur ou 'all'
- **q** : Recherche nom/prénom client
- **page/limit** : Pagination standard

**Transaction Prisma :** Count + Data pour cohérence

---

## 💬 Réponse salon

### 6. Répondre à un suivi
**Route :** `POST /follow-up/reply/:id`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Post('reply/:id')
async replyToFollowUp(
  @Param('id') id: string,
  @Body() body: { response: string }
) {
  // Vérifications
  const followUp = await this.prisma.followUpSubmission.findUnique({
    where: { id },
    include: { 
      appointment: {
        include: {
          client: true,
          tatoueur: { select: { name: true } },
          user: { select: { salonName: true } }
        }
      }
    },
  });
  
  if (!followUp) throw new BadRequestException('Suivi non trouvé');
  if (followUp.isAnswered) throw new BadRequestException('Ce suivi a déjà été répondu');
  if (!followUp.appointment?.client) throw new BadRequestException('Client associé introuvable');

  // Mise à jour du suivi
  const updatedFollowUp = await this.prisma.followUpSubmission.update({
    where: { id },
    data: {
      response: body.response,
      isAnswered: true,
    },
  });

  // Envoi email au client
  const client = followUp.appointment.client;
  const salon = followUp.appointment.user?.salonName || 'Notre salon';
  const tatoueur = followUp.appointment.tatoueur?.name || 'notre artiste';
  
  await this.mailService.sendMail({
    to: client.email,
    subject: `Réponse à votre suivi de cicatrisation - ${salon}`,
    html: `/* Template email avec réponse salon */`,
  });

  return { 
    success: true,
    message: 'Réponse envoyée avec succès',
    updatedFollowUp 
  };
}
```

**Logique de réponse :**
1. Validation existence + état non-répondu
2. Mise à jour `isAnswered: true` + `response`
3. Email automatique au client avec réponse
4. Template email professionnel personnalisé

---

## 🗑️ Suppression de suivi

### 7. Supprimer un suivi
**Route :** `POST /follow-up/delete/:id`  
**Authentification :** Non requise

```typescript
@Post('delete/:id')
async deleteFollowUp(@Param('id') id: string) {
  const followUp = await this.prisma.followUpSubmission.findUnique({
    where: { id },
  });
  if (!followUp) {
    throw new BadRequestException('Suivi non trouvé');
  }

  try {
    // Gérer les relations avant suppression
    const relatedRequest = await this.prisma.followUpRequest.findFirst({
      where: { submissionId: id }
    });

    if (relatedRequest) {
      // Nettoyer la relation
      await this.prisma.followUpRequest.update({
        where: { id: relatedRequest.id },
        data: { submissionId: null }
      });
    }

    // Supprimer la soumission
    await this.prisma.followUpSubmission.delete({
      where: { id },
    });

    // Supprimer la demande si plus nécessaire
    if (relatedRequest) {
      await this.prisma.followUpRequest.delete({
        where: { id: relatedRequest.id }
      });
    }

    return { success: true, message: 'Suivi supprimé avec succès' };
    
  } catch (error) {
    console.error('Erreur lors de la suppression du suivi:', error);
    throw new BadRequestException('Erreur lors de la suppression du suivi');
  }
}
```

**Logique de suppression complexe :**
1. Vérification existence
2. Nettoyage relation `FollowUpRequest.submissionId`
3. Suppression `FollowUpSubmission`
4. Suppression `FollowUpRequest` si orpheline

---

## ⏰ Système de planification

### Architecture de planification

**Deux approches disponibles :**

#### **1. FollowupSchedulerService (setTimeout)**
```typescript
export class FollowupSchedulerService {
  private scheduledJobs = new Map<string, NodeJS.Timeout>();

  async scheduleFollowup(appointmentId: string, endTime: Date) {
    // Calculer délai : 10 minutes après fin RDV
    const followupTime = new Date(endTime.getTime() + 10 * 60 * 1000);
    const delayMs = Math.max(0, followupTime.getTime() - Date.now());

    // Si déjà passé, envoyer immédiatement
    if (delayMs === 0) {
      await this.sendFollowupEmail(appointmentId);
      return;
    }

    // Planifier avec setTimeout
    const timeoutId = setTimeout(() => {
      this.sendFollowupEmail(appointmentId);
    }, delayMs);

    this.scheduledJobs.set(appointmentId, timeoutId);
  }
}
```

**Caractéristiques :**
- ✅ Simple et direct
- ✅ Pas de dépendance externe
- ❌ Perdu au redémarrage serveur
- ❌ Pas de retry automatique

#### **2. FollowupQueueService + Processor (Bull/Redis)**
```typescript
@Injectable()
export class FollowupQueueService {
  constructor(@InjectQueue('followup') private queue: Queue) {}

  async scheduleFollowup(appointmentId: string, end: Date) {
    const delayMs = Math.max(0, end.getTime() + 10 * 60 * 1000 - Date.now());

    await this.queue.add(
      'sendFollowupEmail',
      { appointmentId },
      {
        delay: delayMs,
        jobId: `followup:${appointmentId}`,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );
  }
}

@Processor('followup')
export class FollowupProcessor {
  @Process('sendFollowupEmail')
  async handle(job: Job<{ appointmentId: string }>) {
    const { appointmentId } = job.data;
    
    // Logique d'envoi avec idempotence
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { client: true, tatoueur: true, user: true },
    });

    // Vérifier si déjà soumis (idempotence)
    const existingReq = await this.prisma.followUpRequest.findUnique({
      where: { appointmentId },
      include: { submission: true },
    });

    if (existingReq?.submission) {
      return; // Déjà traité
    }

    // Créer ou mettre à jour demande
    const request = await this.prisma.followUpRequest.upsert({
      where: { appointmentId },
      update: {},
      create: {
        appointmentId,
        token: randomUUID(),
        expiresAt: addDays(appt.end ?? new Date(), 14),
        userId: appt.userId,
      },
    });

    // Envoyer email
    await this.mail.sendMail({
      to: appt.client.email,
      subject: 'Suivi de cicatrisation — Envoyez votre photo',
      html: `/* Template email de suivi */`,
    });
  }
}
```

**Caractéristiques :**
- ✅ Persistant (survit aux redémarrages)
- ✅ Retry automatique (3 tentatives)
- ✅ Idempotence (pas de doublons)
- ✅ Monitoring des jobs
- ❌ Dépendance Redis
- ❌ Plus complexe

---

## 🔧 Architecture technique

### Flux complet du suivi

```
1. 📅 RDV confirmé (appointments.service.ts)
   ↓
2. ⏰ Planification suivi (10min après fin)
   ↓ (FollowupSchedulerService OU FollowupQueueService)
3. 📧 Envoi email avec token unique
   ↓
4. ✅ Client clique lien → Validation token
   ↓
5. 📸 Client soumet photo + note + avis
   ↓
6. 📊 Salon consulte suivis → Filtre/Recherche
   ↓
7. 💬 Salon répond → Email automatique client
   ↓
8. 🗑️ Suppression optionnelle (avec nettoyage relations)
```

### Modèle de données

#### **FollowUpRequest**
```typescript
{
  id: string,
  appointmentId: string, // Unique
  token: string,         // UUID pour sécurité
  status: 'PENDING' | 'SUBMITTED',
  sentAt: Date?,
  expiresAt: Date,       // 14 jours par défaut
  userId: string,        // Salon propriétaire
  submissionId: string?, // Lien vers soumission
}
```

#### **FollowUpSubmission**
```typescript
{
  id: string,
  appointmentId: string,
  clientId: string?,
  userId: string,        // Salon
  rating: number,        // 1-5 étoiles
  review: string?,       // Commentaire optionnel
  photoUrl: string,      // Photo cicatrisation
  isPhotoPublic: boolean,// Autorisation publication
  response: string?,     // Réponse salon
  isAnswered: boolean,   // État traitement
  createdAt: Date,
}
```

### Sécurité et tokens

**Génération token :**
```typescript
import { randomUUID } from 'crypto';
const token = randomUUID(); // UUID v4 sécurisé
```

**Validation temporelle :**
- **Création :** `expiresAt = now + 14 jours`
- **Validation :** `if (expiresAt < now) throw "Expiré"`

**Protection contre replay :**
- Vérification `submission` existante
- Mise à jour statut `SUBMITTED`

### Gestion d'erreurs

**BadRequestException uniformisé :**
- `"Lien invalide"` - Token inexistant
- `"Déjà soumis"` - Protection doublons
- `"Lien expiré"` - Expiration temporelle
- `"Suivi non trouvé"` - ID invalide
- `"Ce suivi a déjà été répondu"` - État incohérent

### Intégrations système

**Avec Appointments :**
- Déclenchement lors confirmation RDV
- Filtrage par tatoueur dans consultations

**Avec MailService :**
- Email suivi initial (automatique)
- Email réponse salon (interactif)
- Templates personnalisés par salon

**Avec Bull/Redis (optionnel) :**
- Persistence jobs entre redémarrages
- Retry automatique avec backoff
- Monitoring et statistiques

### Points d'optimisation

**Performance :**
- Transaction Prisma pour pagination
- Index sur `token`, `appointmentId`, `userId`
- Requêtes avec `select` spécifiques

**Fiabilité :**
- Idempotence des emails (vérif submission)
- Nettoyage relations avant suppression
- Logs détaillés pour debugging

**UX :**
- Messages d'erreur explicites
- Compteurs temps réel
- Filtres multiples combinables
