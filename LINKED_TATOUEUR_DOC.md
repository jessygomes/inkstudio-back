# LINKED_TATOUEUR_DOC

## Objectif
Documenter le flux complet de liaison entre un salon (`user_salon`) et un tatoueur utilisateur (`user_tatoueur`) : recherche, envoi de demande, acceptation/refus, permissions, délier, et impacts sur la prise de RDV.

---

## Vue d'ensemble du flux

1. Le salon recherche des tatoueurs inscrits.
2. Le salon envoie une demande d'integration.
3. Le tatoueur consulte ses demandes recues.
4. Le tatoueur accepte ou refuse.
5. Si accepte : le tatoueur est lie au salon + permissions enregistrees.
6. Le salon et/ou le tatoueur peuvent ensuite ajuster certaines permissions.
7. La liaison impacte les regles de creation et de visibilite des RDV.
8. La liaison peut etre retiree par le salon ou quittee par le tatoueur.

---

## Fichiers principaux

### API (Controller)
- `src/tatoueurs/tatoueurs.controller.ts`

### Logique metier (Service)
- `src/tatoueurs/tatoueurs.service.ts`

### Modele BDD (Prisma)
- `prisma/schema.prisma` (model `SalonTatoueurTeamRequest`)
- Relations User : `sentTeamRequests`, `receivedTeamRequests`

### DTOs utilises
- `src/tatoueurs/dto/create-team-request.dto.ts`
- `src/tatoueurs/dto/respond-team-request.dto.ts`
- `src/tatoueurs/dto/update-linked-tatoueur-appointment-booking.dto.ts`
- `src/tatoueurs/dto/update-salon-linked-permission.dto.ts`

### Impacts RDV
- `src/appointments/appointments.service.ts`
- `src/appointments/appointments.controller.ts`

---

## Endpoints du flux equipe tatoueur

### Recherche et demande
- `GET /tatoueurs/team-requests/search`
  - Recherche de `user_tatoueur` invitables.
- `POST /tatoueurs/team-requests`
  - Creation d'une demande `PENDING` de salon vers tatoueur.

### Suivi des demandes
- `GET /tatoueurs/team-requests/outgoing`
  - Liste des demandes envoyees par le salon.
- `GET /tatoueurs/team-requests/incoming`
  - Liste des demandes recues par le tatoueur.

### Reponse a la demande
- `PATCH /tatoueurs/team-requests/:requestId/respond`
  - `action = accept | refuse`.
  - Si `accept`, les permissions sont requises.

### Salons lies et deliaison
- `GET /tatoueurs/team-requests/linked-salons`
  - Salons lies au tatoueur (actuel + historiques acceptes selon logique service).
- `DELETE /tatoueurs/team-requests/linked/:tatoueurUserId`
  - Le salon retire un tatoueur lie.
- `DELETE /tatoueurs/team-requests/linked/me/leave`
  - Le tatoueur quitte son salon actuel.

### Permissions apres liaison
- `PATCH /tatoueurs/team-requests/linked/:tatoueurUserId/appointment-booking`
  - Cote salon : active/desactive la prise de RDV pour ce tatoueur lie.
- `PATCH /tatoueurs/team-requests/permissions/agenda-access`
  - Cote tatoueur : autorise/refuse l'acces agenda au salon.
- `PATCH /tatoueurs/team-requests/permissions/salon-appointment-creation`
  - Cote tatoueur : autorise/refuse la creation de RDV par le salon.
- `GET /tatoueurs/team-requests/permissions/current`
  - Permissions actuelles du tatoueur lie.

---

## Regles metier importantes

## 1) Creation d'une demande
Verifications principales (service) :
- L'appelant doit etre un salon autorise.
- La cible doit etre un utilisateur `user_tatoueur` valide.
- Le tatoueur ne doit pas deja etre lie au meme salon.
- Pas de doublon de demande `PENDING` pour le meme couple salon/tatoueur.

Resultat : creation d'un enregistrement `SalonTatoueurTeamRequest` en `PENDING`.

## 2) Acceptation / refus
Dans `respondToTeamRequest` :
- Seul le tatoueur concerne peut repondre.
- La demande doit etre `PENDING`.
- En cas de `accept`, les permissions doivent etre explicitement fournies.
- Le statut passe a `ACCEPTED` ou `REFUSED`.
- Si `ACCEPTED` : liaison effective du tatoueur au salon (`User.salonId`) + stockage des flags de permissions.

## 3) Deliaison
- Deliaison par salon ou sortie volontaire du tatoueur.
- Mise a jour des champs de liaison et invalidation de caches associes.

---

## Impact sur la logique RDV

Le module RDV utilise ces informations pour controler :
- Qui peut voir/gerer quels RDV (salon, tatoueur lie, performer).
- Si un salon peut creer un RDV pour un tatoueur lie (`allowSalonCreateAppointments`).
- Le routage client en cas de tatoueur lie non reservable via salon (`LINKED_BOOKING_REDIRECT`).

Concretement, la resolution `linked` passe notamment par :
- `performerUserId`
- `salonId`
- Flags de permissions stockes sur le user tatoueur lie.

---

## Etats et transitions de demande

- `PENDING` -> `ACCEPTED`
- `PENDING` -> `REFUSED`

Une demande non `PENDING` ne doit plus etre modifiable.

---

## Checklist de verification rapide

- Le salon peut chercher et inviter un `user_tatoueur`.
- Le tatoueur voit la demande en incoming.
- Le tatoueur peut accepter/refuser.
- Si accepte : lien effectif, permissions en place, visible cote linked salons.
- Les regles RDV reflectent bien les permissions.
- Deliaison salon et sortie tatoueur fonctionnent et invalident les caches.

---

## Notes

- Les gardes JWT sont appliques sur les routes de gestion d'equipe.
- Les checks d'appartenance et de role sont principalement faits dans `tatoueurs.service.ts`.
- Pour debug fonctionnel, suivre d'abord :
  1. `createTeamRequest`
  2. `respondToTeamRequest`
  3. endpoints de permissions
  4. comportement dans `appointments.service.ts`
