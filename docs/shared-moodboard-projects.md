# Projets partagés à partir des moodboards

## Mise en service

La migration `20261025120000_shared_moodboard_projects` est additive : les moodboards existants restent privés et les conversations existantes restent utilisables.

Avant de lancer la nouvelle version du backend, appliquer les migrations avec `npx prisma migrate deploy`, puis générer le client Prisma avec `npx prisma generate`. Déployer ensuite les deux fronts. Aucune migration n'est exécutée automatiquement par le code applicatif.

## Parcours

- Client : Mon profil → Moodboards → ouvrir un moodboard → Partager mon projet. Tous les critères sont facultatifs. Seul le statut OPEN rend le projet visible dans Explorer.
- Professionnel : Explorer → filtres combinables → ouvrir le projet → premier message. Salon ou indépendant, plan payant non expiré et statut d'abonnement ACTIVE si un détail d'abonnement existe. Les essais et comptes rattachés à un salon ne disposent pas d'un accès indépendant.
- Avant acceptation, les demandes et le premier message apparaissent uniquement dans les moodboards et dans la liste des demandes de la messagerie du client. Aucune conversation n'est créée, recherchée ou modifiée à l'envoi, et aucun identifiant client ou de conversation n'est renvoyé au professionnel. Les demandes en attente sont incluses dans le badge de notification.
- À l'acceptation, la conversation existante est réutilisée (y compris si elle avait été archivée), ou une nouvelle est créée. Le premier message original est ajouté comme message du professionnel. Le client est dirigé vers la conversation pour répondre. Un refus ne crée aucune conversation et n'ajoute aucun message à une conversation existante.
- Accepter ou refuser une demande ne change pas automatiquement le statut du projet. Le client choisit quand indiquer « Tatoueur trouvé » ou fermer la publication.
- Une seule demande par professionnel et par projet, même après refus. La contrainte est aussi stockée en base. Les créations de conversation sont sérialisées par professionnel pour éviter les doublons lors de demandes simultanées.
- Bloquer refuse les demandes en attente, masque les projets au professionnel et interdit les messages dans les deux sens, sur les routes historiques comme dans l'inbox. Débloquer ne réinitialise pas les demandes déjà refusées.
- Les signalements sont consultables par un administrateur dans `/admin/signalements`.
- Le client reçoit un email à la première proposition, à la cinquième et à la onzième (plus de dix), au maximum trois emails par projet. Le compteur porte sur toutes les propositions reçues, y compris celles déjà acceptées ou refusées ; fermer puis republier le même moodboard ne réinitialise pas les seuils.
- Les envois sont enregistrés dans `ProjectProposalEmail` dans la transaction qui reçoit la proposition, puis livrés par la queue Bull `project-proposal-emails`. Un scan chaque minute reprend les envois en attente ; les échecs sont réessayés avec délai croissant, cinq tentatives maximum. Aucun ancien projet n'est parcouru pour envoyer rétroactivement des emails lors du déploiement.
- La création et la confirmation d'un rendez-vous passent par la même recherche de conversation par professionnel et client. Les rendez-vous successifs sont liés au même fil ; un fil archivé est rouvert. La confirmation prend également en charge un client Inkera lié par sa fiche CRM.
- À la création d'un rendez-vous professionnel, les moodboards partagés, acceptés ou déjà accessibles du client peuvent être sélectionnés. Le client conserve la possibilité de joindre son propre moodboard privé. La liaison vérifie que le moodboard appartient au client du rendez-vous ; les participants au rendez-vous peuvent le consulter.

## API authentifiée

- `GET /projects/options` : styles et catégories issus des registres existants.
- `GET /projects/explore?city=&category=&size=&style=&hashtag=&page=1` : 12 projets par page, uniquement ouverts et non bloqués. Aucun email, téléphone ou adresse client n'est exposé dans ce flux.
- `PATCH /projects/moodboards/:id` : statut et critères de publication.
- `POST /projects/moodboards/:id/proposals` : `{ message }`.
- `GET /projects/proposals?conversationId=` : demandes du client connecté.
- `PATCH /projects/proposals/:id` : `{ status: "ACCEPTED" | "REFUSED" }`.
- `POST` ou `DELETE /projects/professionals/:id/block`.
- `POST /projects/professionals/:id/report` : `{ reason, proposalId? }`.
- `GET /moodboard/appointment-options?email=` : sélection autorisée pour un rendez-vous professionnel.
- `GET /admin/project-reports?page=1` : signalements, réservé aux administrateurs.

Tailles : SMALL, MEDIUM, LARGE. Statuts : PRIVATE, OPEN, MATCHED, CLOSED. Mobilité : NONE, RADIUS (avec radiusKm entre 1 et 2000), ANYWHERE. La mobilité est indicative ; le filtre ville ne calcule pas de distance géographique.

## Vérification manuelle avant mise en production

Avec une base de test migrée : publier un moodboard, filtrer depuis un professionnel abonné, envoyer une demande, vérifier le compteur de non lus et l'affichage sur les deux fronts, accepter/refuser, vérifier une conversation déjà existante, bloquer/débloquer, consulter le signalement en admin et créer un rendez-vous avec le moodboard. Vérifier aussi qu'un compte FREE, expiré ou un autre client n'accède pas aux données protégées.

## Contrôles réalisés sur le code

- Schéma Prisma validé et client généré ; compilation Nest réussie.
- Tests ciblés sur les projets, les accès aux moodboards des rendez-vous, les conversations, les messages, les notifications et l'inbox. Ils vérifient notamment l'absence d'accès à la messagerie lors d'une proposition ou d'un refus, l'acceptation avec ou sans conversation existante et la protection contre une double acceptation.
- Ajout des emails : compilation réussie, lint ciblé sans erreur et 117 tests réussis sur les propositions, les seuils d'email, les tentatives de renvoi, les rendez-vous et la réutilisation des conversations. Les tests email utilisent un service mail simulé et n'envoient pas d'email réel.
- Vérification TypeScript des deux fronts réussie.
- Lint ciblé sans erreur. Le front public possède une ancienne configuration FlatCompat incompatible avec sa version d'ESLint/Next : les fichiers concernés ont été contrôlés en chargeant directement les configurations natives Next, sans modifier la configuration du projet. Deux avertissements préexistants subsistent dans les composants client existants.
- Les migrations initiale et `20261025143000_project_proposal_emails` ont été appliquées à la base configurée. Le statut des migrations et l'accès en lecture à la nouvelle table depuis le client Prisma ont été vérifiés. Le passage à la création de conversation après acceptation utilise le schéma existant. Pas de recette navigateur effectuée. Les modifications de rendez-vous déjà présentes dans le front public ont été conservées.
