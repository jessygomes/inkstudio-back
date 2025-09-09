# 👤 API Documentation - Module Clients

## Table des matières

1. [🔧 Création de client](#création-de-client)
2. [📖 Consultation de clients](#consultation-de-clients)
3. [🔍 Recherche de clients](#recherche-de-clients)
4. [✏️ Modification de client](#modification-de-client)
5. [🗑️ Suppression de client](#suppression-de-client)
6. [📊 Statistiques clients](#statistiques-clients)
7. [🔐 Système SaaS et limites](#système-saas-et-limites)
8. [🏥 Données médicales et tatouage](#données-médicales-et-tatouage)

---

## 🔧 Création de client

### 1. Créer un client
**Route :** `POST /clients`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Post()
create(@Request() req: RequestWithUser, @Body() clientBody: CreateClientDto) {
  const userId = req.user.userId;
  return this.clientsService.createClient({ clientBody, userId });
}
```

**Service associé :** `createClient()`

**Données client de base :**
```typescript
{
  firstName: string,
  lastName: string,
  email: string,
  phone: string,
  birthDate?: string,    // ISO string, optionnel
  address: string,
  userId: string         // Automatique depuis JWT
}
```

**Données tatouage optionnelles :**
```typescript
{
  description?: string,   // Description du projet
  zone?: string,         // Zone corporelle
  size?: string,         // Taille estimée
  colorStyle?: string,   // Style et couleurs
  reference?: string,    // Images de référence
  sketch?: string,       // Croquis/esquisse
  estimatedPrice?: number // Prix estimé
}
```

**Données médicales optionnelles :**
```typescript
{
  allergies?: string,      // Allergies connues
  healthIssues?: string,   // Problèmes de santé
  medications?: string,    // Médicaments pris
  pregnancy?: boolean,     // Grossesse (défaut: false)
  tattooHistory?: string   // Historique tatouages
}
```

**Logique de création complexe :**

1. **Vérification SaaS :**
```typescript
const canCreateClient = await this.saasService.canPerformAction(userId, 'client');

if (!canCreateClient) {
  const limits = await this.saasService.checkLimits(userId);
  return {
    error: true,
    message: `Limite de fiches clients atteinte (${limits.limits.clients}). Passez au plan PRO ou BUSINESS pour continuer.`,
  };
}
```

2. **Création du client principal :**
```typescript
const newClient = await this.prisma.client.create({
  data: {
    firstName, lastName, email, phone,
    birthDate: birthDate ? new Date(birthDate) : undefined,
    address, userId,
  },
});
```

3. **Création conditionnelle TattooDetail :**
```typescript
const hasTattooData = description || zone || size || colorStyle || reference || sketch || estimatedPrice !== undefined;

if (hasTattooData) {
  const tattooDetail = await this.prisma.tattooDetail.create({
    data: {
      clientId: newClient.id,
      description, zone, size, colorStyle, reference, sketch, estimatedPrice,
    },
  });
  result.tattooDetail = tattooDetail;
}
```

4. **Création conditionnelle MedicalHistory :**
```typescript
const hasMedicalData = allergies || healthIssues || medications || pregnancy !== undefined || tattooHistory;

if (hasMedicalData) {
  const medicalHistory = await this.prisma.medicalHistory.create({
    data: {
      clientId: newClient.id,
      allergies, healthIssues, medications,
      pregnancy: pregnancy ?? false,
      tattooHistory,
    },
  });
  result.medicalHistory = medicalHistory;
}
```

**Réponse de succès :**
```json
{
  "error": false,
  "message": "Client créé avec succès.",
  "client": { /* données client */ },
  "tattooDetail": { /* si données tatouage */ },
  "medicalHistory": { /* si données médicales */ }
}
```

---

## 📖 Consultation de clients

### 2. Voir tous les clients d'un salon
**Route :** `GET /clients/salon`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('salon')
async getClientsBySalon(
  @Request() req: RequestWithUser, 
  @Query('page') page?: string, 
  @Query('limit') limit?: string,  
  @Query('search') search: string = ''
) {
  const userId = req.user.userId;
  const pageNumber = page ? parseInt(page, 10) : 1;
  const limitNumber = limit ? parseInt(limit, 10) : 5;
  return this.clientsService.getClientsBySalon(userId, pageNumber, limitNumber, search);
}
```

**Service associé :** `getClientsBySalon()`

**Fonctionnalités avancées :**

**Recherche multi-champs :**
```typescript
const searchConditions = search ? {
  OR: [
    { firstName: { contains: search, mode: 'insensitive' } },
    { lastName: { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ],
} : {};
```

**Inclusions complètes :**
```typescript
include: {
  appointments: true,           // Historique RDV
  medicalHistory: true,         // Dossier médical
  tattooHistory: true,          // Historique tatouages
  aftercareRecords: true,       // Soins post-tatouage
  FollowUpSubmission: {         // Suivis cicatrisation
    orderBy: { createdAt: 'desc' },
  },
}
```

**Pagination robuste :**
```json
{
  "error": false,
  "clients": [ /* array clients */ ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalClients": 23,
    "limit": 5,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### 3. Voir un client spécifique
**Route :** `GET /clients/:id`  
**Authentification :** Non requise

```typescript
@Get(':id')
getOneClient(@Param('id') id: string) {
  return this.clientsService.getClientById(id);
}
```

**Service associé :** `getClientById()`

**Inclusions détaillées :**
```typescript
include: {
  tattooDetails: true,      // Tous les projets tatouage
  medicalHistory: true,     // Historique médical
  tattooHistory: true,      // Historique des tatouages
  aftercareRecords: true,   // Soins et suivis
}
```

**Usage :** Dossier client complet, consultation pré-RDV

---

## 🔍 Recherche de clients

### 4. Rechercher clients (formulaire réservation)
**Route :** `GET /clients/search`  
**Authentification :** Non requise

```typescript
@Get('search')
async getSearchClient(
  @Query('query') query: string,
  @Query('userId') userId: string
) {
  const clients = await this.clientsService.searchClients(query, userId);
  return clients;
}
```

**Service associé :** `searchClients()`

**Logique de recherche :**
```typescript
const clients = await this.prisma.client.findMany({
  where: {
    AND: [
      { userId },  // Restriction au salon
      {
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
    ],
  },
  take: 10,  // Limite pour performance
});
```

**Réponse si aucun résultat :**
```json
{
  "error": false,
  "message": "Aucun client trouvé.",
  "clients": []
}
```

**Usage :** Auto-complétion formulaire RDV, sélection client existant

---

## ✏️ Modification de client

### 5. Modifier un client
**Route :** `PATCH /clients/update/:id`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Patch('update/:id')
updateClient(@Param('id') id: string, @Body() clientBody: CreateClientDto) {
  return this.clientsService.updateClient(id, clientBody); 
}
```

**Service associé :** `updateClient()`

**Mise à jour des données de base :**
```typescript
const updateData = {
  firstName, lastName, email, phone, address,
};

// Gestion spéciale birthDate
if (birthDate && birthDate.trim() !== '') {
  updateData.birthDate = new Date(birthDate);
}

const updatedClient = await this.prisma.client.update({
  where: { id: clientId },
  data: updateData,
});
```

**Gestion de l'historique médical (upsert) :**
```typescript
const hasMedicalData = allergies || healthIssues || medications || pregnancy !== undefined || tattooHistory;

if (hasMedicalData) {
  const existingMedicalHistory = await this.prisma.medicalHistory.findUnique({
    where: { clientId: updatedClient.id },
  });

  if (existingMedicalHistory) {
    // Mise à jour
    const updatedMedicalHistory = await this.prisma.medicalHistory.update({
      where: { clientId: updatedClient.id },
      data: { allergies, healthIssues, medications, pregnancy: pregnancy ?? false, tattooHistory },
    });
    result.medicalHistory = updatedMedicalHistory;
  } else {
    // Création
    const newMedicalHistory = await this.prisma.medicalHistory.create({
      data: {
        clientId: updatedClient.id,
        allergies, healthIssues, medications, pregnancy: pregnancy ?? false, tattooHistory,
      },
    });
    result.medicalHistory = newMedicalHistory;
  }
}
```

**Logique intelligente :** Upsert automatique pour l'historique médical

---

## 🗑️ Suppression de client

### 6. Supprimer un client
**Route :** `DELETE /clients/delete/:id`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Delete('delete/:id')
deleteClient(@Param('id') id: string) {
  return this.clientsService.deleteClient(id);
}
```

**Service associé :** `deleteClient()`

**Transaction complexe de suppression :**
```typescript
await this.prisma.$transaction(async (prisma) => {
  // 1. Supprimer l'historique médical
  await prisma.medicalHistory.deleteMany({
    where: { clientId },
  });

  // 2. Supprimer l'historique des tatouages
  await prisma.tattooHistory.deleteMany({
    where: { clientId },
  });

  // 3. Supprimer les enregistrements de suivi (aftercare)
  await prisma.aftercare.deleteMany({
    where: { clientId },
  });

  // 4. Supprimer les soumissions de suivi
  await prisma.followUpSubmission.deleteMany({
    where: { clientId },
  });

  // 5. DÉTACHER des rendez-vous (pas supprimer les RDV)
  await prisma.appointment.updateMany({
    where: { clientId },
    data: { clientId: null },
  });

  // 6. Supprimer les détails de tatouage
  await prisma.tattooDetail.deleteMany({
    where: { clientId },
  });

  // 7. Enfin, supprimer le client
  await prisma.client.delete({
    where: { id: clientId },
  });
});
```

**Logique importante :**
- **Préservation des RDV :** Les appointments deviennent orphelins mais sont conservés
- **Suppression cascade :** Toutes les données personnelles effacées
- **Transaction atomique :** Tout ou rien pour cohérence

---

## 📊 Statistiques clients

### 7. Nouveaux clients par mois
**Route :** `GET /clients/new-clients-count/:id`  
**Authentification :** Non requise

```typescript
@Get('new-clients-count/:id')
async getNewClientsCountByMonth(
  @Param('id') id: string,
  @Query('month') month: number,
  @Query('year') year: number
) {
  return this.clientsService.getNewClientsCountByMonth(id, month, year);
}
```

**Service associé :** `getNewClientsCountByMonth()`

**Calcul de période :**
```typescript
const startDate = new Date(year, month - 1, 1);      // 1er du mois
const endDate = new Date(year, month, 0);            // Dernier jour du mois

const newClientsCount = await this.prisma.client.count({
  where: {
    userId,
    createdAt: {
      gte: startDate,
      lte: endDate,
    },
  },
});
```

**Réponse :**
```json
{
  "error": false,
  "month": 9,
  "year": 2025,
  "newClientsCount": 12
}
```

**Usage :** Métriques dashboard, évolution clientèle

---

## 🔐 Système SaaS et limites

### Vérification des limites

**Service intégré :** `SaasService`

**Méthode :** `canPerformAction(userId, 'client')`

**Plans et limites typiques :**
- **FREE :** 10-20 clients max
- **PRO :** 100-500 clients max  
- **BUSINESS :** Illimité

**Processus de vérification :**
1. Appel `saasService.canPerformAction(userId, 'client')`
2. Si `false` → Récupère les limites avec `checkLimits(userId)`
3. Retourne message d'erreur avec limite actuelle
4. Propose upgrade de plan

**Message d'erreur type :**
```
"Limite de fiches clients atteinte (20). Passez au plan PRO ou BUSINESS pour continuer."
```

### Actions concernées par les limites

**✅ Soumis aux limites :**
- Création de nouveau client

**❌ Non soumis aux limites :**
- Consultation (toutes routes GET)
- Modification d'existant
- Suppression
- Recherche

---

## 🏥 Données médicales et tatouage

### Structure TattooDetail

**Champs disponibles :**
```typescript
{
  id: string,
  clientId: string,
  description?: string,    // Description du projet
  zone?: string,          // Zone corporelle (bras, dos, etc.)
  size?: string,          // Taille estimée (5cm, grande pièce, etc.)
  colorStyle?: string,    // Style et couleurs (noir, couleur, réalisme, etc.)
  reference?: string,     // URLs d'images de référence
  sketch?: string,        // URL du croquis/esquisse
  estimatedPrice?: number, // Prix estimé en euros
  price?: number,         // Prix final (depuis appointments)
  createdAt: Date,
  updatedAt: Date,
}
```

**Usage :** Projets tatouage, devis, planification

### Structure MedicalHistory

**Champs disponibles :**
```typescript
{
  id: string,
  clientId: string,       // Lien unique vers client
  allergies?: string,     // Allergies connues (médicaments, matériaux)
  healthIssues?: string,  // Problèmes de santé pertinents
  medications?: string,   // Médicaments actuels
  pregnancy: boolean,     // État grossesse (défaut: false)
  tattooHistory?: string, // Historique tatouages existants
  createdAt: Date,
  updatedAt: Date,
}
```

**Usage :** Contre-indications, précautions médicales, consentement éclairé

---

## 🔍 Points techniques importants

### Organisation des routes

**Ordre critique :**
1. `POST /` - Création (sécurisée)
2. `GET /salon` - Liste salon (sécurisée, spécifique)
3. `GET /new-clients-count/:id` - Stats (publique, spécifique)
4. `GET /search` - Recherche (publique, spécifique)
5. `GET /:id` - Individuel (publique, générique)
6. `PATCH /update/:id` - Modification (sécurisée)
7. `DELETE /delete/:id` - Suppression (sécurisée)

**Rationale :** Routes spécifiques avant génériques pour éviter conflits NestJS

### Authentification

**Routes sécurisées :**
- Création, modification, suppression
- Liste clients salon (données sensibles)
- Utilise `JwtAuthGuard` + `RequestWithUser`

**Routes publiques :**
- Consultation individuelle (ID direct)
- Recherche (avec userId requis)
- Statistiques (par salon)

### Gestion des erreurs

**Format uniforme :**
```typescript
{
  error: boolean,
  message: string,
  data?: any
}
```

**Cas spéciaux :**
- Aucun client trouvé → `error: false` mais `clients: []`
- Client introuvable → `error: true`
- Suppression en cascade → Logs détaillés

### Relations avec autres modules

**Appointments :**
- `clientId` lie les RDV aux clients
- Détachement lors suppression (pas cascade)

**TattooDetail :**
- Projets tatouage par client
- Prix estimé vs final

**MedicalHistory :**
- Dossier médical unique par client
- Upsert automatique lors modifications

**FollowUpSubmission :**
- Suivis post-tatouage
- Suppression cascade lors suppression client

**Aftercare :**
- Soins et recommandations
- Suppression cascade lors suppression client

### Logique métier spécifique

**Création modulaire :**
- Client toujours créé
- TattooDetail si données projet
- MedicalHistory si données médicales

**Modification intelligente :**
- Upsert pour MedicalHistory
- Conservation données existantes si non modifiées

**Suppression sécurisée :**
- Transaction atomique
- Préservation historique RDV
- Nettoyage complet données personnelles

### Optimisations

**Pagination efficace :**
- Count + Data en requêtes séparées (pas transaction ici)
- Limitation recherche (take: 10)
- Index sur userId, email, noms

**Recherche performante :**
- Mode insensitive pour UX
- Multi-champs avec OR
- Limitation résultats

**Inclusions ciblées :**
- Relations complètes pour dossier client
- Sélections basiques pour listes
- Tri par date création décroissante

### Cas d'usage principaux

1. **Gestion dossiers :** CRUD complet clients salon
2. **Booking rapide :** Recherche/sélection client existant  
3. **Suivi médical :** Contraindications et précautions
4. **Projets tatouage :** Devis et planification
5. **Analytics :** Évolution clientèle et statistiques
6. **Conformité :** Données médicales et consentements
