# RDV_Doc

## Objectif
Ce document explique le fonctionnement complet des rendez-vous (RDV) dans le backend:
- regles de permissions `user_salon` / `user_tatoueur`
- creation (salon et client)
- modification, confirmation, annulation, statut
- mails envoyes
- ou les RDV s affichent selon le role
- demande de reprogrammation
- demandes de RDV client

## Etat actuel (juillet 2026)
Les fonctionnalites suivantes ont ete retirees du module appointments (routes + logique service + DTO):
- demande de RDV client (`appointment-request` et listings associes)
- reprogrammation de RDV (`propose-reschedule`, `validate-reschedule-token`, `client-reschedule-response`)

Les models Prisma existent encore pour compatibilite avec d autres modules du projet.

---

## 1) Regles de permissions salon <-> tatoueur lie

### Champs utilises
Dans `User`:
- `salonCanViewAppointments` (default `true`)
- `salonCanCreateAppointments` (default `true`)

Source schema: `prisma/schema.prisma`.

### Comment ces permissions sont alimentees
Elles sont definies:
- lors de l acceptation d une demande d equipe (`respondToTeamRequest`)
- puis modifiables par le `user_tatoueur` via:
  - `PATCH /tatoueurs/team-requests/permissions/agenda-access`
  - `PATCH /tatoueurs/team-requests/permissions/salon-appointment-creation`

Sources:
- `src/tatoueurs/tatoueurs.service.ts`
- `src/tatoueurs/tatoueurs.controller.ts`
- `src/tatoueurs/dto/respond-team-request.dto.ts`
- `src/tatoueurs/dto/update-salon-linked-permission.dto.ts`

---

## 2) Reponse a tes 2 questions

### Q1. Un `user_salon` peut creer un RDV pour un `user_tatoueur` lie seulement si `salonCanCreateAppointments = true` ?

### Ce qui fonctionne bien
Oui, pour un tatoueur lie a CE salon:
- la creation passe par `validateSalonCanCreateForSelection(...)`
- si `salonCanCreateAppointments === false`, creation bloquee avec:
  - `code: SALON_BOOKING_NOT_ALLOWED`

Code principal:
- `src/appointments/appointments.service.ts`
  - `resolveTatoueurSelection(...)`
  - `validateSalonCanCreateForSelection(...)`
  - `create(...)`

### Point important (comportement actuel)
Le commentaire metier annonce aussi un blocage si le tatoueur est lie a un AUTRE salon.
Dans le code actuel de `validateSalonCanCreateForSelection(...)`, ce cas n est pas bloque explicitement.

Donc:
- cas "lie au meme salon + permission false": bloque (OK)
- cas "lie au meme salon + permission true": autorise (OK)
- cas "lie a un autre salon": pas bloque explicitement ici (point de vigilance)

---

### Q2. Un `user_salon` peut voir les RDV d un `user_tatoueur` lie seulement si `salonCanViewAppointments = true` ?

Oui, cette logique est bien en place:
- `buildAppointmentVisibilityWhere(userId)` recupere les `linkedTatoueurs` du salon avec filtre strict:
  - `role = user_tatoueur`
  - `salonCanViewAppointments = true`
- ensuite les requetes RDV salon utilisent ce scope.

Endpoints/metiers impactes (via `buildScopedAppointmentWhere` / `buildAppointmentVisibilityWhere`):
- `getAllAppointmentsBySalon(...)`
- `getAppointmentsByDateRange(...)`
- `getAppointmentsBySalonRange(...)`
- `getTodaysAppointments(...)`
- `getPendingAppointments(...)`
- stats dashboard (fill rate, cancellation, etc.)

Source: `src/appointments/appointments.service.ts`.

---

## 3) Vue d ensemble des flux RDV

## 3.1 Creation RDV par salon (auth)
Endpoint:
- `POST /appointments`

Methode:
- `create({ userId, rdvBody })`

Etapes principales:
1. Validation data (skin tone selon prestation).
2. Resolution tatoueur (interne ou `user_tatoueur` lie) via `resolveTatoueurSelection`.
3. Verification permission creation salon -> tatoueur lie (`validateSalonCanCreateForSelection`).
4. Detection conflit de creneau (`findAppointmentConflict`) selon `agendaMode`.
5. Creation/reutilisation fiche client (`Client`) + lien `clientUserId` si client connecte.
6. Creation RDV (`Appointment`) + details (`TattooDetail`).
7. Envoi email confirmation client (`sendAppointmentConfirmation`).
8. Creation conversation automatique si client connecte.
9. Invalidation cache RDV/dashboard selon actions.

Statut cree ici:
- dans ce flux, creation salon passe en `CONFIRMED`.

---

## 3.2 Creation RDV par client (sans auth)
Endpoint:
- `POST /appointments/by-client`

Methode:
- `createByClient({ userId, rdvBody, clientUserId })`

Regles importantes:
1. Si `tatoueurId` pointe un `user_tatoueur` lie a CE salon, creation refusee avec:
   - `code: LINKED_BOOKING_REDIRECT`
   - message demandant de reserver via le profil tatoueur.
2. Gestion conflit de creneau selon `agendaMode`.
3. Statut depend de `addConfirmationEnabled` du salon:
   - `true` -> RDV `PENDING`
   - `false` -> RDV `CONFIRMED`
4. Mails selon statut:
   - si `PENDING`: mail de notif au salon (`sendPendingAppointmentNotification`)
   - si `CONFIRMED`: mail client (`sendAutoConfirmedAppointment`) + mail salon (`sendNewAppointmentNotification`)
5. Creation conversation automatique si possible.

Test present:
- `src/appointments/appointments.service.spec.ts` contient un test `LINKED_BOOKING_REDIRECT`.

---

## 3.3 Demande de RDV client (workflow request)
Retire du module appointments (juillet 2026).

---

## 3.4 Lecture / affichage des RDV

### Cote salon (auth)
- `GET /appointments/salon/:id`
- `GET /appointments/range`
- `GET /appointments/salon/:id/range`
- `GET /appointments/today`
- `GET /appointments/pending-confirmation`

Toutes ces vues s appuient sur la logique de visibilite et respectent `salonCanViewAppointments` pour les tatoueurs lies.

### Cote client (auth)
- `GET /appointments/rdv-client`
- utilise `clientUserId` pour retourner ses RDV + infos salon/tatoueur/conversation/review.

### Cote tatoueur / agenda public
- `GET /appointments/tatoueur-range`
- `GET /appointments/tatoueur/:id`

Note:
- `GET /appointments/salon/:id/range` sans JWT retourne seulement `start/end` (creneaux occupes publics).

---

## 3.5 Modification RDV

### Par salon
Endpoint:
- `PATCH /appointments/update/:id`

Methode:
- `updateAppointment(id, rdvBody)`

Comportement:
1. Verifie RDV existant.
2. Revalide skin/prestation.
3. Re-resout tatoueur cible.
4. Re-verifie conflits creneau.
5. Met a jour `Appointment` + `TattooDetail`.
6. Si horaire change: mail client `sendAppointmentModification`.
7. Invalide caches.

### Par client
Endpoint:
- `PATCH /appointments/client-update/:id`

Methode:
- `updateAppointmentByClient(appointmentId, userId, rdvBody)`

Comportement:
1. Verifie proprietaire (`clientUserId`).
2. Interdit si RDV deja `COMPLETED` / `NO_SHOW` / `CANCELED`.
3. Re-verifie conflit creneau.
4. Si salon a `addConfirmationEnabled=true`, repasse en `PENDING`.
5. Envoi mail client modification + mail salon notification.
6. Invalidation caches.

---

## 3.6 Confirmation / Annulation / Statut / Paiement

### Confirmation
Endpoint:
- `PATCH /appointments/confirm/:id`

Methode:
- `confirmAppointment(id, message)`

Actions:
- status -> `CONFIRMED`
- conversation auto si `clientUserId` existe
- mail client `sendAppointmentConfirmation`

### Annulation par salon
Endpoint:
- `PATCH /appointments/cancel/:id`

Methode:
- `cancelAppointment(id, message)`

Actions:
- status -> `CANCELED`
- conversation: suppression si <5 messages, sinon archive + message system
- mail client `sendAppointmentCancellation`
- invalidation caches + dashboard

### Annulation par client
Endpoint:
- `PATCH /appointments/client-cancel/:id`

Methode:
- `cancelAppointmentByClient(appointmentId, clientUserId, reason)`

Actions:
- verif proprietaire
- status -> `CANCELED`
- gestion conversation (meme logique)
- mail salon `sendClientCancellationNotification`
- mail client `sendClientCancellationConfirmation`
- invalidation caches + dashboard

### Changement de statut final
Endpoint:
- `PATCH /appointments/change-status/:id`

Methode:
- `changeAppointmentStatus(id, statusData)` avec `COMPLETED` ou `NO_SHOW`

Si `COMPLETED`:
- creation historique tattoo/piercing si applicable
- programmation emails de suivi via `followupSchedulerService`

### Paiement
Endpoint:
- `PATCH /appointments/payed/:id`

Methode:
- `markAppointmentAsPaid(id, isPayed)`

---

## 3.7 Reprogrammation
Retire du module appointments (juillet 2026).

---

## 3.8 Emails de suivi post-RDV
Service dedie:
- `src/appointments/post-appointment-email.service.ts`

Mecanisme:
- envoie auto follow-up 7 jours pour `TATTOO/PIERCING/RETOUCHE` completes
- envoie rappel retouche 30 jours pour `TATTOO` completes
- marque timestamps `followUp7SentAt` / `followUp30SentAt`

---

## 4) Table de reference rapide des principaux endpoints RDV

- `POST /appointments` : creation par salon (auth)
- `POST /appointments/by-client` : creation par client (sans auth)
- `GET /appointments/salon/:id` : liste salon paginee
- `GET /appointments/range` : liste plage date (auth)
- `GET /appointments/salon/:id/range` : plage (public/auth)
- `GET /appointments/today` : agenda jour
- `GET /appointments/rdv-client` : liste client connecte
- `PATCH /appointments/update/:id` : modif salon
- `PATCH /appointments/client-update/:id` : modif client
- `PATCH /appointments/confirm/:id` : confirmation
- `PATCH /appointments/cancel/:id` : annulation salon
- `PATCH /appointments/client-cancel/:id` : annulation client
- `PATCH /appointments/change-status/:id` : COMPLETED / NO_SHOW
- `PATCH /appointments/payed/:id` : statut paiement
- `POST /appointments/send-custom-email/:appointmentId` : email personnalise

---

## 5) Points de vigilance techniques

1. Le blocage creation pour un tatoueur lie a un AUTRE salon n est pas explicitement implemente dans `validateSalonCanCreateForSelection` (malgre le commentaire metier).
2. Les permissions de visibilite (`salonCanViewAppointments`) sont correctement appliquees au scope de lecture salon.
3. Les permissions de creation (`salonCanCreateAppointments`) sont bien appliquees pour le cas principal "tatoueur lie a ce salon".
4. La logique email est riche et depend fortement des statuts (`PENDING`, `CONFIRMED`, `RESCHEDULING`, `CANCELED`, `COMPLETED`).

---

## 6) Fichiers code principaux a consulter

- `src/appointments/appointments.controller.ts`
- `src/appointments/appointments.service.ts`
- `src/appointments/post-appointment-email.service.ts`
- `src/appointments/appointments.service.spec.ts`
- `src/tatoueurs/tatoueurs.controller.ts`
- `src/tatoueurs/tatoueurs.service.ts`
- `prisma/schema.prisma`
