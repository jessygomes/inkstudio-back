# 👥 API Documentation - Module Users

## Table des matières

1. [🔍 Recherche et consultation](#recherche-et-consultation)
2. [⚙️ Gestion des paramètres](#gestion-des-paramètres)
3. [📊 Données de référence](#données-de-référence)
4. [👤 Gestion du profil](#gestion-du-profil)
5. [📸 Gestion des photos](#gestion-des-photos)
6. [🕒 Gestion des horaires](#gestion-des-horaires)

---

## 🔍 Recherche et consultation

### 1. Recherche d'utilisateurs
**Route :** `GET /users/search`  
**Authentification :** Non requise

```typescript
@Get('search')
async searchUsers(@Query('query') query: string) {
  return await this.userService.searchUsers(query);
}
```

**Service associé :** `searchUsers()`
- Recherche insensible à la casse sur `salonName` et noms des tatoueurs
- Si pas de query → retourne tous les utilisateurs via `getUsers()`
- Inclut : informations salon, tatoueurs, photos, réseaux sociaux
- **Champs de recherche :** Nom salon, nom tatoueur

### 2. Obtenir tous les utilisateurs avec filtres
**Route :** `GET /users`  
**Authentification :** Non requise

```typescript
@Get()
async getUsers(@Query() dto: GetUsersDto) {
  const { query, city, style, page, limit } = dto;
  return this.userService.getUsers(query, city, style, page, limit);
}
```

**Service associé :** `getUsers()`
- **Filtres disponibles :**
  - `query` : Recherche textuelle sur salon/tatoueur
  - `city` : Filtrage par ville
  - `style` : Filtrage par style de tatouage
  - `page` : Numéro de page (défaut: 1)
  - `limit` : Limite par page (défaut: 1, max: 50)

- **Logique de filtrage :**
  - Query → OR sur `salonName` et noms tatoueurs
  - City → Recherche insensible à la casse
  - Style → Vérifie si le style existe dans le tableau `style` des tatoueurs

- **Pagination robuste :**
  - Calcul sécurisé des pages
  - Transaction Prisma pour cohérence count/data
  - Métadonnées complètes (totalPages, hasNext, etc.)

### 3. Obtenir utilisateur par slug et localisation
**Route :** `GET /users/:nameSlug/:locSlug`  
**Authentification :** Non requise

```typescript
@Get(":nameSlug/:locSlug")
getUserBySlugAndLocation(@Param('nameSlug') nameSlug: string, @Param('locSlug') locSlug: string) {
  return this.userService.getUserBySlugAndLocation({ nameSlug, locSlug });
}
```

**Service associé :** `getUserBySlugAndLocation()`
- **Génération de slugs :** Normalisation NFD + suppression diacritiques + kebab-case
- **Slug nom :** Basé sur `salonName`
- **Slug localisation :** Combinaison `city-postalCode`
- **Logique de matching :** Filtrage côté JavaScript après récupération
- **Inclut :** Données complètes + Portfolio + ProductSalon

### 4. Obtenir utilisateur par ID
**Route :** `GET /users/:userId`  
**Authentification :** Non requise

```typescript
@Get(":userId")
getUser(@Param('userId') userId: string) {
  return this.userService.getUserById({userId});
}
```

**Service associé :** `getUserById()`
- Profil complet d'un utilisateur spécifique
- **Inclut :** Plan SaaS, informations salon, tatoueurs
- **Sécurité :** Pas de données sensibles exposées

---

## ⚙️ Gestion des paramètres

### 5. Obtenir paramètre de confirmation RDV
**Route :** `GET /users/confirmation-setting`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('confirmation-setting')
getConfirmationSetting(@Request() req: RequestWithUser) {
  const userId = req.user.userId;
  return this.userService.getConfirmationSetting({ userId });
}
```

**Service associé :** `getConfirmationSetting()`
- Récupère le paramètre `addConfirmationEnabled`
- **Usage :** Détermine si les RDV clients nécessitent confirmation manuelle
- **Sécurité :** Utilisateur authentifié uniquement

### 6. Mettre à jour paramètre de confirmation RDV
**Route :** `PATCH /users/confirmation-setting`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Patch('confirmation-setting')
updateConfirmationSetting(@Body() body: UpdateConfirmationSettingDto, @Request() req: RequestWithUser) {
  const userId = req.user.userId;
  console.log("userId dans le controller:", body, userId);
  return this.userService.updateConfirmationSetting({
    userId,
    addConfirmationEnabled: body.addConfirmationEnabled,
  });
}
```

**Service associé :** `updateConfirmationSetting()`
- Met à jour `addConfirmationEnabled` (boolean)
- **Messages contextuels :**
  - `true` → "Confirmation manuelle activée"
  - `false` → "Confirmation automatique activée"
- **Impact :** Affecte le comportement des nouveaux RDV clients

---

## 📊 Données de référence

### 7. Obtenir toutes les villes
**Route :** `GET /users/cities`  
**Authentification :** Non requise

```typescript
@Get('cities')
async getDistinctCities() {
  return this.userService.getDistinctCities();
}
```

**Service associé :** `getDistinctCities()`
- Liste des villes distinctes où il y a des salons
- **Traitement :** Tri alphabétique + suppression des valeurs nulles/vides
- **Usage :** Filtres de recherche, auto-complétion

### 8. Obtenir tous les styles de tatouage
**Route :** `GET /users/styleTattoo`  
**Authentification :** Non requise

```typescript
@Get('styleTattoo')
async getDistinctStyles() {
  return this.userService.getDistinctStyles();
}
```

**Service associé :** `getDistinctStyles()`
- Extraction des styles depuis les tableaux `style` des tatoueurs
- **Traitement :** Aplatissement + déduplication + tri
- **Type de retour :** `Promise<string[]>`
- **Usage :** Filtres de recherche par spécialité

---

## 👤 Gestion du profil

### 9. Mettre à jour profil utilisateur
**Route :** `PATCH /users/:userId`  
**Authentification :** Non requise

```typescript
@Patch(":userId")
updateUser(@Param('userId') userId: string, @Body() userBody: UpdateUserDto) {
  return this.userService.updateUser({userId, userBody});
}
```

**Service associé :** `updateUser()`
- **Champs modifiables :**
  - Informations salon : `salonName`, `description`, `image`
  - Contact : `firstName`, `lastName`, `phone`, `address`, `city`, `postalCode`
  - Réseaux sociaux : `instagram`, `facebook`, `tiktok`, `website`
  - Services : `prestations`

- **Validation des prestations :**
  - Liste autorisée : `["TATTOO", "RETOUCHE", "PROJET", "PIERCING"]`
  - Normalisation : Majuscules + trim
  - Filtrage sécurisé des valeurs invalides

---

## 📸 Gestion des photos

### 10. Obtenir photos du salon
**Route :** `GET /users/:userId/photos`  
**Authentification :** Non requise

```typescript
@Get(":userId/photos")
getPhotosSalon(@Param('userId') userId: string) {
  console.log("userId dans le controller:", userId);
  return this.userService.getPhotosSalon({userId});
}
```

**Service associé :** `getPhotosSalon()`
- Récupère le tableau `salonPhotos`
- **Valeur par défaut :** Tableau vide si pas de photos
- **Type :** `string[]` (URLs des images)

### 11. Ajouter/Mettre à jour photos du salon
**Route :** `PATCH /users/:userId/photos`  
**Authentification :** Non requise

```typescript
@Patch(":userId/photos")
addOrUpdatePhotoSalon(@Param('userId') userId: string, @Body() body: string[] | {photoUrls: string[]}) {
  const salonPhotos = Array.isArray(body) ? body : body.photoUrls;
  return this.userService.addOrUpdatePhotoSalon({userId, salonPhotos});
}
```

**Service associé :** `addOrUpdatePhotoSalon()`
- **Formats acceptés :**
  - Tableau direct : `["url1", "url2"]`
  - Objet : `{photoUrls: ["url1", "url2"]}`

- **Contraintes :**
  - Maximum 6 photos
  - Validation du format (doit être un tableau)
  - Remplacement complet (pas d'ajout)

- **Gestion d'erreurs :**
  - Format invalide → Exception explicite
  - Trop de photos → Exception avec limite

---

## 🕒 Gestion des horaires

### 12. Mettre à jour horaires du salon
**Route :** `PATCH /users/:userId/hours`  
**Authentification :** Non requise

```typescript
@Patch(":userId/hours")
updateHoursSalon(@Param('userId') userId: string, @Body() salonHours: Record<string, { start: string; end: string } | null>) {
  return this.userService.updateHoursSalon({userId, salonHours: JSON.stringify(salonHours)});
}
```

**Service associé :** `updateHoursSalon()`
- **Format attendu :**
```typescript
{
  "lundi": { "start": "09:00", "end": "18:00" },
  "mardi": { "start": "09:00", "end": "18:00" },
  "mercredi": null, // Jour fermé
  // ...
}
```

- **Stockage :** JSON stringifié en base de données
- **Gestion :** Jours fermés = `null`, jours ouverts = objet start/end

---

## 🔍 Points techniques importants

### Organisation des routes (Ordre important)
1. **Routes statiques** (`/cities`, `/styleTattoo`, `/search`) → En premier
2. **Routes avec authentification** (`/confirmation-setting`) → Avant génériques
3. **Routes génériques** (`/`) → Sans paramètres
4. **Routes complexes** (`/:nameSlug/:locSlug`) → Paramètres multiples
5. **Routes simples** (`/:userId`) → Un seul paramètre, en dernier

### Authentification
- **JwtAuthGuard :** Protège uniquement les paramètres de confirmation
- **RequestWithUser :** Interface pour extraire `userId` du JWT
- **Routes publiques :** Recherche, consultation, modification profil

### Gestion des erreurs
- Try-catch dans les services critiques (`getConfirmationSetting`, `updateConfirmationSetting`)
- Retour uniforme : `{ error: boolean, message: string, data?: any }`
- Validation des formats d'entrée

### Optimisations
- **Transaction Prisma :** Count + Data en une fois pour pagination
- **Pagination sécurisée :** Validation min/max des limites
- **Recherche efficace :** Index sur les champs searchés
- **Select spécifique :** Pas de sur-récupération de données

### Données sensibles
- **Pas exposé :** Mots de passe, tokens, données financières
- **Plan SaaS :** Visible uniquement pour l'utilisateur lui-même
- **Informations publiques :** Tout le reste pour l'affichage client

### Logique métier spécifique
- **Slugs :** Normalisation Unicode + kebab-case pour URLs SEO
- **Styles tatouage :** Gestion de tableaux, déduplication automatique
- **Photos salon :** Limite stricte de 6 images
- **Prestations :** Liste fermée et validation stricte
- **Confirmation RDV :** Impact direct sur le workflow des appointments

### Types de données
- **salonHours :** JSON stringifié avec structure jour → {start, end}
- **salonPhotos :** Array de strings (URLs)
- **prestations :** Array d'énums validés
- **style (tatoueurs) :** Array de strings
