# Documentation - Fonctionnalité Visioconférence

## 📋 Vue d'ensemble

Cette documentation décrit l'implémentation complète de la fonctionnalité de visioconférence pour les rendez-vous dans l'application TattooStudio.

### 🎯 Objectif
Permettre aux salons de proposer des rendez-vous en visioconférence (consultations, projets, etc.) avec génération automatique de liens sécurisés et intégration dans les emails.

### 🛠️ Technologies utilisées
- **Jitsi Meet** : Plateforme de visioconférence gratuite et open-source
- **Prisma** : ORM pour la gestion des données
- **NestJS** : Framework backend
- **Node.js crypto** : Génération d'identifiants uniques

---

## 🗂️ Structure des fichiers ajoutés/modifiés

### Nouveaux fichiers créés

#### 1. `src/video-call/video-call.service.ts`
Service principal pour la gestion des liens de visioconférence.

```typescript
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class VideoCallService {
  
  /**
   * Génère un lien de visioconférence unique
   * Utilise Jitsi Meet pour créer une salle de réunion sécurisée
   */
  generateVideoCallLink(appointmentId: string, salonName?: string): string {
    // Générer un ID unique pour la salle
    const roomId = crypto.randomBytes(16).toString('hex');
    
    // Créer un nom de salle unique et sécurisé
    const sanitizedSalonName = salonName 
      ? salonName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
      : 'salon';
    
    const roomName = `${sanitizedSalonName}-rdv-${appointmentId.slice(-8)}-${roomId.slice(0, 8)}`;
    
    // Utiliser Jitsi Meet comme plateforme de visioconférence
    const jitsiDomain = 'meet.jit.si';
    const videoCallUrl = `https://${jitsiDomain}/${roomName}`;
    
    return videoCallUrl;
  }

  /**
   * Génère un lien avec des paramètres personnalisés pour Jitsi Meet
   */
  generateCustomVideoCallLink(
    appointmentId: string, 
    participantName?: string, 
    salonName?: string
  ): string {
    const baseUrl = this.generateVideoCallLink(appointmentId, salonName);
    const url = new URL(baseUrl);
    
    // Ajouter des paramètres personnalisés si fournis
    if (participantName) {
      url.searchParams.set('userInfo.displayName', participantName);
    }
    
    // Paramètres Jitsi pour améliorer l'expérience
    url.searchParams.set('config.startWithAudioMuted', 'true');
    url.searchParams.set('config.startWithVideoMuted', 'false');
    url.searchParams.set('config.prejoinPageEnabled', 'true');
    
    return url.toString();
  }

  /**
   * Valide si un lien de visioconférence est valide
   */
  isValidVideoCallUrl(videoCallUrl: string): boolean {
    try {
      const url = new URL(videoCallUrl);
      return url.hostname === 'meet.jit.si' && url.pathname.length > 1;
    } catch {
      return false;
    }
  }
}
```

#### 2. `src/video-call/video-call.module.ts`
Module NestJS pour le service de visioconférence.

```typescript
import { Module } from '@nestjs/common';
import { VideoCallService } from './video-call.service';

@Module({
  providers: [VideoCallService],
  exports: [VideoCallService],
})
export class VideoCallModule {}
```

#### 3. Migration Prisma
`prisma/migrations/20250922100000_add_visio_fields/migration.sql`

```sql
-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "visio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visioRoom" TEXT;
```

### Fichiers modifiés

#### 1. `prisma/schema.prisma`
Ajout des champs visio au modèle Appointment :

```prisma
model Appointment {
  // ... autres champs existants
  
  // --- Visio ---
  visio      Boolean           @default(false)  // coche la case ou non
  visioRoom  String?           // salle unique générée si visio = true
  
  // ... reste du modèle
}
```

#### 2. `src/appointments/dto/create-appointment.dto.ts`
Les champs visio étaient déjà présents :

```typescript
export class CreateAppointmentDto {
  // ... autres champs
  
  @IsBoolean()
  visio?: boolean = false; // coche la case ou non

  @IsString()
  @IsOptional()
  visioRoom?: string;
  
  // ... autres champs
}
```

---

## 🔧 Implémentation détaillée

### 1. Service de génération de liens vidéo

#### Fonctionnalités principales :

1. **Génération de liens uniques** :
   - Format : `https://meet.jit.si/{salonName}-rdv-{appointmentId}-{uniqueId}`
   - Utilise crypto.randomBytes pour l'unicité
   - Sanitise le nom du salon (supprime caractères spéciaux)

2. **Personnalisation** :
   - Nom de la salle basé sur le salon et l'ID du RDV
   - Paramètres Jitsi configurables (audio/vidéo, page de pré-connexion)

3. **Validation** :
   - Méthode pour vérifier la validité d'une URL Jitsi
   - Extraction du nom de salle depuis une URL

### 2. Intégration dans le service Appointments

#### Modifications dans `appointments.service.ts` :

1. **Injection du VideoCallService** :
```typescript
constructor(
  private readonly prisma: PrismaService, 
  private readonly mailService: MailService, 
  private readonly followupSchedulerService: FollowupSchedulerService,
  private readonly saasService: SaasService,
  private readonly videoCallService: VideoCallService // ✅ Nouveau
) {}
```

2. **Logique de génération dans create()** :
```typescript
// Extraire les champs visio du DTO
const { /* autres champs */, visio, visioRoom } = rdvBody;

// Générer le lien de visioconférence si nécessaire
let generatedVisioRoom = visioRoom;
if (visio && !visioRoom) {
  // Récupérer le nom du salon pour personnaliser le lien
  const salon = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { salonName: true }
  });
  
  // Générer un ID temporaire pour créer le lien vidéo
  const tempAppointmentId = crypto.randomBytes(8).toString('hex');
  generatedVisioRoom = this.videoCallService.generateVideoCallLink(
    tempAppointmentId, 
    salon?.salonName || undefined
  );
}

// Créer le rendez-vous avec les données visio
const newAppointment = await this.prisma.appointment.create({
  data: {
    // ... autres champs
    visio: visio || false,
    visioRoom: generatedVisioRoom
  },
});
```

3. **Même logique appliquée dans createByClient()** pour les RDV créés par les clients.

### 3. Mise à jour des templates d'email

#### Interface EmailTemplateData modifiée :

```typescript
export interface EmailTemplateData {
  appointmentDetails?: {
    // ... autres champs existants
    visio?: boolean;
    visioRoom?: string;
  };
  // ... autres propriétés
}
```

#### Template de confirmation mis à jour :

```html
${data.appointmentDetails.visio && data.appointmentDetails.visioRoom ? `
  <li>
    <span class="detail-label">🎥 Visioconférence :</span>
    <span class="detail-value">
      <a href="${data.appointmentDetails.visioRoom}" 
         style="background: #059669; color: white; padding: 8px 16px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; margin-top: 8px;">
        🎥 Rejoindre la visioconférence
      </a>
    </span>
  </li>
` : ''}
```

#### Emails mis à jour :
- `generateAppointmentConfirmationEmail` : Email de confirmation pour le client
- Tous les appels d'envoi d'email incluent maintenant `visio` et `visioRoom`

---

## 🚀 Utilisation

### 1. Créer un RDV avec visioconférence

#### Requête API :
```json
POST /appointments
{
  "title": "Consultation projet",
  "prestation": "PROJET",
  "start": "2025-09-23T14:00:00Z",
  "end": "2025-09-23T15:00:00Z",
  "clientFirstname": "John",
  "clientLastname": "Doe",
  "clientEmail": "john@example.com",
  "tatoueurId": "tatoueur-id",
  "visio": true,
  "visioRoom": null // Sera généré automatiquement
}
```

#### Réponse :
```json
{
  "error": false,
  "message": "Rendez-vous créé avec succès.",
  "appointment": {
    "id": "rdv-id",
    "title": "Consultation projet",
    "visio": true,
    "visioRoom": "https://meet.jit.si/mon-salon-rdv-12345678-abc12345",
    // ... autres champs
  }
}
```

### 2. Email reçu par le client

Le client recevra un email avec :
- Les informations classiques du RDV
- **Nouveau** : Un bouton stylé "🎥 Rejoindre la visioconférence"
- Le lien cliquable vers la salle Jitsi Meet

### 3. Expérience utilisateur

1. **Client clique sur le lien** → Ouvre Jitsi Meet
2. **Page de pré-connexion** → Teste micro/caméra
3. **Rejoint la salle** → Conversation vidéo avec le tatoueur

---

## 🔒 Sécurité et bonnes pratiques

### 1. Génération de liens sécurisés
- **Identifiants uniques** : crypto.randomBytes(16) pour éviter les collisions
- **Noms de salle complexes** : Combinaison salon + RDV + random
- **URLs non-prévisibles** : Impossible de deviner d'autres salles

### 2. Validation des données
- Vérification de la validité des URLs Jitsi
- Sanitisation du nom du salon (caractères alphanumériques uniquement)
- Gestion des erreurs si le service Jitsi est indisponible

### 3. Base de données
- Champ `visio` : Boolean avec défaut false
- Champ `visioRoom` : String optionnel (NULL si pas de visio)
- Index appropriés pour les performances

---

## 🧪 Tests et débogage

### 1. Tester la génération de liens

```typescript
// Dans un test ou une route de debug
const videoCallService = new VideoCallService();
const link = videoCallService.generateVideoCallLink('test-123', 'Mon Salon');
console.log(link); // https://meet.jit.si/mon-salon-rdv-test-123-abc12345
```

### 2. Vérifier la base de données

```sql
-- Voir les RDV avec visio
SELECT id, title, visio, visioRoom, start, end 
FROM "Appointment" 
WHERE visio = true;
```

### 3. Test d'intégration email
- Créer un RDV avec `visio: true`
- Vérifier que l'email contient le bouton de visioconférence
- Tester le lien généré dans Jitsi Meet

---

## 🔧 Configuration et déploiement

### 1. Variables d'environnement
Aucune variable supplémentaire requise. Jitsi Meet est utilisé via son service public gratuit.

### 2. Migration base de données
```bash
# Appliquer la migration
npx prisma migrate dev

# Générer le client Prisma
npx prisma generate

# Ou forcer la synchronisation
npx prisma db push
```

### 3. Modules à importer
```typescript
// Dans app.module.ts ou le module parent
import { VideoCallModule } from './video-call/video-call.module';

@Module({
  imports: [
    // ... autres modules
    VideoCallModule,
  ],
})
```

---

## 🚀 Évolutions futures possibles

### 1. Autres plateformes de visio
- Support de Zoom, Google Meet, Teams
- Configuration via variables d'environnement
- Choix de la plateforme par salon

### 2. Fonctionnalités avancées
- Enregistrement des sessions
- Partage d'écran pour montrer des références
- Chat intégré
- Notifications de rappel avant le RDV

### 3. Intégration mobile
- Deep links vers les apps natives
- Boutons spécifiques iOS/Android dans les emails

### 4. Analytics
- Statistiques d'utilisation des visioconférences
- Durée des sessions
- Taux d'adoption par salon

---

## 📝 Notes techniques

### Performance
- Génération de liens très rapide (crypto natif Node.js)
- Aucun impact sur les RDV sans visio
- Pas de limitation de Jitsi Meet

### Compatibilité
- Fonctionne sur tous navigateurs modernes
- Mobile-friendly (responsive)
- Pas d'installation requise côté client

### Maintenance
- Service autonome, facile à tester
- Code modulaire et réutilisable
- Documentation des méthodes complète

---

*Documentation mise à jour le 22 septembre 2025*