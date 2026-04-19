# 📅 API Documentation - Module Appointments

## Table des matières
1. [🔧 Création de rendez-vous](#création-de-rendez-vous)
2. [📖 Consultation de rendez-vous](#consultation-de-rendez-vous)
3. [✏️ Modification de rendez-vous](#modification-de-rendez-vous)
4. [🗑️ Suppression de rendez-vous](#suppression-de-rendez-vous)
5. [✅ Gestion des statuts](#gestion-des-statuts)
6. [📊 Statistiques et analytics](#statistiques-et-analytics)
7. [🔄 Reprogrammation](#reprogrammation)
8. [📝 Demandes de rendez-vous](#demandes-de-rendez-vous)

---

## 🔧 Création de rendez-vous

### Champ `skin`

Le champ `skin` représente la teinte de peau du client.

- Il est requis pour les prestations `TATTOO`, `RETOUCHE` et `PROJET`
- Il est optionnel pour les autres prestations
- Valeurs autorisées : `tres_claire`, `claire`, `claire_moyenne`, `mate`, `foncee`, `tres_foncee`

Exemple de payload :

```json
{
  "title": "Tatouage floral",
  "prestation": "TATTOO",
  "start": "2026-04-20T09:00:00.000Z",
  "end": "2026-04-20T11:00:00.000Z",
  "clientFirstname": "Lea",
  "clientLastname": "Martin",
  "clientEmail": "lea@example.com",
  "clientPhone": "0601020304",
  "clientBirthdate": "1996-08-12",
  "tatoueurId": "tatoueur-123",
  "skin": "claire_moyenne",
  "zone": "avant-bras",
  "size": "medium",
  "colorStyle": "couleur"
}
```

### 1. Créer un RDV (Salon authentifié)
**Route :** `POST /appointments`  
**Authentification :** Requise (JwtAuthGuard)  
**Limite SaaS :** Commentée (SaasLimit)

```typescript
@UseGuards(JwtAuthGuard)
@Post()
async create(@Request() req: RequestWithUser, @Body() rdvBody: CreateAppointmentDto) {
  const userId = req.user.userId;
  return await this.appointmentsService.create({userId, rdvBody });
}
```

**Service associé :** `create()`
- Vérifie les limites SaaS pour les rendez-vous
- Valide l'existence du tatoueur
- Vérifie les conflits de créneaux horaires
- Valide la teinte de peau pour les prestations tattoo, retouche et projet
- Crée ou récupère le client
- Crée le rendez-vous avec statut "CONFIRMED"
- Envoie un email de confirmation au client

### 2. Créer un RDV par un client (Sans authentification)
**Route :** `POST /appointments/by-client`  
**Authentification :** Non requise

```typescript
@Post('by-client')
async createByClient(@Body() rdvBody: CreateAppointmentDto) {
  const userId = rdvBody.userId;
  return await this.appointmentsService.createByClient({userId, rdvBody });
}
```

**Service associé :** `createByClient()`
- Vérifie les limites SaaS
- Valide l'existence du tatoueur
- Vérifie les conflits de créneaux
- Valide la teinte de peau pour les prestations tattoo, retouche et projet
- Crée ou récupère le client
- **Logique conditionnelle :** Vérifie `addConfirmationEnabled` du salon
  - Si `true` : Statut "PENDING" + Email au salon
  - Si `false` : Statut "CONFIRMED" + Email au client
- Envoie l'email approprié selon le paramétrage

### 3. Demande de RDV client
**Route :** `POST /appointments/appointment-request`  
**Authentification :** Non requise

```typescript
@Post('appointment-request')
async createAppointmentRequest(@Body() dto: CreateAppointmentRequestDto) {
  return await this.appointmentsService.createAppointmentRequest(dto);
}
```

**Service associé :** `createAppointmentRequest()`
- Crée une demande de rendez-vous (différent d'un RDV direct)
- Statut initial : "PENDING"
- Le salon doit proposer des créneaux

### 4. Récupérer les teintes de peau disponibles
**Route :** `GET /appointments/skin-tones`  
**Authentification :** Non requise

**Réponse :**

```json
[
  {
    "value": "tres_claire",
    "label": "Tres claire",
    "previewHex": "#F6E1D3"
  },
  {
    "value": "claire",
    "label": "Claire",
    "previewHex": "#EAC8AF"
  },
  {
    "value": "claire_moyenne",
    "label": "Claire moyenne",
    "previewHex": "#D7A889"
  },
  {
    "value": "mate",
    "label": "Mate",
    "previewHex": "#B8815E"
  },
  {
    "value": "foncee",
    "label": "Foncee",
    "previewHex": "#8C5A3C"
  },
  {
    "value": "tres_foncee",
    "label": "Tres foncee",
    "previewHex": "#5F3B28"
  }
]
```

---

## 📖 Consultation de rendez-vous

### 4. Voir tous les RDV
**Route :** `GET /appointments`  
**Authentification :** Non requise

```typescript
@Get()
async getAllAppointments(@Param('id') userId: string) {
  return await this.appointmentsService.getAllAppointments(userId);
}
```

**Service associé :** `getAllAppointments()`
- Récupère tous les RDV d'un salon
- Inclut : tattooDetail, tatoueur (id, nom)

### 5. RDV par plage de dates avec pagination
**Route :** `GET /appointments/range`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('range')
async getByDateRange(
  @Request() req: RequestWithUser,
  @Query('start') start: string,
  @Query('end') end: string,
  @Query('page') page?: string,
  @Query('limit') limit?: string
) {
  const userId = req.user.userId;
  const pageNumber = page ? parseInt(page, 10) : 1;
  const limitNumber = limit ? parseInt(limit, 10) : 5;
  return this.appointmentsService.getAppointmentsByDateRange(userId, start, end, pageNumber, limitNumber);
}
```

**Service associé :** `getAppointmentsByDateRange()`
- Filtre par dates avec pagination
- Inclut : client, tattooDetail, tatoueur
- Retourne aussi le champ `skin` lorsque présent
- Tri : Par date décroissante
- Retourne : appointments + métadonnées de pagination

### 6. RDV d'un salon avec pagination
**Route :** `GET /appointments/salon/:id`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('salon/:id')
async getAllAppointmentsBySalon(
  @Param('id') salonId: string,
  @Query('page') page?: string,
  @Query('limit') limit?: string
) {
  const pageNumber = page ? parseInt(page, 10) : 1;
  const limitNumber = limit ? parseInt(limit, 10) : 5;
  return await this.appointmentsService.getAllAppointmentsBySalon(salonId, pageNumber, limitNumber);
}
```

**Service associé :** `getAllAppointmentsBySalon()`
- Pagination complète des RDV d'un salon
- Inclut : tatoueur, tattooDetail, client
- Retourne aussi le champ `skin` lorsque présent
- Tri : Par date décroissante

### 7. RDV du jour pour dashboard
**Route :** `GET /appointments/today`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('today')
async getTodaysAppointments(
  @Request() req: RequestWithUser,
  @Query('date') targetDate?: string
) {
  const userId = req.user.userId;
  return await this.appointmentsService.getTodaysAppointments(userId, targetDate);
}
```

**Service associé :** `getTodaysAppointments()`
- RDV d'une date spécifique (par défaut : aujourd'hui)
- Retourne aussi le champ `skin` lorsque présent
- Optimisé pour l'affichage dashboard

### 8. RDV d'un tatoueur par plage de dates
**Route :** `GET /appointments/tatoueur-range`  
**Authentification :** Non requise

```typescript
@Get('tatoueur-range')
async getAppointmentsByTatoueurRange(
  @Query('tatoueurId') tatoueurId: string,
  @Query('start') start: string,
  @Query('end') end: string,
) {
  return this.appointmentsService.getAppointmentsByTatoueurRange(tatoueurId, start, end);
}
```

**Service associé :** `getAppointmentsByTatoueurRange()`
- Filtre par tatoueur et dates
- Retourne uniquement : start, end (pour planning)

### 9. Voir un seul RDV
**Route :** `GET /appointments/:id`  
**Authentification :** Non requise

```typescript
@Get(':id')
async getOneAppointment(@Param('id') appointmentId: string) {
  return await this.appointmentsService.getOneAppointment(appointmentId);
}
```

**Service associé :** `getOneAppointment()`
- Détails complets d'un RDV
- Inclut : tatoueur, tattooDetail, `skin`

### 10. RDV d'un tatoueur
**Route :** `GET /appointments/tatoueur/:id`  
**Authentification :** Non requise

```typescript
@Get('tatoueur/:id')
async getAppointmentsByTatoueurId(@Param('id') tatoueurId: string) {
  return await this.appointmentsService.getTatoueurAppointments(tatoueurId);
}
```

**Service associé :** `getTatoueurAppointments()`
- Tous les RDV d'un tatoueur spécifique

---

## ✏️ Modification de rendez-vous

### 11. Modifier un RDV
**Route :** `PATCH /appointments/update/:id`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Patch('update/:id')
async updateAppointment(@Param('id') appointmentId: string, @Body() rdvBody: UpdateAppointmentDto) {
  console.log('Updating appointment with ID:', appointmentId, 'and body:', rdvBody);
  return await this.appointmentsService.updateAppointment(appointmentId, rdvBody);
}
```

**Service associé :** `updateAppointment()`
- Met à jour les informations du RDV
- Permet de modifier le champ `skin`
- Revalide `skin` pour les prestations tattoo, retouche et projet
- Gère les détails du tatouage (upsert)
- **Logique importante :** Utilise `upsert` pour tattooDetail avec `clientId`
- Envoie un email si les horaires changent
- Inclus : description, zone, size, colorStyle, reference, sketch, estimatedPrice, price

---

## 🗑️ Suppression de rendez-vous

### 12. Supprimer un RDV
**Route :** `DELETE /appointments/delete/:id`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Delete('delete/:id')
async deleteAppointment(@Param('id') appointmentId: string) {
  return await this.appointmentsService.deleteAppointment(appointmentId);
}
```

**Service associé :** `deleteAppointment()`
- Suppression définitive du RDV
- Suppression en cascade des détails associés

---

## ✅ Gestion des statuts

### 13. Confirmer un RDV
**Route :** `PATCH /appointments/confirm/:id`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Patch('confirm/:id')
async confirmAppointment(@Param('id') appointmentId: string, @Body() message: { message: string }) {
  return await this.appointmentsService.confirmAppointment(appointmentId, message.message);
}
```

**Service associé :** `confirmAppointment()`
- Change le statut vers "CONFIRMED"
- **Logique de suivi :** Si prestation = TATTOO/RETOUCHE/PIERCING → planifie un suivi automatique
- Envoie email de confirmation au client

### 14. Annuler un RDV
**Route :** `PATCH /appointments/cancel/:id`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Patch('cancel/:id')
async cancelAppointment(@Param('id') appointmentId: string, @Body() message: { message: string }) {
  return await this.appointmentsService.cancelAppointment(appointmentId, message.message);
}
```

**Service associé :** `cancelAppointment()`
- Change le statut vers "CANCELED"
- Envoie email d'annulation avec motif

### 15. Marquer comme payé
**Route :** `PATCH /appointments/payed/:id`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Patch('payed/:id')
async markAppointmentAsPaid(@Param('id') appointmentId: string, @Body() body: { isPayed: boolean }) {
  return await this.appointmentsService.markAppointmentAsPaid(appointmentId, body.isPayed);
}
```

**Service associé :** `markAppointmentAsPaid()`
- Met à jour le champ `isPayed`
- Utilisé pour le suivi financier

---

## 📊 Statistiques et analytics

### 16. RDV en attente de confirmation
**Route :** `GET /appointments/pending-confirmation`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('pending-confirmation')
async getPendingConfirmationAppointments(@Request() req: RequestWithUser) {
  const userId = req.user.userId;
  return await this.appointmentsService.getPendingAppointments(userId);
}
```

**Service associé :** `getPendingAppointments()`
- RDV avec statut "PENDING"
- Utilisé pour notifications et dashboard

### 17. Taux de remplissage hebdomadaire
**Route :** `GET /appointments/weekly-fill-rate`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('weekly-fill-rate')
async getWeeklyFillRate(
  @Request() req: RequestWithUser,
  @Query('start') start: string,
  @Query('end') end: string
) {
  const userId = req.user.userId;
  return await this.appointmentsService.getWeeklyFillRate(userId, start, end);
}
```

**Service associé :** `getWeeklyFillRate()`
- Calcule le taux d'occupation des créneaux
- **Formule :** (RDV réservés / Créneaux totaux) × 100
- Créneaux totaux = jours × 8 créneaux/jour (10h-18h)

### 18. Taux d'annulation global
**Route :** `GET /appointments/cancellation-rate`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('cancellation-rate')
async getGlobalCancellationRate(@Request() req: RequestWithUser) {
  const userId = req.user.userId;
  return await this.appointmentsService.getGlobalCancellationRate(userId);
}
```

**Service associé :** `getGlobalCancellationRate()`
- Pourcentage de RDV annulés vs total
- Métrique de performance salon

### 19. Total RDV payés par mois
**Route :** `GET /appointments/monthly-paid-appointments`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('monthly-paid-appointments')
async getMonthlyPaidAppointments(
  @Request() req: RequestWithUser,
  @Query('month') month: number,
  @Query('year') year: number
) {
  const userId = req.user.userId;
  return await this.appointmentsService.getTotalPaidAppointmentsByMonth(userId, month, year);
}
```

**Service associé :** `getTotalPaidAppointmentsByMonth()`
- Somme des prix des RDV payés sur un mois
- Récupère les prix depuis `tattooDetail.price`
- Indicateur de chiffre d'affaires

---

## 🔄 Reprogrammation

### 20. Proposer une reprogrammation
**Route :** `POST /appointments/propose-reschedule`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Post('propose-reschedule')
async proposeReschedule(
  @Request() req: RequestWithUser,
  @Body() proposeData: ProposeRescheduleDto
) {
  console.log('Proposing reschedule with data:', proposeData); 
  const userId = req.user.userId;
  return await this.appointmentsService.proposeReschedule(proposeData, userId);
}
```

**Service associé :** `proposeReschedule()`
- Génère un token sécurisé unique
- Crée un enregistrement de reprogrammation
- Envoie email au client avec lien sécurisé

### 21. Valider token de reprogrammation
**Route :** `GET /appointments/validate-reschedule-token/:token`  
**Authentification :** Non requise

```typescript
@Get('validate-reschedule-token/:token')
async validateRescheduleToken(@Param('token') token: string) {
  return await this.appointmentsService.validateRescheduleToken(token);
}
```

**Service associé :** `validateRescheduleToken()`
- Vérifie la validité du token
- Retourne les infos du RDV si valide
- Utilisé pour afficher la page client

### 22. Réponse client reprogrammation
**Route :** `POST /appointments/client-reschedule-response`  
**Authentification :** Non requise

```typescript
@Post('client-reschedule-response')
async handleClientRescheduleRequest(@Body() rescheduleData: ClientRescheduleRequestDto) {
  return await this.appointmentsService.handleClientRescheduleRequest(rescheduleData);
}
```

**Service associé :** `handleClientRescheduleRequest()`
- Traite la réponse du client
- Client peut proposer nouveaux créneaux ou refuser
- Met à jour le statut de reprogrammation

---

## 📝 Demandes de rendez-vous

### 23. Voir demandes de RDV salon
**Route :** `GET /appointments/appointment-requests`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('appointment-requests')
async getAppointmentRequests(
@Request() req: RequestWithUser,
@Query('page') page?: string,
@Query('limit') limit?: string,
@Query('status') status?: string,
) {
  const userId = req.user.userId;
  return await this.appointmentsService.getAppointmentRequestsBySalon( userId, Number(page) || 1, Number(limit) || 10, status);
}
```

**Service associé :** `getAppointmentRequestsBySalon()`
- Pagination + filtre par statut
- Tous les statuts : PENDING, CONFIRMED, DECLINED, CLOSED

### 24. Demandes non confirmées
**Route :** `GET /appointments/appointment-requests/not-confirmed`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Get('appointment-requests/not-confirmed')
async getPendingAppointmentRequests(@Request() req: RequestWithUser) {
  const userId = req.user.userId;
  return await this.appointmentsService.getAppointmentRequestsBySalonNotConfirmed(userId);
}
```

**Service associé :** `getAppointmentRequestsBySalonNotConfirmed()`
- Exclut les statuts CONFIRMED et CLOSED
- Pour notifications en temps réel

### 25. Compter demandes en attente
**Route :** `GET /appointments/appointment-requests/not-confirmed/count/:userId`  
**Authentification :** Non requise

```typescript
@Get('appointment-requests/not-confirmed/count/:userId')
async getPendingAppointmentRequestsCount(@Param('userId') userId: string) {
  return await this.appointmentsService.getPendingAppointmentRequestsCount(userId);
}
```

**Service associé :** `getPendingAppointmentRequestsCount()`
- Nombre de demandes en attente
- Badge de notification

### 26. Proposer créneaux pour demande
**Route :** `POST /appointments/appointment-request/propose-slot/:requestId`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Post('appointment-request/propose-slot/:requestId')
async proposeSlotForAppointmentRequest(
  @Param('requestId') requestId: string,
  @Body() body: { slots: Array<{ from: Date; to: Date; tatoueurId?: string }>, message?: string }
) {
  const { slots, message } = body;
  if (!slots || slots.length === 0) {
    throw new Error('At least one slot is required.');
  }

  const normalized = slots.map(s => ({
    from: new Date(s.from),
    to: new Date(s.to),
    tatoueurId: s.tatoueurId,
  }));

  return await this.appointmentsService.proposeSlotForAppointmentRequest(
    requestId,
    normalized,
    message,
  );
}
```

**Service associé :** `proposeSlotForAppointmentRequest()`
- Propose plusieurs créneaux au client
- Normalise les dates reçues
- Génère token pour réponse client

### 27. Valider token demande RDV
**Route :** `GET /appointments/validate-appointment-request-token/:token`  
**Authentification :** Non requise

```typescript
@Get('validate-appointment-request-token/:token')
async validateAppointmentRequestToken(@Param('token') token: string) {
  return await this.appointmentsService.validateAppointmentRequestToken(token);
}
```

**Service associé :** `validateAppointmentRequestToken()`
- Valide token de proposition de créneaux
- Affiche page de sélection client

### 28. Réponse client demande RDV
**Route :** `POST /appointments/appointment-request-response`  
**Authentification :** Non requise

```typescript
@Post('appointment-request-response')
async handleAppointmentRequestResponse(@Body() body: { token: string; action: 'accept' | 'decline'; slotId: string; reason?: string }) {
  const { token, action, slotId, reason } = body;
  return await this.appointmentsService.handleAppointmentRequestResponse(token, action, slotId, reason);
}
```

**Service associé :** `handleAppointmentRequestResponse()`
- Client accepte un créneau ou refuse
- Crée le RDV si accepté
- Met à jour le statut de la demande

### 29. Refuser demande RDV (Salon)
**Route :** `PATCH /appointments/decline-appointment-request`  
**Authentification :** Requise (JwtAuthGuard)

```typescript
@UseGuards(JwtAuthGuard)
@Patch('decline-appointment-request')
async declineAppointmentRequest(@Body() body: { appointmentRequestId: string; reason: string }) {
  const { appointmentRequestId, reason } = body;
  return await this.appointmentsService.declineAppointmentRequest(appointmentRequestId, reason);
}
```

**Service associé :** `declineAppointmentRequest()`
- Salon refuse directement une demande
- Envoie email de refus avec motif

---

## 🔍 Points techniques importants

### Authentification
- **JwtAuthGuard :** Protège les routes salon
- **Routes publiques :** Création par client, validation tokens
- **RequestWithUser :** Interface pour récupérer userId depuis JWT

### Gestion des erreurs
- Try-catch systématique dans tous les services
- Retour uniforme : `{ error: boolean, message: string, data?: any }`

### Emails automatiques
- Confirmation/annulation RDV
- Reprogrammation
- Demandes de créneaux
- Utilise MailService injecté

### Logique SaaS
- Vérification des limites par plan
- SaasService injecté pour contrôles

### Données importantes
- **TattooDetail :** Contient prix, description, zone, etc.
- **Client :** Géré automatiquement (création si inexistant)
- **Statuts RDV :** PENDING, CONFIRMED, CANCELED, DECLINED
- **Prix :** Stocké dans tattooDetail.price

### Configuration conditionnelle
- **addConfirmationEnabled :** Détermine si RDV client nécessite confirmation salon
- **Suivi automatique :** Planifié pour TATTOO/PIERCING/RETOUCHE après confirmation
