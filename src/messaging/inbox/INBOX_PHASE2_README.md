# Inkera Studio — Inbox phase 2 (backend NestJS)

## Livrable

Cette livraison fournit les API REST de gestion de l'Inbox, sur les tables déjà créées en phase 1.

- Aucune nouvelle migration Prisma ni modification du schéma.
- L'ancienne API `/messaging/conversations` et `/messaging/conversations/:id/messages` reste disponible.
- Les 4 canaux `INKERA`, `INSTAGRAM`, `FACEBOOK`, `EMAIL` sont reconnus dans la liste, la recherche et les filtres.
- Les messages **existants** des canaux externes sont consultables lorsqu'ils ont été synchronisés dans les tables `External*`.
- **Aucun envoi Instagram/Facebook/email n'est actif à ce stade.** L'API renvoie une erreur explicite tant que les connecteurs OAuth, webhooks et SMTP/API ne sont pas réalisés.

## Installation dans VS Code

1. Conserver une copie de ton backend et copier les fichiers du ZIP en respectant leur arborescence.
2. Vérifier que les tables de la phase 1 sont présentes dans ta **branche Neon de test**, et que `prisma migrate diff` ne retourne aucune différence (ce point était déjà validé).
3. `npx prisma generate` (local, sans appliquer de migration).
4. `npm test -- --runInBand --testPathPattern=messaging`
5. `npm run build`
6. Tester les routes ci-dessous avec le backend pointé vers la **branche Neon de test** avant tout déploiement.

> **Ne pas lancer `prisma migrate reset`, `prisma db push` ou `prisma migrate dev` contre la production.** Aucune migration supplémentaire n'est requise pour cette livraison.

## Routes ajoutées

Préfixe : `/messaging/inbox`. Toutes les routes exigent le JWT habituel (`Authorization: Bearer <token>`).
Le propriétaire du fil est toujours déduit du compte connecté, jamais d'un `ownerUserId` provenant du client.

| Méthode | Route | Fonction |
| --- | --- | --- |
| GET | `/` | Liste paginée : `channel`, `status`, `assignedUserId`, `linkedClientId`, `search`, `unreadOnly`, `page`, `limit` |
| GET | `/:threadId` | Détails, client CRM associé, artiste affecté, RDV liés, origine du canal |
| GET | `/:threadId/messages` | Messages internes ou externes déjà synchronisés ; `page`, `limit` |
| POST | `/:threadId/reply` | Répondre à un message Inkera avec texte et jusqu'à 5 images |
| PATCH | `/:threadId/status` | `NEW`, `IN_PROGRESS`, `WAITING_CLIENT`, `DONE` |
| PATCH | `/:threadId/assignment` | Assigner/désassigner : `assignedUserId` **ou** `assignedTatoueurId` ; `{}` pour désassigner |
| PUT | `/members/:memberUserId/permissions` | Salon : `{ "canView": true, "canReply": true, "canAssign": false }` |
| PUT | `/:threadId/client` | Rattacher une fiche CRM existante : `{ "clientId": "..." }` |
| POST | `/:threadId/client` | Créer ou retrouver et rattacher une fiche CRM via `firstName`, `lastName`, `email`, `phone` |
| POST | `/:threadId/appointments` | Rattacher un RDV existant : `{ "appointmentId": "..." }` |
| GET | `/:threadId/notes` | Notes internes, jamais exposées via les routes client |
| POST | `/:threadId/notes` | Ajouter une note : `{ "content": "..." }` |
| PATCH | `/:threadId/read-state` | `{ "forceUnread": true }` pour marquer non lu ; `false` pour marquer lu |
| GET | `/replies` | Réponses enregistrées propres à l'espace de l'utilisateur et, si autorisé, à son salon |
| POST | `/replies` | Créer une réponse enregistrée : `title`, `content`, `channel` facultatif |

## Règles de droits implémentées

1. Le compte salon voit ses conversations et contrôle leurs affectations.
2. Un indépendant relié (`User.salonId`) voit **ses propres conversations** et **uniquement** les conversations du salon dont `InboxThread.assignedUserId` correspond à son compte ET où `InboxMemberPermission.canView = true`.
3. Il peut répondre, changer le statut, ajouter une note, créer/rattacher une fiche client ou lier un RDV seulement si `canReply = true` en plus de `canView = true`.
4. Un artiste sorti du salon, ou dont la permission a été révoquée, perd immédiatement l'accès aux fils du salon (contrôle effectué en base à chaque requête).
5. Les profils `Tatoueur` internes sans compte propre sont assignables via `assignedTatoueurId`; ils opèrent actuellement depuis la session du salon.
6. Les fiches clients et RDV doivent appartenir au propriétaire du fil. Pour Inkera, un RDV d'un autre client ne peut pas être rattaché.
7. Une même fiche CRM peut être associée à un fil Instagram, email et Inkera : ces fils restent distincts et conservent leur historique.
8. Les notes ne sont consultables que par le salon ou l'indépendant précisément assigné et autorisé. Les jetons des connexions externes ne sont jamais renvoyés.

**Actuellement, seul le propriétaire du salon réattribue les fils ; le champ `canAssign` est conservé en base en prévision de futures délégations administrateur.**

## Tests écrits avant l'implémentation

Les tests Inbox ont d'abord échoué, car le service et les routes n'existaient pas encore. Ils ont ensuite été exécutés avec l'implémentation.

```powershell
# Tests du module messagerie et des règles Inbox (aucune BDD nécessaire : mocks Prisma)
npm test -- --runInBand --testPathPattern=messaging

# Tous les tests du backend (inclut les modules historiques)
npm test -- --runInBand --silent

# Validation TypeScript / NestJS
npm run build
```

**Référence avant changement :** 56/56 tests messagerie réussis ; pour le projet entier, 641/656 réussis, **8 suites / 15 tests déjà en échec** (modules `user`, `auth`, `piercing-price`, `salon-review`, `aftercare`, `clients`). Ces erreurs doivent être suivies séparément de cette phase.

## Scénarios manuels à exécuter sur la branche Neon de test

- Connecter un salon, autoriser un indépendant de l'équipe, lui attribuer un fil, puis ouvrir sa propre session : il voit le fil avec le nom du salon. Vérifier qu'il ne voit pas les fils non assignés.
- Révoquer `canView` ou retirer l'artiste de l'équipe, puis réessayer le GET du même `threadId` : attendu HTTP 403.
- Envoyer une réponse Inkera avec une image depuis une session autorisée, puis vérifier son affichage côté client via l'ancienne messagerie et l'incrémentation des non-lus.
- Relier deux RDV du même client à une conversation et vérifier qu'elle n'est pas dupliquée.
- Associer la même fiche CRM à deux fils de canaux différents : les fils restent distincts.
- Créer une note interne : vérifier qu'elle n'apparaît jamais dans la messagerie client.
- Tenter un POST `/:threadId/reply` sur Instagram : attendu HTTP 400, aucun message envoyé.

## À développer ensuite

- Connexion officielle Instagram/Facebook, autorisations Meta, traitement des webhooks et politiques de fenêtres de réponse.
- Connexions email OAuth/IMAP/SMTP, synchronisation, gestion des pièces jointes externes et reprise après incident.
- Interface des trois frontends : onglets canaux, listes, filtres, panneau fiche client, affectation et badges de provenance.
- Synchronisation des informations du compte client vers la fiche CRM **après association confirmée**, si le client complète ses coordonnées.
- Notifications temps réel pour les artistes assignés, indicateurs de non-lus issus des messages entrants, et intégration WebSocket sécurisée des nouvelles routes.
- Compléter la couverture par des tests HTTP et base de données sur la branche Neon de test (les tests livrés ici sont unitaires).
