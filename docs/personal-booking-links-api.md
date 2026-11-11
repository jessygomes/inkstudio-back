# Contrat API — Inkera Studio et Inkera People

Ce document décrit le backend implémenté. Les deux applications frontend ne sont pas présentes dans ce dépôt : leurs écrans et leur route Next.js doivent être intégrés dans leurs dépôts respectifs.

## URL destinée au client

Le backend renvoie à la création :

```json
{
  "error": false,
  "bookingUrl": "https://theinkera.com/black-ink-tattoo/rdv/<token>",
  "publicSlug": "black-ink-tattoo",
  "link": { "id": "clink", "status": "ACTIVE" }
}
```

Le véritable objet `link` est décrit plus bas. Studio copie **directement `bookingUrl`**, sans reconstruire l’URL. Aucune URL API ou Studio n’est utilisée comme URL client.

Configuration backend : `INKERA_PEOPLE_BASE_URL=https://theinkera.com` (valeur par défaut). Pour développement/preview, utiliser exclusivement l’origine du frontend **People** correspondant, par exemple `http://localhost:3000`. Pas de chemin, paramètres ou identifiants dans cette variable ; HTTPS obligatoire en production. Ne pas y mettre l’origine Studio ou API.

Le slug est la normalisation existante de `User.salonName` (minuscules, accents supprimés, séparateurs remplacés par `-`). Il n’existe pas de colonne `publicSlug` dans ce dépôt. Un tatoueur indépendant utilise son propre profil public ; un lien dont le salon possède le RDV utilise le profil du salon. L’identité de la réservation repose sur le **token**, jamais sur l’unicité du nom.

Le token aléatoire de 256 bits est renvoyé uniquement dans `bookingUrl` à la création. Seule son empreinte SHA-256 est enregistrée. Les listes/détails professionnels ne peuvent pas restituer l’URL perdue : conserver l’URL reçue dans l’état de l’écran de création ; sinon révoquer puis recréer un lien. Ne pas enregistrer le token dans les logs ou analytics.

## Routes exactes

Pas de préfixe `/api` global dans ce backend (`/api` sert Swagger en développement).

| Méthode | Chemin | Authentification | Réponse normale |
|---|---|---|---|
| POST | `/appointments/booking-links` | JWT professionnel | 201, `{error:false, link, bookingUrl, publicSlug}` |
| GET | `/appointments/booking-links?page=1&limit=20&userId=…` | JWT professionnel | 200, `{data, page, limit, hasMore}` |
| GET | `/appointments/booking-links/:id` | JWT professionnel autorisé | 200, `{link}` |
| PATCH | `/appointments/booking-links/revoke/:id` | JWT professionnel autorisé | 200, `{link}` |
| GET | `/appointments/booking-links/public/:token` | Public | 200, informations publiques |
| GET | `/appointments/booking-links/public/:token/availability?from=2030-01-07&to=2030-01-13` | Public | 200, dates/créneaux disponibles |
| POST | `/appointments/booking-links/public/:token/confirm` | Invité ou JWT **client**, selon le destinataire | 201, confirmation |
| PATCH | `/appointments/desired-tattoo-period/:id` | JWT professionnel autorisé à gérer ce RDV | 200, `{error:false, appointment}` |
| GET | `/appointments/:id` | JWT autorisé sur ce RDV | Réponse existante enrichie des quatre champs de période |

JWT : `Authorization: Bearer <access-token>`. Les credentials fournis doivent être valides ; un JWT invalide ne devient jamais une réservation invitée. Un JWT professionnel ne permet pas de confirmer en tant que client.

## Enums

```ts
type DesiredTattooPeriod = 'ASAP' | 'EXACT_DATE' | 'DATE_RANGE' | 'FLEXIBLE' | 'UNDECIDED';
type BookingLinkMode = 'FIXED_START' | 'AUTOMATIC';
type BookingLinkStatus = 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';
type PrestationType = 'PROJET' | 'TATTOO' | 'RETOUCHE' | 'PIERCING';
type AppointmentStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'CANCELED' | 'RESCHEDULING' | 'NO_SHOW' | 'COMPLETED';
type SkinTone = 'tres_claire' | 'claire' | 'claire_moyenne' | 'mate' | 'foncee' | 'tres_foncee';
```

Les liens acceptent seulement `TATTOO` et `RETOUCHE`. Un lien confirme directement un RDV `CONFIRMED` : le professionnel a déjà autorisé la prestation en émettant le lien. Le parcours ordinaire `/appointments/by-client` garde sa règle existante `PENDING`/`CONFIRMED`.

## Période souhaitée d’un PROJET

Champs optionnels ajoutés à `CreateAppointmentDto`, donc au body de `POST /appointments` et à `rdvBody` dans `POST /appointments/by-client`, ainsi qu’à `UpdateAppointmentDto` pour `PATCH /appointments/update/:id` :

```ts
interface DesiredTattooPeriodInput {
  desiredTattooPeriod?: DesiredTattooPeriod | null;
  desiredTattooDate?: string | null;       // YYYY-MM-DD
  desiredTattooStartDate?: string | null;  // YYYY-MM-DD
  desiredTattooEndDate?: string | null;    // YYYY-MM-DD, borne incluse
}
```

| Choix | Dates à fournir |
|---|---|
| `ASAP` | Aucune |
| `EXACT_DATE` | `desiredTattooDate` uniquement |
| `DATE_RANGE` | `desiredTattooStartDate` et `desiredTattooEndDate`, début ≤ fin |
| `FLEXIBLE` | Aucune |
| `UNDECIDED` | Aucune |
| `null` | Aucune ; efface l’information |

Une préférence fournie remplace toute la préférence précédente. Omettre tous les champs conserve la valeur existante ; les anciens RDV restent à `null`. Les dates civiles invalides et les combinaisons incohérentes sont refusées. Ces dates ne bloquent rien, ne changent pas `start`/`end` et ne créent aucun autre RDV.

Exemple People (ajouter les autres champs requis habituels du parcours) :

```json
{
  "userId": "salon-id",
  "rdvBody": {
    "prestation": "PROJET",
    "start": "2030-01-07T09:00:00.000Z",
    "end": "2030-01-07T10:00:00.000Z",
    "tatoueurId": "tatoueur-interne-id",
    "clientFirstname": "Alice",
    "clientLastname": "Martin",
    "clientEmail": "alice@example.com",
    "skin": "mate",
    "desiredTattooPeriod": "DATE_RANGE",
    "desiredTattooStartDate": "2030-04-01",
    "desiredTattooEndDate": "2030-05-31"
  }
}
```

Modification Studio de la préférence seule, sans renvoyer les horaires ni les détails du tatouage :

```http
PATCH /appointments/desired-tattoo-period/projet-id
Authorization: Bearer <jwt-professionnel>
Content-Type: application/json

{"desiredTattooPeriod":"EXACT_DATE","desiredTattooDate":"2030-04-10"}
```

```json
{
  "error": false,
  "appointment": {
    "id": "projet-id",
    "desiredTattooPeriod": "EXACT_DATE",
    "desiredTattooDate": "2030-04-10T00:00:00.000Z",
    "desiredTattooStartDate": null,
    "desiredTattooEndDate": null
  }
}
```

Les réponses RDV existantes conservent leur enveloppe et reçoivent ces quatre champs, notamment les listes Studio, le détail, le range authentifié et `GET /appointments/rdv-client`. PostgreSQL stocke les dates en `DATE` ; Prisma les sérialise en ISO à minuit UTC. Afficher **la partie `YYYY-MM-DD` sans conversion de fuseau**. Les disponibilités publiques anonymisées restent limitées aux bornes occupées.

Pour une modification complète utiliser le DTO existant de `/appointments/update/:id` avec ses champs habituels. Pour la préférence seule utiliser le nouvel endpoint dédié. Le parcours `/appointments/client-update/:id` reste un déplacement de RDV et ne modifie pas la préférence.

## Créer un lien : DTO

```ts
interface CreateBookingLinkRequest {
  userId?: string;              // propriétaire CRM/agenda ; défaut source ou professionnel connecté
  tatoueurId?: string;          // ID Tatoueur interne OU linked_<User.id> ; inféré depuis le projet si omis
  venueSalonId?: string;        // salon de résidence pour un compte tatoueur rattaché
  prestation: 'TATTOO' | 'RETOUCHE';
  durationMinutes: number;      // entier 1..1440, pas de contrainte de multiple de 30
  mode: 'FIXED_START' | 'AUTOMATIC';
  fixedStartTime?: string;      // HH:mm Europe/Paris, obligatoire uniquement FIXED_START
  allowedFrom: string;          // YYYY-MM-DD, incluse
  allowedTo: string;            // YYYY-MM-DD, incluse, maximum 366 jours de fenêtre
  expiresAt?: string;           // ISO 8601 futur
  clientId?: string;            // fiche CRM du même propriétaire
  projectAppointmentId?: string;
  conversationId?: string;      // conversation Inkera
  inboxThreadId?: string;       // fil Inbox Inkera ou externe
}
```

Exemple autonome à heure fixe :

```json
{
  "tatoueurId": "tatoueur-interne-id",
  "prestation": "TATTOO",
  "durationMinutes": 240,
  "mode": "FIXED_START",
  "fixedStartTime": "10:00",
  "allowedFrom": "2030-01-07",
  "allowedTo": "2030-02-28",
  "expiresAt": "2030-01-20T22:59:59.000Z"
}
```

Depuis un projet :

```json
{
  "projectAppointmentId": "projet-id",
  "prestation": "TATTOO",
  "durationMinutes": 175,
  "mode": "AUTOMATIC",
  "allowedFrom": "2030-01-07",
  "allowedTo": "2030-01-31"
}
```

Depuis une conversation, remplacer `projectAppointmentId` par `conversationId` ou `inboxThreadId`, et fournir `tatoueurId` si le fil n’a pas d’affectation. Depuis un indépendant autonome, `tatoueurId: "linked_<son-id>"` (ou omission pour sélectionner son propre compte). Pour un artiste rattaché, préciser `venueSalonId` ; les permissions de résidence restent obligatoires.

Réponse professionnelle complète :

```ts
interface BookingLinkResponse {
  id: string;
  userId: string;
  createdByUserId: string;
  tatoueurId: string | null;
  performerUserId: string | null;
  venueSalonId: string | null;
  prestation: 'TATTOO' | 'RETOUCHE';
  durationMinutes: number;
  mode: BookingLinkMode;
  fixedStartTime: string | null;
  allowedFrom: string; allowedTo: string; // YYYY-MM-DD
  expiresAt: string | null;              // ISO timestamp
  status: BookingLinkStatus;
  clientId: string | null;
  clientUserId: string | null;
  projectAppointmentId: string | null;
  conversationId: string | null;
  inboxThreadId: string | null;
  appointmentId: string | null;          // résultat après confirmation
  createdAt: string; usedAt: string | null; revokedAt: string | null;
}
```

`GET` liste : `page` commence à 1, `limit` vaut 20 par défaut (maximum 100), `userId` filtre facultativement le propriétaire dans le périmètre autorisé. `data` contient des `BookingLinkResponse`. `hasMore` permet de continuer la pagination ; une page peut contenir moins de `limit` éléments après vérification des droits actuels. Aucune empreinte/token n’est exposé.

## Associations et permissions

- Projet : propriétaire, tatoueur, lieu, fiche et compte client sont hérités. Un tatoueur ou une fiche contradictoire est refusé. Le lien conserve `projectAppointmentId` et, après usage, `appointmentId`.
- Conversation Inkera : compte client fiable via `Conversation.clientUserId`, éventuelle fiche via la liaison existante. `Conversation.appointmentId` n’est pas réaffecté : plusieurs RDV restent associés via `InboxThreadAppointment`.
- Conversation externe : seule `InboxThread.linkedClientId` fournit une association CRM confirmée. Aucune recherche automatique par nom, Instagram ou email du contact. Sans fiche liée, le fil est conservé comme origine du lien, mais aucun lien CRM ni `InboxThreadAppointment` n’est créé automatiquement. La liaison manuelle existante reste nécessaire.
- Autonome : création de fiche selon les règles d’identité People ; un email déclaré par un invité ne permet pas de récupérer une fiche existante. Si une fiche existe mais n’est pas reliée au compte, le backend renvoie `CLIENT_LINK_REQUIRED` ; le professionnel doit confirmer la liaison ou émettre un lien ciblant explicitement cette fiche.
- Lien ciblant un compte : JWT du destinataire obligatoire. Lien ciblant une fiche sans compte lié : compte client avec email **vérifié** correspondant à la fiche obligatoire ; cette vérification ne modifie pas `Client.linkedUserId`.
- Salon : uniquement ses propres tatoueurs internes, ou des comptes rattachés avec les permissions de résidence existantes. Les droits de création, lecture et gestion/révocation sont distincts. Le rattachement à l’équipe seul n’accorde pas les droits.
- Les règles publiques, de plan, de visibilité, de résidence et de calendrier sont vérifiées à nouveau lors de la réservation. Un artiste FREE parrainé ne peut être réservé que dans le contexte Business existant autorisé.

## Informations publiques

```json
{
  "bookingUrl": "https://theinkera.com/black-ink-tattoo/rdv/<token>",
  "publicSlug": "black-ink-tattoo",
  "status": "ACTIVE",
  "prestation": "TATTOO",
  "durationMinutes": 240,
  "mode": "FIXED_START",
  "fixedStartTime": "10:00",
  "timeZone": "Europe/Paris",
  "allowedFrom": "2030-01-07",
  "allowedTo": "2030-02-28",
  "expiresAt": "2030-01-20T22:59:59.000Z",
  "requiresAuthentication": false,
  "professional": { "name": "Black Ink Tattoo", "image": null, "city": "Paris", "address": null, "postalCode": "75001" },
  "artist": { "name": "Alice", "image": null }
}
```

Les valeurs `image`, `city`, `address`, `postalCode`, `fixedStartTime` et `expiresAt` peuvent être `null`. Aucun nom/email client, note privée, motif de blocage, RDV occupé ou identifiant de conversation n’est exposé. Un lien non actif renvoie une erreur, pas ce DTO.

## Disponibilités et confirmation

Demander au maximum **7 dates civiles incluses** par requête. Les dates hors de la fenêtre du lien sont ignorées ; seules les dates comportant des disponibilités sont renvoyées.

```json
{
  "timeZone": "Europe/Paris",
  "dates": [
    { "date": "2030-01-07", "slots": [
      { "start": "2030-01-07T09:00:00.000Z", "end": "2030-01-07T13:00:00.000Z" }
    ] }
  ]
}
```

Les créneaux sont des instants UTC ; afficher en Europe/Paris. En `FIXED_START`, le client choisit seulement la date : envoyer le `start` de son unique créneau. En `AUTOMATIC`, il choisit aussi l’heure ; utiliser exactement le `start` renvoyé. La grille existante commence à l’ouverture et avance de 30 minutes ; la **durée** reste exacte, par exemple 175 minutes. L’heure fixe peut être personnalisée à la minute.

Les indisponibilités/pauses sont les `BlockedTimeSlot` existants. Les RDV `PENDING` et `CONFIRMED` bloquent le calendrier. Les horaires du professionnel, le lieu de résidence, les blocages globaux du salon et la durée complète sont pris en compte. Aucun paramètre de temps tampon n’existe actuellement dans le schéma ; aucun tampon artificiel n’est ajouté. Les heures inexistantes du passage à l’heure d’été sont exclues ; les durées sont mesurées en minutes écoulées.

Confirmer :

```json
{
  "start": "2030-01-07T09:00:00.000Z",
  "rdvBody": {
    "clientFirstname": "Alice",
    "clientLastname": "Martin",
    "clientEmail": "alice@example.com",
    "clientPhone": "0600000000",
    "clientBirthdate": "1995-06-15",
    "skin": "mate"
  }
}
```

`clientPhone` et `clientBirthdate` sont optionnels. Les autres champs sont requis. Avec un JWT client, l’identité du compte authentifié prime sur les coordonnées déclarées. Ne pas envoyer `clientUserId`, `clientId`, durée, type ou `end` : le backend fixe ces paramètres depuis le lien. `start` doit inclure `Z` ou un décalage explicite.

```json
{
  "error": false,
  "appointment": { "id": "nouveau-rdv-id", "prestation": "TATTOO", "start": "2030-01-07T09:00:00.000Z", "end": "2030-01-07T13:00:00.000Z", "status": "CONFIRMED" },
  "status": "USED"
}
```

La vérification finale, la fiche client éventuelle, le RDV, ses détails, les associations fiables et la consommation du lien sont atomiques. Une confirmation concurrente perdante reçoit `BOOKING_LINK_USED` pour le même lien, ou `SLOT_UNAVAILABLE` pour un autre lien visant le créneau gagné. Une génération/consultation ne réserve rien. Annuler ou supprimer ensuite le RDV ne réactive jamais le lien. L’expiration est effective à `expiresAt` ou après le dernier jour autorisé, même sans tâche planifiée.

Les notifications et emails existants sont déclenchés après commit. Une panne de livraison ne transforme pas une réservation enregistrée en échec. Après une perte de réponse réseau, ne pas supposer qu’un lien `USED` a échoué : demander au client de consulter ses RDV ou de contacter le professionnel.

## Erreurs

Les nouveaux endpoints utilisent les statuts HTTP NestJS. Une erreur métier codée contient au minimum `{ "code": "…", "message": "…" }`. Certaines erreurs existantes d’autorisation conservent `{statusCode, message, error}` sans `code`.

| HTTP | Code | Action frontend |
|---|---|---|
| 400 | `INVALID_DATE`, `INVALID_DESIRED_PERIOD` | Corriger les dates/la combinaison |
| 400 | `INVALID_BOOKING_WINDOW`, `INVALID_AVAILABILITY_WINDOW`, `INVALID_BOOKING_MODE`, `INVALID_EXPIRATION` | Corriger les paramètres |
| 400 | `INVALID_PROJECT`, `INVALID_ARTIST`, `ASSOCIATION_MISMATCH`, `VENUE_REQUIRED`, `PUBLIC_SLUG_REQUIRED` | Corriger le contexte professionnel |
| 400 | `ASSOCIATION_CHANGED` | Demander un nouveau lien après vérification par le professionnel |
| 400 | validation DTO NestJS (message tableau) | Afficher les erreurs de saisie |
| 401 | JWT manquant/invalide/expiré | Authentifier ; conserver le retour vers la page People |
| 403 | `BOOKING_LINK_FORBIDDEN`, `BOOKING_PROFILE_UNAVAILABLE` ou erreur d’autorisation existante | Ressource/action actuellement indisponible |
| 403 | `BOOKING_CLIENT_MISMATCH` | Se connecter avec le destinataire vérifié |
| 404 | `BOOKING_LINK_NOT_FOUND` | Lien invalide |
| 409 | `BOOKING_LINK_USED` | Lien déjà consommé ; ne pas reproposer de réservation |
| 409 | `SLOT_UNAVAILABLE` | Recharger les disponibilités |
| 409 | `CLIENT_LINK_REQUIRED` | Faire confirmer la liaison CRM par le professionnel |
| 410 | `BOOKING_LINK_EXPIRED`, `BOOKING_LINK_REVOKED` | Afficher l’état et inviter à contacter le professionnel |
| 429 | `RATE_LIMIT_EXCEEDED` | Respecter `Retry-After` et `retryAfterSeconds` |
| 503 | protection Redis indisponible | Réessayer ultérieurement |

Les anciens endpoints RDV conservent leur convention historique `{error:true,message}` pour certaines erreurs métier (y compris celles interceptées par leurs services) ; ne pas confondre leur contrat avec celui des nouveaux endpoints.

## Intégration frontend à copier

### Studio

1. Ajouter les cinq choix et les champs conditionnels au RDV Projet ; lire les quatre champs dans le détail/liste et modifier avec l’endpoint dédié.
2. Proposer « Générer un lien » depuis le projet, la conversation et un écran autonome. Réutiliser le sélecteur de tatoueur et de lieu existant.
3. Envoyer `CreateBookingLinkRequest` et afficher/copier l’URL exacte reçue. Aucun RDV ne doit être ajouté optimistement au calendrier à cette étape.
4. Afficher la liste et les états, et proposer la révocation selon les droits. Après réservation, l’agenda reçoit le RDV existant `CONFIRMED`.

### People

1. Implémenter `/{slugPublic}/rdv/{token}` dans le routeur Next.js déjà utilisé par le dépôt People (par exemple `app/[slugPublic]/rdv/[token]/page.tsx` **si** ce dépôt utilise App Router ; ne pas créer un second routeur).
2. Charger les informations par **token** avec `cache: 'no-store'`. Si `slugPublic` diffère du `publicSlug` renvoyé, naviguer vers `bookingUrl` sur l’origine People configurée ; ne pas reconstruire un slug et ne pas refuser l’ancien slug avant cette résolution.
3. Réutiliser l’identité visuelle et les composants People ; afficher le nom/image du professionnel et du tatoueur, la prestation, la durée et les informations de lieu disponibles.
4. Si `requiresAuthentication`, utiliser le parcours de connexion/vérification People existant et revenir sur cette route. Le serveur contrôle toujours le destinataire.
5. Charger les disponibilités semaine par semaine, afficher date seule ou date+heure selon le mode, puis confirmer explicitement. Ne jamais confirmer au chargement ou lors d’une prévisualisation de lien.
6. Afficher la confirmation ou les états terminaux. Appliquer `noindex` et `Referrer-Policy: no-referrer` à cette page ; exclure le token des analytics.

Le backend renvoie l’URL canonique, il ne fait pas de redirection HTTP vers un frontend depuis les endpoints API. L’intégration visuelle et le routage Next.js restent à réaliser dans les dépôts frontend à partir de ce contrat.
