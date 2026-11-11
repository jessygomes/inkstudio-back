# Liens personnalisés et période souhaitée — intégration technique

## Audit et architecture

- NestJS 11, Prisma 6, PostgreSQL ; DTO `class-validator`, JWT Passport, anti-abus Redis `SecurityThrottle`.
- `Appointment` conserve les types `PROJET/TATTOO/RETOUCHE/PIERCING` et les statuts existants. `PENDING/CONFIRMED` bloquent les calendriers.
- `Tatoueur` représente un membre interne ; `User` avec `user_tatoueur` représente un indépendant/rattaché. `SalonResidency` porte les permissions croisées et la présence ; `user_salon` utilise un agenda par tatoueur.
- `internal-booking-policy` verrouille le calendrier propriétaire ; `ResidenciesService` verrouille le compte exécutant. Les liens utilisent ces mêmes contrôles et la même création de RDV.
- Horaires : `salonHours`, `Tatoueur.hours`, `bookingHoursWindow`, présence du lieu Europe/Paris. Pauses/congés : `BlockedTimeSlot`. Pas de paramètre de tampon configuré dans le modèle actuel. La grille existante est de 30 minutes ; les liens acceptent des durées exactes personnalisées.
- `Client` est la fiche CRM propre au professionnel, `linkedUserId` la liaison fiable au compte People. `Conversation` appartient au propriétaire et à un compte client ; `InboxThreadAppointment` relie plusieurs RDV à un fil. Les contacts externes non liés restent non liés.
- Les contrôleurs existants permettent création, modification, confirmation, annulation et déplacement client. Les périodes souhaitées sont des métadonnées, jamais des créneaux.

## Fichiers et choix

`src/appointments/booking-links.*` : endpoints, autorisations, invitation, transaction de confirmation. `booking-link-time.ts` : candidats sur la grille existante avec durée exacte. `booking-link-notifications.service.ts` : appels des notifications/emails/cache/conversations existants après commit.

`desired-tattoo-period.ts` et son DTO : validation cohérente des cinq choix et des dates civiles. Les DTO création/modification héritent de ce DTO ; le service enregistre les champs et enrichit ses sélections explicites. L’endpoint de modification dédié évite de modifier les autres propriétés du RDV.

`AppModule` ne réenregistre plus `AppointmentsController` : il est déjà possédé par `AppointmentsModule`. Le contrôleur statique des liens y précède la route générique `appointments/:id`.

`publicNameSlug` réutilise la normalisation des profils publics. `INKERA_PEOPLE_BASE_URL` est séparée de `FRONTEND_URL` pour éviter un lien client pointant vers Studio. Le token résout le profil puis l’API fournit l’URL canonique actuelle.

## Migration

`prisma/migrations/20261111090000_personal_booking_links/migration.sql` est additive : quatre colonnes nullable sur `Appointment`, trois enums, table `BookingLink`, index et clés étrangères. Des CHECK SQL imposent les combinaisons de dates, les deux prestations, la durée, la fenêtre et l’exclusivité du type de tatoueur. Aucune ancienne migration n’est modifiée ; aucune suppression ou réinitialisation de base n’est nécessaire.

Les liens ciblés sont supprimés par cascade quand une identité/ressource source est supprimée : ils ne deviennent jamais accidentellement des invitations ouvertes. La suppression du RDV résultat met sa référence à NULL mais laisse le lien `USED` et `usedAt` ; il ne redevient pas réservable.

Avant démarrage d’une version applicative utilisant les nouvelles colonnes, appliquer la migration via le workflow Prisma habituel, puis générer le client. Ne pas appliquer `db push` à une base métier. Les opérations de migration réalisées pour les tests ne concernent que le cluster temporaire isolé.

## Intégrité et concurrence

Ordre de la confirmation : compte client authentifié → calendrier exécutant/propriétaire → lieu si différent → lien → ressources associées. Les verrous sont `SELECT … FOR UPDATE`. Les règles sont relues dans la transaction et `ResidenciesService.persistAppointment` assure la vérification finale commune aux réservations ordinaires et par lien.

Les écritures liées à un exécutant prennent aussi le verrou du lieu pour coordonner les blocages globaux du salon. Le lien est relu sous verrou ; une seule transaction peut le consommer. Création de fiche, RDV, détail, associations Inbox fiables et passage `USED` font partie du même commit. Un échec annule l’ensemble. Révocation et confirmation se sérialisent sur le lien.

`EXPIRED` est calculé à la lecture à partir de l’expiration ou de la fin de fenêtre, sans dépendance à un cron. `ACTIVE`, `USED`, `REVOKED` sont persistés lors des mutations ; l’enum autorise également `EXPIRED` pour une éventuelle maintenance future.

Les effets secondaires passent après commit et utilisent les services existants. La livraison est au même niveau de garantie que le parcours actuel : pas de nouvel outbox transactionnel. Les erreurs de livraison sont journalisées sans exposer de token et sans renvoyer un faux échec de réservation. Une panne de processus juste après commit reste une limite du mécanisme existant.

## Confidentialité, identité et limites

- Token : 32 octets `crypto.randomBytes`, base64url, SHA-256 unique en base. URL complète rendue une seule fois à la création.
- Endpoints publics : projection explicite sans CRM, note, calendrier occupé ni association privée ; `Cache-Control: private, no-store` via l’anti-abus.
- Consultation : politique Redis `bookingLinkRead`, 120 requêtes/IP/15 min par défaut. Confirmation : politique existante `booking` (IP/email/compte). Fenêtre de disponibilité limitée à 7 jours par requête.
- Une invitation ciblant un compte exige ce compte. Pour une fiche ciblée sans compte lié, l’email du compte doit être vérifié et correspondre ; aucune liaison CRM n’est créée sur cette seule base.
- Les liens sont des autorisations professionnelles de réserver directement un RDV confirmé. La confirmation manuelle du parcours de réservation ordinaire reste inchangée.
- Les disponibilités sont recalculées ; aucune garantie de maintien du créneau n’est donnée avant le commit.

## Tests et commandes

```sh
node node_modules/prisma/build/index.js validate
node node_modules/prisma/build/index.js generate
node node_modules/typescript/bin/tsc --noEmit
node node_modules/jest/bin/jest.js --runInBand
node scripts/test-booking-links-postgres.cjs
```

Le dernier script initialise un cluster PostgreSQL temporaire, lié uniquement à `127.0.0.1` sur un port libre. `PG_BIN` permet de préciser le répertoire des exécutables PostgreSQL (défaut Windows : PostgreSQL 16). Il ignore la `DATABASE_URL` métier, reconstruit le schéma immédiatement antérieur à cette évolution dans la base de test, insère un ancien RDV, applique la migration puis vérifie la conservation du RDV et exécute la suite Jest PostgreSQL. Il arrête le cluster dans `finally` et conserve les artefacts temporaires pour diagnostic.

`booking-links.postgres.spec.ts` refuse toute URL autre qu’une base locale appelée `inkera_booking_test`. Sans `BOOKING_LINK_TEST_DATABASE_URL`, cette suite est explicitement ignorée lors des tests ordinaires. Le script est la commande à utiliser pour réellement tester les verrous PostgreSQL et la migration.

Couverture : cinq préférences, durées personnalisées, modes fixe/automatique, transitions DST, trois origines, permissions de résidence, confidentialité, CRM et Inbox, conflits, usage unique, confirmations concurrentes sur un même lien/deux liens et compétition avec un RDV ordinaire, rollback et notifications après commit.

Contrat destiné aux deux frontends : [personal-booking-links-api.md](personal-booking-links-api.md).

## Résultats constatés le 11 novembre 2026

- `prisma validate` : réussi ; client Prisma généré.
- `tsc --noEmit --pretty false` : terminé sans diagnostic après correction du mock Apple manquant dans un test d’authentification existant.
- PostgreSQL isolé : migration appliquée, ancien RDV conservé, **19 tests réussis** ; cluster arrêté.
- Dernière exécution Jest ciblée (`appointments|internal-booking|residencies|time-slot|email-token-security`) : **271 tests réussis**, 19 tests PostgreSQL ignorés dans cette exécution ordinaire (ils ont été exécutés séparément), 15 suites réussies.
- Trois suites n’ont pas pu démarrer à cause d’erreurs système `UNKNOWN: unknown error, open/stat` sur des fichiers de `node_modules` : `booking-links.controller.spec.ts`, `appointments-sponsored-booking.spec.ts` et `appointments.controller.spec.ts`. Les deux dernières avaient réussi lors de la première exécution ciblée. Le nouveau test HTTP reste à exécuter dans un environnement où ces fichiers sont lisibles ; la dernière exécution ciblée n’est donc pas entièrement verte.
- Les anciennes fixtures de réservation du 2 novembre 2026 échouaient parce que cette date était passée : leur horloge a été figée au 1er novembre, sans affaiblir les validations de production.
- Les tests et vérifications ont été arrêtés à la demande de l’utilisateur ; aucune relance PostgreSQL ni nouvelle campagne n’a été effectuée après cette demande.
- Aucune migration de base métier, aucun push, aucun déploiement. La route et les écrans frontend ne sont pas implémentés dans ce dépôt backend.

## Inventaire des fichiers

Modèles et migration :

- `prisma/schema.prisma`
- `prisma/migrations/20261111090000_personal_booking_links/migration.sql`

Code applicatif modifié :

- `src/app.module.ts`
- `src/appointments/appointments.module.ts`
- `src/appointments/appointments.controller.ts`
- `src/appointments/appointments.service.ts`
- `src/appointments/dto/create-appointment.dto.ts`
- `src/appointments/dto/update-appointment.dto.ts`
- `src/appointments/internal-booking-policy.ts`
- `src/residencies/residencies.service.ts`
- `src/auth/security-throttle.ts`
- `src/user/public-profile.utils.ts`

Nouveau code :

- `src/appointments/booking-links.controller.ts`
- `src/appointments/booking-links.service.ts`
- `src/appointments/booking-link-notifications.service.ts`
- `src/appointments/booking-link-time.ts`
- `src/appointments/desired-tattoo-period.ts`
- `src/appointments/dto/booking-link.dto.ts`
- `src/appointments/dto/desired-tattoo-period.dto.ts`

Tests ajoutés et fixtures corrigées :

- `src/appointments/booking-links.controller.spec.ts`
- `src/appointments/booking-links.postgres.spec.ts`
- `src/appointments/booking-link-notifications.service.spec.ts`
- `src/appointments/booking-link-time.spec.ts`
- `src/appointments/desired-tattoo-period.spec.ts`
- `src/appointments/booking-security.spec.ts`
- `src/auth/email-token-security.spec.ts`
- `scripts/test-booking-links-postgres.cjs`

Documentation :

- `docs/personal-booking-links-api.md`
- `docs/personal-booking-links-technical.md`
