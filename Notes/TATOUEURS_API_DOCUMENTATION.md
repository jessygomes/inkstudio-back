# 👨‍🎨 API Documentation - Module Tatoueurs

## Table des matières

1. [🔧 Création de tatoueur](#création-de-tatoueur)
2. [📖 Consultation de tatoueurs](#consultation-de-tatoueurs)
3. [✏️ Modification de tatoueur](#modification-de-tatoueur)
4. [🗑️ Suppression de tatoueur](#suppression-de-tatoueur)
5. [🔐 Système SaaS et limites](#système-saas-et-limites)

---

## 🔧 Création de tatoueur

### 1. Créer un tatoueur
**Route :** `POST /tatoueurs`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Post()
create(@Request() req: RequestWithUser, @Body() tatoueurBody: CreateTatoueurDto) {
  const userId = req.user.userId;
  return this.tatoueursService.create({ tatoueurBody, userId });
}
```

**Service associé :** `create()`

**Logique du service :**
- **Vérification SaaS :** Contrôle des limites selon le plan d'abonnement
- **Données créées :**
  - `name` : Nom du tatoueur
  - `img` : Photo de profil
  - `description` : Présentation/bio
  - `phone` : Téléphone de contact
  - `instagram` : Compte Instagram
  - `hours` : Horaires personnalisés (JSON)
  - `style` : Array des styles pratiqués
  - `skills` : Array des compétences
  - `userId` : Lien avec le salon (automatique)

**Gestion des limites SaaS :**
```typescript
const canCreateTatoueur = await this.saasService.canPerformAction(userId, 'tatoueur');

if (!canCreateTatoueur) {
  const limits = await this.saasService.checkLimits(userId);
  return {
    error: true,
    message: `Limite de tatoueurs atteinte (${limits.limits.tattooeurs}). Passez au plan PRO ou BUSINESS pour continuer.`,
  };
}
```

**Réponse de succès :**
```json
{
  "error": false,
  "message": "Tatoueur créé avec succès.",
  "tatoueur": {
    "id": "cm...",
    "name": "John Doe",
    "img": "url...",
    "description": "...",
    "phone": "...",
    "instagram": "...",
    "hours": "...",
    "style": ["realisme", "traditionnel"],
    "skills": ["portrait", "couleur"],
    "userId": "cm..."
  }
}
```

---

## 📖 Consultation de tatoueurs

### 2. Voir tous les tatoueurs (Global)
**Route :** `GET /tatoueurs`  
**Authentification :** Non requise

```typescript
@Get()
findAll() {
  return this.tatoueursService.getAllTatoueurs();
}
```

**Service associé :** `getAllTatoueurs()`
- Récupère tous les tatoueurs de tous les salons
- **Usage :** Recherche globale, annuaire public
- **Pas de filtrage :** Données brutes complètes

### 3. Voir tatoueurs d'un salon
**Route :** `GET /tatoueurs/user/:id`  
**Authentification :** Non requise

```typescript
@Get('user/:id')
getTatoueurByUserId(@Param('id') id: string) {
  return this.tatoueursService.getTatoueurByUserId(id);
}
```

**Service associé :** `getTatoueurByUserId()`
- Filtre par `userId` (ID du salon)
- **Usage :** Affichage équipe d'un salon spécifique
- **Ordre des routes :** Placé avant `/:id` pour éviter conflits

### 4. Voir un tatoueur spécifique
**Route :** `GET /tatoueurs/:id`  
**Authentification :** Non requise

```typescript
@Get(':id')
getOneTatoueur(@Param('id') id: string) {
  return this.tatoueursService.getOneTatoueur(id);
}
```

**Service associé :** `getOneTatoueur()`
- Récupère un tatoueur par son ID unique
- **Usage :** Page profil tatoueur, booking spécifique
- **Position :** En dernier pour éviter les conflits de routing

---

## ✏️ Modification de tatoueur

### 5. Modifier un tatoueur
**Route :** `PATCH /tatoueurs/update/:id`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Patch('update/:id')
updateTatoueur(@Param('id') id: string, @Body() tatoueurBody: CreateTatoueurDto) {
  return this.tatoueursService.updateTatoueur(id, tatoueurBody);
}
```

**Service associé :** `updateTatoueur()`

**Champs modifiables :**
- **Informations personnelles :** `name`, `img`, `description`, `phone`, `instagram`
- **Horaires :** `hours` (JSON des disponibilités)
- **Compétences :** `style` (array), `skills` (array)

**Logique de mise à jour :**
- Réutilise le même DTO que la création (`CreateTatoueurDto`)
- Mise à jour complète de tous les champs
- **Pas de vérification SaaS** (modification d'existant)

**Réponse de succès :**
```json
{
  "error": false,
  "message": "Tatoueur modifié avec succès.",
  "tatoueur": { /* données mises à jour */ }
}
```

---

## 🗑️ Suppression de tatoueur

### 6. Supprimer un tatoueur
**Route :** `DELETE /tatoueurs/delete/:id`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Delete('delete/:id')
deleteTatoueur(@Param('id') id: string) {
  return this.tatoueursService.deleteTatoueur(id);
}
```

**Service associé :** `deleteTatoueur()`

**Logique de suppression :**
- Suppression définitive de l'enregistrement
- **Cascade :** Supprime automatiquement les relations liées
- **Pas de soft delete :** Suppression physique

**Réponse de succès :**
```json
{
  "error": false,
  "message": "Tatoueur supprimé avec succès.",
  "tatoueur": { /* données supprimées */ }
}
```

**⚠️ Attention :** 
- Supprime les liens avec appointments, portfolios, etc.
- Action irréversible

---

## 🔐 Système SaaS et limites

### Vérification des limites

**Service intégré :** `SaasService`

**Méthode :** `canPerformAction(userId, 'tatoueur')`

**Plans et limites typiques :**
- **FREE :** 1-2 tatoueurs max
- **PRO :** 5-10 tatoueurs max  
- **BUSINESS :** Illimité

**Processus de vérification :**
1. Appel `saasService.canPerformAction(userId, 'tatoueur')`
2. Si `false` → Récupère les limites avec `checkLimits(userId)`
3. Retourne message d'erreur avec limite actuelle
4. Propose upgrade de plan

**Message d'erreur type :**
```
"Limite de tatoueurs atteinte (2). Passez au plan PRO ou BUSINESS pour continuer."
```

### Actions concernées par les limites

**✅ Soumis aux limites :**
- Création de nouveau tatoueur

**❌ Non soumis aux limites :**
- Consultation (toutes routes GET)
- Modification d'existant
- Suppression

---

## 🔍 Points techniques importants

### Organisation des routes

**Ordre critique :**
1. `POST /` - Création (sécurisée)
2. `GET /` - Liste globale (publique)
3. `GET /user/:id` - Par salon (publique, spécifique)
4. `GET /:id` - Individuel (publique, générique)
5. `PATCH /update/:id` - Modification (sécurisée)
6. `DELETE /delete/:id` - Suppression (sécurisée)

**Rationale :** Routes spécifiques avant génériques pour éviter conflits NestJS

### Authentification

**Routes sécurisées :**
- Création, modification, suppression
- Utilise `JwtAuthGuard` + `RequestWithUser`

**Routes publiques :**
- Toutes les consultations
- Permet affichage public des profils

### Gestion des erreurs

**Format uniforme :**
```typescript
{
  error: boolean,
  message: string,
  data?: any
}
```

**Try-catch systématique :**
- Capture toutes les erreurs Prisma
- Messages d'erreur explicites
- Fallback générique si erreur inconnue

### Types de données

**CreateTatoueurDto (utilisé aussi pour update) :**
```typescript
{
  name: string,
  img: string,
  description: string,
  phone: string,
  instagram: string,
  hours: string, // JSON stringifié
  style: string[], // Array de styles
  skills: string[] // Array de compétences
}
```

**Champs automatiques :**
- `id` : Généré par Prisma
- `userId` : Extrait du JWT lors création
- `createdAt`, `updatedAt` : Timestamps automatiques

### Relations avec autres modules

**Appointments :**
- `tatoueurId` lie les RDV aux tatoueurs
- Gestion des horaires personnalisés

**Portfolio :**
- `tatoueurId` pour les œuvres par artiste
- Affichage galerie individuelle

**Time-slots :**
- `tatoueur.hours` pour créneaux personnalisés
- Disponibilités spécifiques par artiste

**Users :**
- `userId` lie tatoueur au salon
- Hiérarchie salon → tatoueurs

### Logique métier spécifique

**Horaires personnalisés :**
- Format JSON identique aux salons
- Permet horaires différents par tatoueur
- Intégration avec système de créneaux

**Styles et compétences :**
- Arrays pour multi-sélection
- Filtrage possible par spécialité
- Évolution : tags/catégories

**Système SaaS :**
- Contrôle en amont (avant création)
- Messages adaptés au plan actuel
- Intégration fluide sans blocage brutal

### Cas d'usage principaux

1. **Gestion salon :** CRUD complet équipe
2. **Booking client :** Sélection artiste spécifique  
3. **Portfolio public :** Présentation des artistes
4. **Planning :** Horaires et disponibilités
5. **Recherche :** Filtres par style/compétence
