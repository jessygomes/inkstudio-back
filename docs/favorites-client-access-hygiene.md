# Favoris, accès aux informations du client, Explorer et justificatifs d'hygiène des tatoueurs

Migration : `20261125120000_hygiene_favorites_client_access` (additive). À appliquer avec `npx prisma migrate deploy` avant de déployer le code.

## 1. Justificatif d'hygiène d'un tatoueur créé par un salon

Table `TatoueurHygieneDocument` (un document par profil `Tatoueur`, statut `PENDING` / `APPROVED` / `REJECTED`).

| Route | Qui | Effet |
| --- | --- | --- |
| `GET /tatoueur-hygiene` | salon (`user_salon`, `user`, `admin`) | tatoueurs du salon + `document` |
| `GET /tatoueur-hygiene/:tatoueurId` | salon propriétaire | `{ document }` |
| `POST /tatoueur-hygiene/:tatoueurId { fileUrl }` | salon propriétaire | dépose / remplace, repasse en `PENDING` |
| `DELETE /tatoueur-hygiene/:tatoueurId` | salon propriétaire | supprime |
| `GET /admin/tatoueur-hygiene?status=PENDING\|APPROVED\|REJECTED\|ALL&search&page` | admin | à examiner par défaut, `pending` = total à examiner |
| `PATCH /admin/tatoueur-hygiene/:id { status, rejectionReason? }` | admin | motif obligatoire pour un refus ; notification `team.hygiene_reviewed` au salon |

Le fichier (PDF, JPG, PNG) est envoyé avant : UploadThing `salonDocuments` sur le site Studio, `POST /users/:id/images/upload` (images) dans l'app. Un fichier remplacé ou supprimé est effacé s'il ne sert plus. `GET /admin/users/:id` renvoie `Tatoueur[].hygieneDocument`, `GET /admin/stats` renvoie `tatoueurHygienePending`.

## 2. Explorer (moodboards partagés)

- **Propositions suspendues pour tous les abonnements** : `POST /projects/moodboards/:id/proposals` renvoie 403 tant que `EXPLORER_PROPOSALS_ENABLED` n'est pas `true`. `GET /projects/options` renvoie `proposalsEnabled`.
- **Consultation et favoris ouverts à tous les abonnements** (FREE compris) : `POST|DELETE /projects/moodboards/:id/favorite` ; `GET /projects/explore?scope=favorites` (projets encore ouverts ou « tatoueur trouvé »).
- Chaque projet renvoie `clientPseudo` (pseudo People, sinon pseudo du compte ; jamais nom, e-mail ou coordonnées), `isFavorite`, `projectNeeds`.
- **Besoins** (`projectNeeds`, choisis par le client dans `PATCH /projects/moodboards/:id { needs }`) : `URGENT`, `NEED_HELP`, `WANT_DRAWING`, `HAVE_DRAWING`, `FIRST_TATTOO`, `COVER_UP`, `NOT_IN_A_HURRY` (`src/moodboard/project-needs.ts`, libellés dans `GET /projects/options` → `needs`). Filtre `GET /projects/explore?need=URGENT`.

## 3. Favoris de réalisations et de flashs → contact du client

- Favori de flash (nouveau) : `PATCH /work-favorites/flash/:flashId` (bascule), `GET /work-favorites/flash`, `GET /work-favorites/flash/ids`.
- À chaque nouveau favori (réalisation `PATCH /users/favorites/portfolio/:id` ou flash), le propriétaire reçoit `favorite.work_added` : « {pseudo} a mis en favori l'une de vos réalisations / l'un de vos flashs » (une fois par client et par œuvre, rien si le client a bloqué le professionnel).
- `GET /work-favorites/received?page` (professionnel) : favoris reçus, pseudo du client, œuvre, `canContact`, `conversation { id, clientAccess }`.

### Conversation et demande d'accès

`Conversation.clientAccess` : `null` = conversation ordinaire ; `HIDDEN` / `REQUESTED` / `DECLINED` = le professionnel ne voit que `clientAlias` (pseudo) ; `GRANTED` = accès accordé.

| Route | Qui | Effet |
| --- | --- | --- |
| `POST /messaging/client-access/start { clientUserId }` | professionnel | ouvre la conversation en `HIDDEN` (si le client a mis une de ses œuvres en favori et ne l'a pas bloqué ; abonnement actif), ou renvoie la conversation existante sans changer son accès |
| `POST /messaging/client-access/:conversationId/request` | professionnel | message `ACCESS_REQUEST` + notification `client.access_request` ; une demande à la fois, 7 jours d'attente après un refus |
| `POST /messaging/client-access/:conversationId/respond { accept }` | client | oui : `GRANTED`, fiche client créée ou retrouvée (même e-mail) et reliée au compte et au fil ; non : `DECLINED`. Notification `contact.access_reply` au professionnel |

**Réservation par le client** (réservation People connectée ou lien de réservation) : il partage ses informations en réservant, donc ses conversations masquées avec ce professionnel passent en `GRANTED` (message système, fiche reliée au fil ; `src/messaging/client-access/grant-on-booking.ts`). Le professionnel peut donc envoyer un lien de réservation dans une conversation masquée.

**Lien de réservation et fiche existante** : un client connecté (e-mail vérifié) dont une fiche non reliée du salon a le même e-mail, le même prénom et le même nom voit cette fiche reliée à son compte (`claimMatchingClientRecord`, comme la réservation People) au lieu du refus `CLIENT_LINK_REQUIRED`, qui ne reste que pour un e-mail identique avec un autre nom ou sans compte.

Masquage tant que l'accès n'est pas accordé : conversations (`client`), fils d'inbox (`conversation.clientUser`), messages et événements temps réel (expéditeur client), « écrit… », push, e-mails de nouveaux messages, recherche de l'inbox (pseudo seulement). Relier / créer une fiche depuis le fil est refusé. Les conversations ont `clientAccess` et `clientAlias` dans leur réponse.

**Présence** : `user-online` / `user-offline` ne sont plus diffusés à toutes les connexions avec le nom de l'utilisateur ; ils ne partent qu'à ses interlocuteurs (conversations Inkera), avec son seul identifiant. Aucun front n'écoutait ces événements.
