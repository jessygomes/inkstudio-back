# Concours promotionnels (module `giveaways`)

Module générique : chaque concours est une donnée (catégories, critères, lots, calendrier, règlement). Le premier est le concours Inkera 2026–2027 (`inkera-2026-2027`), créé en **brouillon** par une commande idempotente.

Code : `src/giveaways/` · Migration : `prisma/migrations/20261123120000_giveaways` (uniquement additive) · Swagger : tags « Giveaways » et « Giveaways (admin) » sur `/api` (hors production).

## 1. Correspondance avec les données existantes

| Notion du concours | Donnée réelle |
|---|---|
| Participant (identité professionnelle) | `User` (un compte = une participation par concours, contrainte unique `giveawayId + userId`) |
| Tatoueur indépendant | `User.role = user_tatoueur` (rattaché ou non à un salon : il a son propre compte et son propre abonnement) |
| Salon | `User.role = user_salon`. Le rôle historique `user` n'est **pas** inclus dans la catégorie salon : le plan Business est réservé à `user_salon` (`SaasService.updateUserPlan`). |
| Nom | `salonName` (c'est aussi le nom public des tatoueurs, `publicDisplayName`) |
| Photo / logo | `profileImage` · couverture : `image` |
| Ville, adresse, code postal | `city`, `address`, `postalCode` |
| Description | `description` (20 caractères minimum) |
| Style | `style[]` (au moins une valeur) |
| Horaires | `salonHours` (JSON lu par `utils/booking-hours.ts`, au moins un jour valide) |
| Contact | `phone` (9 chiffres min.), `instagram`, `website`, `facebook`, `tiktok`. L'e-mail du compte existe toujours, il ne compte pas. |
| Profil public | `publicVisibility = VISIBLE` **et** `salonName`, `city`, `postalCode` renseignés (sans eux la page publique n'existe pas) |
| Réalisations publiques | `Portfolio.imageUrl` distinctes. Le portfolio n'a pas de visibilité propre : il est public si le profil l'est. |
| Photos du salon | `User.salonPhotos` (galerie « La vie du salon »), distinctes des réalisations |
| Compte actif | e-mail vérifié (`emailVerified`). Il n'existe pas de suspension de compte dans le schéma. |
| Abonnement | `User.saasPlan / saasPlanUntil` + `SaasPlanDetails` ; plans réels de l'enum `SaasPlan` (`PRO`, `BUSINESS`) |

Les comptes créés avant ou pendant l'opération et les abonnés payants sont acceptés : ni la date d'inscription ni la formule ne sont des critères.

## 2. Critères (liste blanche)

Les critères sont un tableau JSON validé par `parseCriteria` (`giveaway-criteria.ts`). **Un type ou une clé inconnus sont refusés** (400), aucun code n'est exécuté. Imbrication ≤ 3 niveaux, ≤ 40 nœuds.

| Type | Paramètres |
|---|---|
| `ACCOUNT_TYPE` | `roles`: `user_salon` \| `user_tatoueur` \| `user` (obligatoire dans chaque catégorie ; un rôle ne peut figurer que dans une catégorie : la catégorie est attribuée par le serveur) |
| `ACTIVE_ACCOUNT` | `requireVerifiedEmail?` (défaut `true`) |
| `PUBLIC_PROFILE` | `allowSearchHidden?` (défaut `false`) |
| `PROFILE_FIELD_REQUIRED` | `fields`: `NAME`, `PROFILE_PHOTO`, `COVER_PHOTO`, `CITY`, `ADDRESS`, `POSTAL_CODE`, `DESCRIPTION`, `STYLE`, `HOURS`, `PRESTATIONS` |
| `CONTACT_REQUIRED` | `channels?` (`PHONE`, `INSTAGRAM`, `WEBSITE`, `FACEBOOK`, `TIKTOK` ; défaut : tous), `min?` (défaut 1) |
| `MIN_PUBLIC_PORTFOLIO_IMAGES` | `min` (1–500) |
| `MIN_PUBLIC_STUDIO_IMAGES` | `min`, `includePortfolio?` (galerie seule, ou galerie ∪ réalisations) |
| `ALL_OF` / `ANY_OF` | `criteria` (2 à 10) |

Résultat d'éligibilité (`GET …/eligibility`) :

```json
{
  "eligible": false,
  "category": { "id": "…", "key": "independent", "label": "Tatoueur indépendant" },
  "criteria": [
    { "type": "PROFILE_FIELD_REQUIRED", "passed": false, "missingFields": ["PROFILE_PHOTO"] },
    { "type": "MIN_PUBLIC_PORTFOLIO_IMAGES", "passed": false, "required": 5, "actual": 3, "missingFields": ["PORTFOLIO_IMAGES"] }
  ],
  "missingFields": ["PROFILE_PHOTO", "PORTFOLIO_IMAGES"],
  "entriesOpen": true,
  "alreadyEntered": false,
  "rulesVersion": 1
}
```

`missingFields` possibles : les champs ci-dessus, `ACCOUNT_TYPE`, `EMAIL_VERIFIED`, `PUBLIC_PROFILE`, `CONTACT:<canaux>`, `PORTFOLIO_IMAGES`, `STUDIO_IMAGES`, `STUDIO_OR_PORTFOLIO_IMAGES`. `reason` vaut `NO_MATCHING_CATEGORY` pour un compte client / admin.

L'éligibilité est vérifiée à l'inscription **et** à la clôture (`freeze`).

## 3. API participant (site Studio et app Studio)

Identité toujours lue dans le jeton ; aucun identifiant de compte n'est accepté dans le corps. Limites : lecture 240 req / 15 min / IP ; actions 30 / 15 min / IP et 10 / 15 min / compte (`429 RATE_LIMIT_EXCEEDED`).

| Route | Auth | Description |
|---|---|---|
| `GET /giveaways` | public | concours publiés (hors brouillons, annulés, archivés) |
| `GET /giveaways/:slug` | public | détail, catégories, lots, critères, `status` effectif, `entriesOpen` |
| `GET /giveaways/:slug/rules` | public | `{ version, hash, url, content, approved }` |
| `GET /giveaways/:slug/results` | public | 404 tant que non publiés |
| `GET /giveaways/:slug/eligibility` | JWT | voir § 2 |
| `GET /giveaways/:slug/my-entry` | JWT | `{ entry, award }` |
| `POST /giveaways/:slug/entries` | JWT | participer |
| `DELETE /giveaways/:slug/my-entry` | JWT | retrait avant la clôture |
| `POST /giveaways/:slug/my-award/accept` | JWT | accepter le lot |
| `POST /giveaways/:slug/my-award/decline` | JWT | refuser le lot |
| `PATCH /giveaways/:slug/my-award/publication-consent` | JWT | changer le choix de publication du nom |

### Participer

```http
POST /giveaways/inkera-2026-2027/entries
{ "acceptRules": true, "rulesVersion": 1 }
```

- La case d'acceptation doit être **non précochée** côté front ; le serveur exige `acceptRules === true` et la version affichée. L'horodatage, la version et l'empreinte du règlement sont enregistrés.
- Aucun consentement marketing n'est demandé ni enregistré.
- Idempotent : rejouer renvoie `{ "created": false, "entry": … }` ; requêtes concurrentes protégées par la contrainte unique.

Réponse `201` :

```json
{ "created": true, "entry": { "id": "…", "status": "VALID", "category": { "key": "independent", "label": "Tatoueur indépendant" },
  "createdAt": "…", "acceptedRulesAt": "…", "rulesVersion": 1, "rulesUpdatedSinceEntry": false, "invalidReason": null } }
```

`status` : `VALID`, `UNDER_REVIEW` (coordonnées partagées avec une autre participation : vérification manuelle), `INVALID` (avec `invalidReason` lisible), `WITHDRAWN`.

Erreurs : `400` règlement non accepté · `403 GIVEAWAY_NOT_OPEN` · `404` concours inconnu ou non publié · `409 RULES_VERSION_CHANGED` (avec `rulesVersion` à relire) · `422 NOT_ELIGIBLE` (avec `eligibility`) · `429`.

### Lot

```http
POST /giveaways/inkera-2026-2027/my-award/accept
{ "publicationConsent": false }
```

L'acceptation du lot et la publication du nom sont deux choix distincts (le second peut être modifié ensuite). Erreurs : `409 ACCEPTANCE_EXPIRED`, `409` lot non acceptable.

`award.status` : `CONFIRMED` (à accepter avant `acceptDeadline`), `ACCEPTED`, `DECLINED`, `FORFEITED`, `ACTIVATED`, `CANCELLED`. Un gain non encore validé par l'équipe (`PENDING_CONFIRMATION`) n'est jamais montré au participant.

### Résultats publics

```json
{ "slug": "inkera-2026-2027", "publishedAt": "…", "categories": [ { "key": "independent", "label": "…", "drawnAt": "…",
  "eligibleCount": 42, "algorithm": "sha256-ctr+rejection+partial-fisher-yates/v1", "snapshotHash": "…", "seed": "…",
  "winners": [ { "anonymous": false, "displayName": "Encre Noire", "city": "Lyon" }, { "anonymous": true, "displayName": null, "city": null } ] } ] }
```

Seuls les gagnants ayant accepté leur lot et consenti à la publication sont nommés (nom public du profil + ville). La liste des participants n'est jamais exposée.

## 4. API admin

Préfixe `/admin/giveaways`. `JwtAuthGuard` + `RolesGuard('admin')` + `GiveawayAdminGuard` (le rôle est **relu en base** à chaque requête). Toute action est journalisée dans `GiveawayAuditLog` (identifiants et compteurs, jamais d'e-mail ni de téléphone).

| Route | Rôle |
|---|---|
| `GET /` · `POST /` | liste · création (toujours en `DRAFT`) |
| `GET /:id` · `PATCH /:id` | détail · édition (champs substantiels refusés après ouverture : `409 GIVEAWAY_LOCKED`) |
| `POST /:id/amendments` | avenant après ouverture (voir § 6) |
| `POST /:id/rules/approve` | validation juridique du règlement (condition de publication) |
| `POST /:id/publish` · `/unpublish` · `/archive` · `/cancel` · `/duplicate` | cycle de vie |
| `GET /:id/entries?page&limit&status&categoryId&search` | participations paginées (≤ 100) |
| `GET /:id/entries/export` | CSV (`;`, UTF-8 BOM, formules neutralisées), journalisé |
| `POST /:id/entries/:entryId/review` | `{ decision: VALID\|INVALID, note }` (avant clôture) |
| `GET /:id/stats` | compteurs par catégorie et statut |
| `POST /:id/eligibility-check` | contrôle à blanc de toutes les participations |
| `POST /:id/freeze` | `{ confirmation: "<slug>" }` : clôture et liste figée |
| `POST /:id/categories/:categoryId/draw` | `{ confirmation: "<slug>" }` : tirage officiel |
| `POST /:id/draws/:drawId/void` | `{ reason (≥ 30 car.), confirmation: "ANNULER <slug>" }` |
| `GET /:id/results` · `GET /draws/:drawId` | tirages, gagnants, suppléants (vue admin) |
| `POST /draws/:drawId/notify-alternates` · `/promote-alternate` | suppléants |
| `POST /awards/:awardId/confirm` · `/forfeit` · `/cancel` | validation humaine du gagnant, perte, annulation |
| `POST /awards/:awardId/activation/preview` · `/activate` | attribution de l'abonnement (§ 7) |
| `POST /:id/results/publish` · `/complete` · `/purge-personal-data` | fin du concours |
| `GET /:id/audit?page` | journal |

Création (extrait) :

```json
{ "slug": "printemps-2027", "title": "…", "opensAt": "2027-03-01T00:00:00+01:00", "closesAt": "2027-03-31T23:59:59.999+02:00",
  "drawAt": "2027-04-02T10:00:00+02:00", "timezone": "Europe/Paris", "rulesContent": "…", "config": { "acceptanceDays": 14, "retentionDays": 365 },
  "categories": [ { "key": "independent", "label": "Tatoueur indépendant", "winnersCount": 2, "alternatesCount": 2,
    "criteria": [ { "type": "ACCOUNT_TYPE", "roles": ["user_tatoueur"] }, { "type": "MIN_PUBLIC_PORTFOLIO_IMAGES", "min": 5 } ],
    "prizes": [ { "type": "SUBSCRIPTION_GRANT", "label": "PRO 6 mois", "plan": "PRO", "durationMonths": 6, "quantity": 2, "commercialValueCents": 21594 } ] } ] }
```

Règles vérifiées : clôture après ouverture, tirage après clôture, somme des lots = nombre de gagnants, `BUSINESS` uniquement pour une catégorie réservée à `user_salon`, `ACCOUNT_TYPE` obligatoire.

## 5. Statuts

`DRAFT` → (`publish`) `SCHEDULED` → *ACTIVE* (déduit des dates) → *CLOSED* (déduit après `closesAt`, enregistré au `freeze`) → `DRAWN` (toutes les catégories tirées) → `COMPLETED` (tous les lots traités). `CANCELLED` possible avant activation d'un lot. Archivage par `archivedAt`.

## 6. Verrouillage et avenants

Dès qu'un concours publié est ouvert, lots, critères, calendrier et règlement ne passent plus par `PATCH`. `POST /:id/amendments` (motif ≥ 20 caractères, `rulesLegallyApproved: true`) permet seulement : prolonger la clôture / décaler le tirage, augmenter un lot (le nombre de gagnants suit), corriger le règlement. Réduire un lot, avancer la clôture ou changer les critères est refusé. Chaque avenant incrémente `rulesVersion` et enregistre avant / après dans l'audit ; un participant inscrit sous une version antérieure le voit (`rulesUpdatedSinceEntry`). Avant l'ouverture, tout changement de règlement remet la validation juridique à zéro.

## 7. Abonnements offerts et Stripe

### Ce que fait Stripe aujourd'hui (audit)
- Abonnements Checkout (`STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`), webhooks `checkout.session.completed`, `customer.subscription.updated|deleted`, `invoice.*`, `customer.subscription.trial_will_end`, avec déduplication (`StripeWebhookEvent`).
- Droits applicatifs dans `User.saasPlan/saasPlanUntil` et `SaasPlanDetails` ; offres sans Stripe déjà gérées (`paymentMethod = INVITATION | ADMIN_GIFT`), expirées par la tâche horaire `saas-billing` (`downgradeExpiredInvitationUsers`) et à la lecture (`getUserPlanDetails`).
- Offre à un abonné payant : `StripeService.previewAdminGift / applyAdminGift` repousse `trial_end` de l'abonnement à « fin de la période payée + N mois » (aperçu + empreinte de confirmation, clé d'idempotence Stripe). Les webhooks reconnaissent ce cadeau (`readStripeAdminGift`) et appellent `markStripeGift`, sans l'écraser.

### Options comparées
| Option | Pour | Contre |
|---|---|---|
| Coupon / remise 100 % Stripe | natif | exige un abonnement Stripe (donc une carte au Checkout) pour un compte gratuit ; factures à 0 € ; risque de renouvellement payant tacite |
| Abonnement Stripe en essai de 12 mois | natif | carte demandée au Checkout ; conversion automatique en payant à la fin (interdit ici) |
| Subscription schedules | changements datés | complexité, mêmes problèmes pour un compte gratuit, aucun schedule utilisé dans le code |
| **Droit applicatif** (+ mécanisme existant pour les abonnés) | aucun objet Stripe pour un compte gratuit, réutilise les offres existantes, fin = FREE | pour un abonné payant, une écriture Stripe reste nécessaire |

**Choix** : `SubscriptionGrantsService`.
- **Compte sans abonnement Stripe** → droit applicatif `paymentMethod = 'GIVEAWAY'` : aucune carte, aucune facture, aucun renouvellement ; fin → FREE par la tâche horaire existante (ajout de `GIVEAWAY` à la liste). Chaînage : une offre gratuite de même formule en cours (essai natif, invitation, offre admin, autre lot) est prolongée à partir de sa fin (aucun jour perdu) ; formule inférieure en cours → passage immédiat (refus si elle durait plus longtemps que le lot) ; formule supérieure en cours ou origine inconnue → refus, traitement manuel.
- **Abonné Stripe** → `applyAdminGift` existant : la période déjà payée est conservée, l'offre commence à son terme, aucune facture pendant 12 mois. L'abonnement **reprend ensuite aux conditions que l'abonné avait lui-même acceptées** (c'est son contrat, pas une conversion silencieuse d'un cadeau) ; l'e-mail d'activation le dit et rappelle qu'il peut résilier sans frais. Refus si une offre Stripe est déjà programmée (`STRIPE_GIFT`), si la formule Stripe ne correspond pas au lot, ou si l'abonnement est en essai, résiliation, pause ou impayé (contrôles d'`applyAdminGift`).
- **Double facturation** : si un gagnant prend un abonnement pendant son lot applicatif, le Checkout reporte la première facture à la fin du lot (`trial_end`), comme pour l'essai natif. Une écriture conditionnelle (`stripeSubscriptionId: null`) sous verrou consultatif empêche l'attribution applicative si un abonnement apparaît pendant l'activation.
- **Idempotence** : clé `giveaway-award:<awardId>` (contrainte unique) ; côté Stripe, clé `admin-gift:<user>:<requestId>`. Rejouer l'activation renvoie le même lot.
- **Annulation** : un lot applicatif annulé retire le droit seulement s'il est encore celui posé par le lot (sinon seul le lot est marqué annulé) et restaure une offre chaînée. Un lot Stripe s'annule à la main.
- **Changement de propriétaire** : le bénéficiaire est le compte (`User`) ; il n'existe pas de transfert de compte dans le code. Compte supprimé → `userId` mis à null, le lot est conservé pour l'audit.

### Garde-fous Stripe
- `GIVEAWAY_STRIPE_GRANTS` : `off` (défaut, toute attribution à un abonné Stripe est refusée avec renvoi vers la procédure manuelle), `test` (autorisé seulement si `STRIPE_SECRET_KEY` commence par `sk_test_` / `rk_test_`), `live`.
- L'activation exige l'aperçu (`activation/preview` → `confirmation`, `requestId`) puis sa confirmation ; si l'abonnement a changé entre-temps, Stripe refuse.
- Aucune écriture Stripe n'a été faite pendant le développement ; les tests utilisent des doublures.

### Procédure de contrôle avant `live`
1. En environnement de test (`sk_test_`, `GIVEAWAY_STRIPE_GRANTS=test`) : créer un abonné PRO mensuel et un abonné BUSINESS, activer un lot, vérifier dans Stripe `trial_end` = fin de période + 12 mois, métadonnées `inkera_admin_gift=1`, `inkera_gift_source=giveaway:<slug>`, aucune facture émise ; rejouer l'activation (aucun doublon) ; laisser passer les webhooks (`customer.subscription.updated`) et vérifier `SaasPlanDetails.paymentMethod = STRIPE_GIFT`.
2. Avancer l'horloge de test Stripe (test clocks) jusqu'à la fin : une facture au tarif normal, droits PRO/BUSINESS conservés.
3. Résiliation pendant l'offre depuis le portail : fin au terme de l'offre, aucune facture.
4. Seulement alors : `GIVEAWAY_STRIPE_GRANTS=live`, et pour chaque gagnant abonné, aperçu vérifié par une seconde personne avant confirmation.

### Procédure manuelle (si `off`)
Utiliser l'outil admin existant `PATCH /admin/users/:id/subscription` (aperçu `POST …/preview`), puis noter l'opération dans le dossier du concours ; le lot reste `ACCEPTED` côté concours (ou l'annuler avec un motif).

## 8. Tirage

- `freeze` (après `closesAt`, confirmation par le slug) : refuse s'il reste des participations `PENDING_REVIEW` ; revérifie l'éligibilité de chaque participation (`INELIGIBLE_AT_CLOSE`, `ACCOUNT_DELETED`) ; détecte les coordonnées partagées apparues après l'inscription (passage en revue, la clôture est alors refusée) ; enregistre `frozenAt`.
- `draw` (après `drawAt`, une catégorie à la fois, jamais automatique) : verrou consultatif + contrainte unique `officialKey` → **un seul tirage officiel par catégorie**, même avec des requêtes simultanées. La liste figée (participations `VALID` triées par id) est enregistrée avec son empreinte ; la graine de 32 octets (`crypto.randomBytes`) est tirée ensuite ; sélection sans remise par Fisher–Yates partiel avec entiers non biaisés (SHA-256 en compteur + rejet). Pas de `Math.random`. Le tirage est rejouable à partir de la graine et de la liste.
- Gagnants (`winnersCount`) puis suppléants (`alternatesCount`), dans l'ordre. Si les candidats manquent, les lots restants sont signalés (`shortfall`) dans l'audit et l'e-mail admin.
- Les gagnants **ne sont pas prévenus** au tirage : chaque gain est validé par un admin (`confirm`), qui déclenche l'e-mail et ouvre le délai d'acceptation (`acceptanceDays`).
- Lot refusé, perdu ou annulé → `promote-alternate` l'attribue au suppléant suivant, dans l'ordre du tirage.
- Correction exceptionnelle : `void` (motif ≥ 30 caractères, confirmation « ANNULER <slug> ») annule le tirage, ses lots non activés et la publication des résultats ; refusé si un lot est activé. Le nouveau tirage référence l'ancien (`supersedesId`). Il n'y a pas de bouton « relancer ».

## 9. E-mails

Mailgun via `MailService.sendMail`, mise en page `renderInkeraEmail`. Envois idempotents (`GiveawayEmailDelivery.key` unique ; un échec est enregistré et retenté au prochain déclenchement, sans faire échouer l'action). Messages de service uniquement : confirmation de participation, gagnant (à la validation admin), suppléant (`notify-alternates`), acceptation, activation, notifications admin (clôture, tirage, avenant, annulation de tirage) à `GIVEAWAY_ADMIN_EMAIL` (sinon `ADMIN_EMAIL`). Les tests n'envoient aucun e-mail (service simulé).

Liens : `FRONTEND_URL/concours/<slug>` (page à créer dans le site Studio).

## 10. RGPD et audit

- Règlement versionné (`rulesVersion`, `rulesHash`) ; chaque participation garde la date, la version et l'empreinte acceptées.
- Données minimales : l'éligibilité copie seulement le résultat des critères ; les signaux anti-doublons sont des empreintes SHA-256 (téléphone, réseaux, site, nom + code postal), jamais en clair, jamais renvoyées par l'API.
- Anti-multi-comptes prudent : une coordonnée partagée met la participation en revue manuelle, sans fusion ni rejet automatique (deux salons peuvent partager un site, une famille un téléphone). L'admin tranche (`review`).
- Retrait par le participant avant la clôture (la trace d'acceptation reste).
- Compte supprimé : `userId` mis à null (`onDelete: SetNull`), l'empreinte `participantHash` et l'historique restent.
- `purge-personal-data` après `retentionDays` (défaut 365) suivant la fin : les participations sans lot perdent le lien au compte et les données copiées ; les gagnants sont conservés (preuve de remise).
- Export CSV réservé aux admins, journalisé.
- Consentement à la publication du nom distinct de l'acceptation du lot, modifiable.

## 11. Mise en service

1. `npx prisma migrate deploy` (migration `20261123120000_giveaways`, additive), puis déployer le backend.
2. `npm run giveaway:seed-inkera-2026-2027 -- --admin <id d'un compte admin>` (ajouter `--dry-run` pour vérifier). Idempotent : ne fait rien si le slug existe.
3. Faire rédiger et valider le règlement, le saisir (`PATCH /admin/giveaways/:id`, `rulesContent` ou `rulesUrl` en https), vérifier les valeurs commerciales (12 × tarif de `utils/data.ts`), puis `POST …/rules/approve` et `POST …/publish`.
4. Variables : `GIVEAWAY_ADMIN_EMAIL` (facultative), `GIVEAWAY_STRIPE_GRANTS` (laisser `off` tant que la procédure § 7 n'est pas faite). Existantes utilisées : `FRONTEND_URL`, `MAILGUN_*`, `STRIPE_*`, `REDIS_*` (limitation de débit).
5. Fronts : page publique + participation (case de règlement non précochée, choix de publication séparé), écran admin.

## 12. Limites connues

- Pas d'écran front (site / app) ni d'outil admin graphique : API uniquement.
- Lot Stripe : annulation manuelle ; un compte déjà sous offre Stripe programmée, ou dont la formule Stripe diffère du lot, est traité à la main.
- Rôle historique `user` exclu de la catégorie salon (Business impossible).
- Détection des doublons limitée aux coordonnées déclarées ; pas de comparaison d'images ni d'adresse IP (choix de minimisation).
- Le module n'envoie pas de rappel automatique (acceptation qui expire) : la perte d'un lot est déclarée par un admin (`forfeit`).
- Le statut d'un abonnement offert (`SCHEDULED/ACTIVE/EXPIRED`) est déduit des dates ; le retrait du droit est fait par la tâche horaire existante.
