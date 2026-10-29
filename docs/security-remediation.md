# Suivi des corrections de sécurité

Audit initial : 29 octobre 2026. Périmètre : backend, frontend professionnel
`inkstudio-front`, frontend public `inkstudio-front-public`.

Une case cochée signifie **correction implémentée et tests locaux validés**.
Le déploiement et les contrôles de production sont suivis séparément ; ils ne
sont jamais déduits de la réussite des tests locaux. Chaque intervention reste
limitée à un point ou à un ensemble nécessaire de corrections liées.

## Liste priorisée

### Priorité 0 — Critique

- [x] SEC-01 — Vérifier les jetons Google côté backend avant toute connexion ou liaison de compte (audit 1). Correction et tests locaux validés le 29 octobre 2026 ; migration appliquée à la base configurée, déploiement applicatif en attente.
- [x] SEC-02 — Fermer les modifications publiques de forfait et les routes SaaS de réparation ; réserver les changements aux opérations autorisées (audit 2). Correction et tests locaux validés le 29 octobre 2026 ; livraison backend / frontend en attente.
- [x] DEP-01 — Mettre à jour Next.js et ses dépendances d'images sur les deux frontends ; vérifier les conditions d'exploitation des alertes critiques. Next.js 16.4.3 / sharp 0.35.5, tests et builds locaux validés le 29 octobre 2026 ; déploiement en attente.
- [x] DEP-02 — Corriger les alertes NextAuth / Auth.js et les contrôles de session concernés sur les deux frontends. NextAuth 5.0.0-beta.32 / Auth.js core 0.41.3, tests et builds locaux validés le 29 octobre 2026 ; déploiement en attente.
- [x] DEP-03 — Mettre à jour jsPDF et vérifier les usages des fonctions concernées sur le frontend professionnel.
- [x] DEP-04 — Corriger l'alerte proxy-addr du backend et vérifier la configuration des proxies de confiance. Version 2.0.8 et politique explicite testées localement ; adresses de production à confirmer au déploiement (SEC-15b).

Les sévérités des dépendances proviennent de l'audit npm. Une alerte de paquet
n'établit pas à elle seule l'exploitabilité dans l'application déployée.

### Priorité 1 — Élevée

- [x] SEC-03 — Authentifier les suppressions UploadThing et vérifier la propriété de chaque fichier sur les deux frontends (audit 3). Registre signé et tests locaux validés ; migration appliquée, secrets locaux / backend Railway configurés et ajout des variables Vercel confirmé par l'utilisateur. Reprise historique, livraison et vérification réelle des callbacks en attente.
- [x] SEC-04 — Protéger les créations / modifications / suppressions de suivi et la création d'historique de tatouage (audit 4). Authentification, propriété des fiches clients et tests locaux validés ; déploiement backend en attente.
- [x] SEC-05 — Séparer les données publiques professionnelles des données privées des comptes clients (audit 5). Routes publiques filtrées, lectures privées réservées au propriétaire et tests locaux validés ; livraison backend / frontend professionnel en attente.
- [x] SEC-06 — Déduire l'identité client de la session pour les réservations ; sécuriser les liaisons CRM / moodboards et l'atomicité des écritures (audit 6). JWT vérifié, preuves de liaison et transactions partagées validés localement ; livraison et revue des anciennes liaisons en attente.
- [x] SEC-07 — Empêcher la modification des identifiants, rôles et jetons via les mises à jour de session frontend (audit 7). Traité avec DEP-02 : rafraîchissement depuis le backend authentifié, nouveaux cookies et tests d'injection validés localement ; déploiement en attente.
- [x] SEC-08 — Revalider l'éligibilité publique, les horaires, les blocages et les conflits des artistes internes lors de l'écriture d'un rendez-vous (audit 8). Correction, 220 tests ciblés et compilation backend validés localement ; déploiement et concurrence sur PostgreSQL réel à vérifier en préproduction.
- [x] SEC-09 — Limiter les tentatives d'authentification, de vérification email, de réinitialisation et de réservation ; sécuriser les codes email (audit 9). Compteurs Redis partagés, liens aléatoires hachés et consommation transactionnelle ; 157 tests ciblés et compilation backend validés localement. Déploiement et contrôles Redis / PostgreSQL réels en attente.
- [x] SEC-10 — Authentifier / autoriser les uploads et enregistrer leur propriétaire réel ; appliquer les quotas (audit 10). Contrôles métier, réservations de quota, capacités invitées et nettoyage conservateur validés localement ; migration additive appliquée à la base configurée le 29 octobre 2026. Livraison des trois applications et tests réels de stockage en attente.
- [ ] DEP-05 — Traiter les autres alertes de dépendances élevées et modérées, après vérification des chemins réellement utilisés.

### Priorité 2 — Moyenne et durcissement

- [ ] SEC-11 — Révoquer les sessions / JWT après changement ou réinitialisation du mot de passe et revoir leur durée de vie (audit 11).
- [ ] SEC-12 — Supprimer le cache public des préférences de notification et vérifier les autres réponses privées (audit 12).
- [ ] SEC-13 — Retirer ou restreindre les routes de debug des notifications email en production (audit 13).
- [ ] SEC-14 — Réduire les données publiques des créneaux bloqués et limiter les événements WebSocket aux utilisateurs autorisés (audit 14).
- [ ] SEC-15a — Uniformiser les DTO et la politique de réinitialisation de mot de passe (audit 15).
- [ ] SEC-15b — Définir la chaîne de proxies approuvés et fiabiliser l'IP des limiteurs (audit 15).
- [ ] SEC-15c — Supprimer les données personnelles et erreurs internes des logs / réponses inappropriés (audit 15).

### Contrôles complémentaires de production

- [ ] Vérifier la configuration serveur / CDN, les versions réellement déployées et les en-têtes de sécurité.
- [ ] Vérifier les permissions des documents sensibles et l'accès aux URL de stockage.
- [ ] Revalider le rendu des données structurées JSON-LD ; ne pas considérer une injection comme démontrée sans vérifier le chemin de rendu.
- [ ] Exécuter les contrôles de non-régression en préproduction puis les vérifications non destructives après déploiement.

### À traiter à la toute fin — demande utilisateur

- [ ] Prévoir une fusion sécurisée de deux fiches CRM d'un même client, notamment une ancienne fiche non liée et une nouvelle fiche liée après réservation authentifiée. À concevoir après les corrections de sécurité : preuve qu'il s'agit de la même personne, autorisation du salon propriétaire, revue des données médicales / consentements / historiques, conservation des liens et traçabilité. Aucune fusion automatique par email et aucune implémentation dans SEC-08.

## Intervention SEC-01 — Connexion Google

État : corrigé et testé localement le 29 octobre 2026. Migration appliquée à la
base configurée (`inkstudio`, schéma `public`) ; déploiement applicatif et
connexion Google réelle non vérifiés.

### Comportement attendu

- `POST /auth/google` exige `idToken`. Un email ou un access token seul ne suffit plus.
- La bibliothèque officielle `google-auth-library` vérifie la signature Google,
  l'émetteur, l'audience et la validité temporelle. L'email doit être vérifié.
- L'email, le nom et l'image proviennent uniquement du jeton vérifié. Le rôle
  reste celui de la base ; un nouveau compte reçoit toujours le rôle `client`.
- Le compte est lié au `sub` Google stable via `User.googleSubject` (unique).
- Un compte existant non lié est associé automatiquement uniquement si Google
  établit la propriété de l'adresse : Gmail ou Google Workspace.
- Une adresse externe à ces cas, déjà présente sans liaison, doit utiliser la
  connexion par mot de passe (ou sa réinitialisation). La liaison explicite avec
  une seconde preuve d'identité n'est pas ajoutée dans cette intervention.
- Une identité Google déjà liée ne peut pas être remplacée sur simple égalité
  d'email. Une liaison concurrente entraîne un refus sans émission de JWT.
- Si le compte local n'avait jamais validé son email, son ancien mot de passe
  est supprimé lors de la liaison Google pour éviter d'activer un mot de passe
  qu'un tiers aurait choisi avant cette preuve de propriété.

### Configuration et déploiement

- Runtime Node.js >= 22 pour la version installée de `google-auth-library`.
- Configurer `GOOGLE_ID_TOKEN_AUDIENCE` côté backend, identique au client OAuth
  du frontend public (`AUTH_GOOGLE_ID`, ou `GOOGLE_CLIENT_ID` en secours sur le
  frontend). Cela permet de conserver d'anciens identifiants OAuth backend.
  Sans audience dédiée, le backend utilise `GOOGLE_CLIENT_ID`, puis
  `AUTH_GOOGLE_ID`. Aucun client ID n'est accepté
  depuis la requête. Si la configuration manque, la connexion est refusée (503).
- Le frontend public transmet déjà `account.id_token` sous le nom `idToken`.
- Les identifiants des deux dépôts locaux différaient au moment de la
  correction : configurer explicitement cette audience dans chaque
  environnement cible, sans recopier de secret OAuth.
  Le `.env` backend local a été aligné avec le client OAuth du frontend public
  via `GOOGLE_ID_TOKEN_AUDIENCE` ; ce fichier n'est pas versionné.
- Avant de démarrer le backend corrigé, appliquer la migration additive
  `20261029120000_verified_google_identity` via la procédure de déploiement
  habituelle (`npx prisma migrate deploy`), puis générer le client Prisma.
- La migration ne lie aucun compte existant rétroactivement.

### Validation à consigner

- [x] Tests de signature réelle avec clés locales, audience, émetteur, dates, email et configuration.
- [x] Tests HTTP : refus des anciennes requêtes email seul, validation du DTO, rejet des champs d'identité injectés et réponse 401.
- [x] Tests métier : liaison autorisée, refus de remplacement, refus d'une liaison d'email externe non prouvée, concurrence et absence de JWT après échec.
- [x] Tests de non-régression de l'authentification existante et compilation backend.
- [x] Migration `20261029120000_verified_google_identity` appliquée à la base configurée le 29 octobre 2026. Elle était la seule en attente ; `prisma migrate status` confirme que le schéma est à jour.
- [ ] Backend corrigé déployé et connexion Google réelle vérifiée dans l'environnement cible.

Résultats : 3 suites / 76 tests réussis. Les tests de signature utilisent la
bibliothèque Google réelle avec des clés RSA locales et une récupération de
certificats simulée ; aucun appel réseau Google ni accès à une base réelle.

Commandes de validation :

```sh
npm test -- --runInBand auth.service.spec.ts auth.controller.spec.ts google-identity.service.spec.ts
npm run build
npx prisma validate
```

## Intervention SEC-02 — Routes SaaS

État : corrigé et testé localement le 29 octobre 2026. Aucun déploiement applicatif effectué.

### Changements

- Suppression des anciennes routes `PATCH /saas/upgrade/:userId`,
  `POST /saas/upgrade-pro`, `POST /saas/upgrade-business` et
  `POST /saas/fix-plan/:userId`. Elles ne sont plus disponibles, même pour un
  administrateur : les changements utilisent les parcours Stripe authentifiés
  et la route administrative existante de gestion des abonnements.
- Suppression des helpers de changement / réparation inutilisés du service ;
  les méthodes internes nécessaires aux essais, invitations et événements
  de facturation sont conservées.
- Authentification obligatoire sur toutes les routes SaaS restantes.
  La lecture d'un forfait est limitée à son propriétaire ou à un administrateur.
- `POST /saas/check-feature` déduit le compte du JWT et valide la fonctionnalité
  demandée via un DTO. Les champs `userId`, `role` ou `plan` de la requête ne
  peuvent pas choisir un autre compte ni modifier le forfait.
- Les réponses SaaS privées portent `Cache-Control: private, no-store`.
- Les composants frontend professionnel `SubscriptionSection` et
  `VerificationNotification` transmettent désormais le JWT pour lire le forfait
  et attendent sa disponibilité. Le frontend public n'appelle pas ces routes.

### Validation et livraison

- [x] Tests HTTP avec JWT réellement signé : accès propriétaire / administrateur, refus intercompte, absence de jeton, signature incorrecte et expiration.
- [x] Anciennes routes indisponibles pour les visiteurs, salons, clients et administrateurs ; aucune modification de forfait appelée.
- [x] Tests des fonctionnalités : compte issu du JWT, validation des entrées, fonctionnalités indisponibles et cache privé.
- [x] Tests de non-régression Stripe, cadeaux administratifs, essais et cycle de facturation ; signatures manquantes / invalides sans écriture.
- [x] Compilation backend et vérification TypeScript du frontend professionnel.
- [ ] Backend et frontend professionnel corrigés déployés ensemble ; parcours abonnement et rappels vérifiés après livraison.

Aucune migration supplémentaire n'est nécessaire pour SEC-02.

Résultats : 6 suites / 95 tests réussis ; compilation backend et vérification
TypeScript frontend sans erreur. Les tests de facturation utilisent des services
simulés et ne déclenchent aucun paiement réel.

Commandes backend :

```sh
npm test -- --runInBand saas.controller.spec.ts saas.service.spec.ts stripe.controller.spec.ts stripe.service.spec.ts stripe-admin-gift.spec.ts admin-subscriptions.service.spec.ts
npm run build
```

Commande exécutée avec le projet TypeScript du frontend professionnel :

```sh
npx tsc --noEmit --incremental false --pretty false
```

Ordre de livraison recommandé : frontend professionnel avec ses en-têtes JWT,
puis backend avec les routes SaaS protégées. L'ancien backend accepte déjà les
requêtes authentifiées ; cet ordre évite une interruption des lectures de forfait.

L'intervention DEP-01 qui suit traite les dépendances critiques des deux frontends.

## Intervention DEP-01 — Next.js et traitement des images

État : corrigé et testé localement le 29 octobre 2026. Aucun déploiement effectué.

### Changements

| Dépôt | Next.js avant | Next.js après | sharp effectif après |
| --- | --- | --- | --- |
| Frontend professionnel | 16.3.4 | 16.4.3 | 0.35.5 |
| Frontend public | 16.2.3 | 16.4.3 | 0.35.5 |

- Next.js et `eslint-config-next` sont épinglés à `16.4.3` dans les deux
  manifests et lockfiles. Les dépendances d'images livrées avec Next.js sont
  mises à jour ; aucun override d'une ancienne version de sharp n'est ajouté.
- Versions natives constatées localement : libvips `8.18.7`, librsvg `2.63.2`.
- Ajout de `tests/image-pipeline.test.cjs` dans chaque frontend et de la commande
  `npm run test:security-images`. Les tests utilisent le vrai pipeline installé
  de Next.js et le sharp résolu depuis Next.js, sans mocks du rendu d'image.
- Le frontend public utilise maintenant la configuration ESLint flat officielle
  et `eslint .` à la place de l'ancienne commande `next lint`, supprimée dans
  Next.js 16. Les configurations d'images et règles d'accès applicatives ne
  sont pas modifiées dans cette intervention.

### Validation

- [x] 6 tests d'images par frontend : versions minimales corrigées, PNG vers WebP et AVIF avec redimensionnement, SVG simple, refus de données invalides et dépassement d'une limite de pixels.
- [x] 3 tests existants du tri de messagerie professionnel et 7 tests existants de sélection de créneaux publics.
- [x] Builds de production des deux frontends, incluant TypeScript et génération des pages.
- [x] ESLint ciblé sur les nouveaux tests, ainsi que sur la configuration publique modifiée.
- [x] Contrôles HTTP sur les builds locaux : accueils, connexions, redirections privées et page de réservation Gleamy Ink.
- [x] Optimisation réelle d'une image locale sur chaque serveur ; sources d'images hors liste autorisée refusées avec HTTP 400.
- [x] Nouvel audit npm : aucune alerte pour Next.js, sharp, @next, @img ou postcss dans les dépendances de production des deux frontends.
- [x] Serveurs de test de production locaux arrêtés après vérification.
- [ ] Versions corrigées déployées et parcours critiques vérifiés dans l'environnement cible, notamment connexion réelle et réservation complète sans création de données de test en production.

Résultats : **22 tests automatisés réussis** (12 nouveaux + 10 existants), deux
builds de production réussis, vérifications HTTP locales réussies.

Commandes communes aux deux frontends :

```sh
npm run test:security-images
npm run build
npm audit --omit=dev
```

Tests de non-régression existants :

```sh
# Frontend professionnel
node --test tests/inbox-order.test.cjs
# Frontend public
node --test components/RDV/Booking/slotRange.test.mjs
```

Les contrôles HTTP ont utilisé des processus temporaires limités à
`127.0.0.1:4311` et `127.0.0.1:4312`. Le test professionnel a fourni son URL et
son hôte approuvé via les variables du processus, sans modifier le `.env` ni la
configuration de production. Le premier essai avec l'ancien environnement
local a reproduit l'erreur Auth.js `UntrustedHost` et la redirection liée au
contrôle `!!req.auth` ; ce point est traité ensuite dans DEP-02 ci-dessous. Aucun test de
connexion avec des identifiants réels n'a été effectué.

Le build public émet un message `DYNAMIC_SERVER_USAGE` pendant la tentative de
pré-rendu de l'accueil ; il termine avec succès, classe l'accueil en rendu
dynamique et le contrôle HTTP de cette page retourne 200.

### Situation à la fin de DEP-01, avant DEP-02

| Dépôt | Critiques npm | Élevées npm | Modérées npm |
| --- | --- | --- | --- |
| Frontend professionnel | 3 | 11 | 5 |
| Frontend public | 2 | 8 | 4 |

À ce stade, les paquets encore classés critiques étaient `@auth/core`, `next-auth` et, pour le
frontend professionnel, `jspdf`. Ils restent suivis dans DEP-02 et DEP-03.
Les autres alertes relèvent de DEP-05 ; la liste globale ne doit pas être
considérée comme intégralement corrigée.

Références :
[avis SVG / images](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw),
[avis use cache](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr).

L'intervention DEP-02 ci-dessous traite ensuite Auth.js / NextAuth et les
contrôles de session des deux frontends.

## Intervention DEP-02 et SEC-07 — Authentification et mises à jour de session

État : corrigé et testé localement le 29 octobre 2026. Aucun déploiement effectué.
SEC-07 est traité dans cette intervention car il concerne les mêmes callbacks
et la même chaîne de confiance des sessions.

### Failles et corrections

- Les deux frontends utilisent désormais `next-auth` **5.0.0-beta.32**, épinglé
  dans les manifests et lockfiles, et `@auth/core` **0.41.3**. Les correctifs
  concernent notamment les erreurs de configuration traitées comme des sessions,
  la lecture des en-têtes Bearer malformés et la liaison des cookies OAuth aux
  fournisseurs. La version majeure v5 existante est conservée.
- `lib/auth-security.ts` centralise les contrôles : identité et rôle présents,
  absence d'erreur, session Auth.js non expirée et date d'expiration du jeton
  backend valide. Le décodage de cette date ne vérifie pas la signature et ne
  donne aucun droit API ; la vérification cryptographique et les autorisations
  restent assurées par le backend. Le jeton provient de la session Auth.js protégée.
- Les proxies et helpers serveur refusent les objets d'erreur, les identités
  incomplètes et les sessions expirées. Le contrôle professionnel `!!req.auth`
  est supprimé ; une erreur Auth.js ne déclenche plus une redirection de la
  connexion vers le dashboard.
- Les callbacks de mise à jour ne fusionnent plus `session.user` dans le JWT.
  Ils relisent **GET /auth** avec le jeton déjà détenu et `cache: no-store`.
  L'identifiant et le rôle doivent correspondre au compte de la session ; seuls
  les champs de profil explicitement sélectionnés peuvent être rafraîchis.
  Un changement de rôle doit passer par une nouvelle connexion.
- Le navigateur ne peut plus imposer un identifiant, un rôle administrateur,
  un jeton, un forfait ou un statut de vérification. Le forfait et le profil
  sont rafraîchis depuis la réponse authentifiée du backend. Une erreur réseau
  conserve le dernier état fiable ; un refus 401/403 rend la session inutilisable.
- Le frontend public traite également l'expiration du jeton backend. Son échange
  Google transmet uniquement `idToken` au backend corrigé dans SEC-01 ; un access
  token seul est refusé.

### Anciennes sessions et déploiement

Les anciens callbacks autorisaient une modification de champs sensibles. La
correction change donc aussi le nom des cookies pour empêcher la réutilisation
d'une session précédemment altérée :

| Application | Développement | Production |
| --- | --- | --- |
| Professionnelle | `inkera_pro_session_v2` | `__Secure-inkera_pro_session_v2` |
| Publique | `inkera_client_session_v2` | `__Secure-inkera_client_session_v2` |

Les cookies restent `HttpOnly`, `SameSite=Lax`, avec `Secure` en production.
Le nettoyage des sessions professionnelles traite aussi les nouveaux noms et
les cookies découpés en plusieurs fragments.

**Au déploiement, tous les utilisateurs devront se reconnecter une fois.** Les
mots de passe et les secrets de production ne sont pas modifiés. Aucune migration
de base de données n'est nécessaire. La révocation des JWT backend reste suivie
séparément dans SEC-11.

### Validation

- [x] 26 tests d'authentification professionnels et 25 tests publics : erreurs de configuration, identité absente, expiration, élévation de rôle, substitution de jeton, profil d'un autre compte, rafraîchissement fiable et échecs réseau / backend.
- [x] Tests des proxies : refus des sessions invalides, absence de boucle connexion / dashboard et contrôle administrateur du back-office.
- [x] Tests avec le vrai chiffrement Auth.js : les anciens cookies et leur contenu recopié sous le nouveau nom sont refusés ; les nouveaux cookies sont reconnus.
- [x] Tests avec le vrai lecteur JWT Auth.js sur des en-têtes Bearer malformés.
- [x] Non-régression des 12 tests d'images, 3 tests de tri de messagerie et 7 tests de créneaux.
- [x] TypeScript sur les deux projets, ESLint ciblé sur les fichiers modifiés et builds de production des deux frontends.
- [x] Vérification HTTP des deux builds : session absente, nouveau cookie, ancien cookie, contenu ancien recopié, expiration, contenu malformé, pages de connexion et redirections privées.
- [x] Vérification HTTP d'un processus professionnel avec secret absent : page privée redirigée vers la connexion, page de connexion accessible.
- [x] Audit npm : aucune alerte restante pour `next-auth`, `@auth/core`, `oauth4webapi` ou `jose`.
- [x] Trois processus temporaires de test arrêtés après validation.
- [ ] Déploiement des deux frontends, vérification de la configuration d'hôte Auth.js et reconnexion réelle par credentials / Google dans l'environnement cible.

Résultats : **73 tests automatisés réussis** (35 professionnels, 38 publics),
dont **51 nouveaux tests d'authentification**. Les builds, TypeScript et ESLint
ciblé sont validés.

Les tests HTTP ont utilisé les ports de bouclage 4311, 4312 et 4313, un secret
éphémère propre aux processus de test et des identités synthétiques. Aucune
connexion à un compte réel ni modification de données utilisateur n'a été
effectuée. Ces vérifications ne remplacent pas le contrôle du parcours OAuth
réel après déploiement.

Commandes dans les deux frontends :

```sh
npm run test:security-auth
npm run test:security-images
npm run build
npm audit --omit=dev
```

Suites combinées exécutées :

```sh
# Frontend professionnel
node --test tests/auth-security.test.cjs tests/image-pipeline.test.cjs tests/inbox-order.test.cjs
# Frontend public
node --test tests/auth-security.test.cjs tests/image-pipeline.test.cjs components/RDV/Booking/slotRange.test.mjs
```

### Audit npm après DEP-02

| Dépôt | Critiques npm | Élevées npm | Modérées npm |
| --- | --- | --- | --- |
| Frontend professionnel | 1 | 11 | 5 |
| Frontend public | 0 | 8 | 4 |

Le paquet encore classé critique sur le frontend professionnel est `jspdf`,
suivi dans DEP-03. Les alertes élevées / modérées restent suivies dans DEP-05.

Références :
[session et configuration](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-8fpg-xm3f-6cx3),
[cookies OAuth](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-x445-f3h2-j279),
[lecture Bearer](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-xmf8-cvqr-rfgj).

Intervention suivante réalisée : **DEP-03 — jsPDF et génération des documents PDF du
frontend professionnel** (voir ci-dessous).

Référence : [vérification serveur des jetons Google](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## DEP-03 — Génération des PDF professionnels

La bibliothèque `jspdf` passe de **3.0.4 à 4.2.1**, version épinglée. Sa
dépendance de compression `fflate` passe à **0.8.3** dans le verrou de dépendances.
Le paquet obsolète `@types/jspdf` est supprimé : jsPDF fournit ses propres types.

Les deux usages applicatifs ont été examinés : factures téléchargées et
consentements signés produits comme Blob avant envoi. Ils ne font pas appel aux
modes de sortie HTML concernés par l'avis jsPDF. La mise à jour supprime néanmoins
les versions vulnérables installées. Aucun changement de présentation ou de
logique métier des documents n'a été nécessaire.

### Validation

- [x] 9 nouveaux tests dans `tests/pdf-security.test.cjs`, exécutables avec `npm run test:security-pdf`.
- [x] Générateurs réels de factures : identité, artiste, montant, état payé / en attente, détails piercing, champs facultatifs et nom du téléchargement.
- [x] Générateur réel de consentement : signature PNG intégrée, informations du représentant légal et Blob PDF utilisable pour l'envoi.
- [x] Refus d'une signature PNG invalide, données ressemblant à du HTML conservées comme texte PDF sans action JavaScript, compression PDF fonctionnelle.
- [x] 44 tests professionnels réussis, incluant les tests existants d'authentification, d'images et de messagerie.
- [x] Build de production avec TypeScript et ESLint ciblé sur le nouveau test.
- [x] Audit npm de production : aucune alerte sur `jspdf`, `fflate` ou `fast-png` ; aucun paquet classé critique restant dans ce frontend.
- [ ] Déploiement du frontend professionnel et vérification dans le navigateur du téléchargement d'une facture et de l'envoi d'un consentement signé.

Après correction, l'audit npm professionnel compte **0 critique, 10 élevées et
4 modérées**. Ces alertes restantes ne sont pas considérées comme corrigées par
cette intervention. Le frontend public et le backend ne sont pas modifiés par
DEP-03. Aucun déploiement ni envoi de document client réel n'a été effectué.

Références : [avis de sécurité jsPDF](https://github.com/parallax/jsPDF/security/advisories/GHSA-wfv2-pwc8-crg5),
[version 4.2.1](https://github.com/parallax/jsPDF/releases/tag/v4.2.1),
[avis de sécurité fflate](https://github.com/advisories/GHSA-px8p-9vwx-vf98).

## DEP-04 — Proxies de confiance et adresse des limiteurs

`proxy-addr` passe de **2.0.7 à 2.0.8**, sans changement de version majeure
d'Express. L'avis CVE-2026-90711 concerne la confiance accordée à des adresses
IPv4 lors de certaines configurations de sous-réseaux IPv6.

Un autre contournement a été corrigé dans les guards d'inscription et de contact
public : ils lisaient directement la première valeur de `X-Forwarded-For`,
modifiable par l'appelant. Ils utilisent maintenant exclusivement `request.ip`,
calculé par Express selon une politique de confiance explicite.

### Configuration

La variable backend **`TRUSTED_PROXY_CIDRS`** accepte une liste d'adresses IP ou
de sous-réseaux CIDR séparés par des virgules. Sans valeur, aucun proxy n'est
considéré comme fiable. Les valeurs booléennes, le nombre de sauts, les noms
d'hôtes, les CIDR invalides et les réseaux `/0` sont refusés au démarrage.

Exemple **uniquement pour un proxy local confirmé**, à ne pas recopier comme
configuration de production sans vérifier la topologie :

```dotenv
TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
```

Utiliser de préférence la notation IPv4 native pour les plages IPv4. Le choix
des adresses / plages de production ne peut pas être déduit des fichiers du
dépôt : il reste à confirmer avec la chaîne réelle CDN / load balancer / proxy.
Sans cette configuration derrière un proxy, plusieurs visiteurs peuvent partager
son quota IP. **SEC-15b reste ouvert pour cette validation d'infrastructure.**

### Validation

- [x] 21 nouveaux tests : absence de confiance implicite, proxy autorisé / non autorisé, arrêt au premier intermédiaire non fiable et configurations invalides.
- [x] Test de régression de CVE-2026-90711 avec le vrai moteur Express.
- [x] Tests HTTP des deux guards : changer le préfixe de l'en-tête ne change pas le budget IP ; dépassement renvoyé en 429 avec `Retry-After`.
- [x] Non-régression : 145 tests réussis dans 6 suites (proxies, authentification, Google, SaaS et Stripe).
- [x] Build backend et ESLint des nouveaux fichiers.
- [x] Audit npm backend : aucune alerte `proxy-addr` ; 0 critique, 10 élevées et 5 modérées restantes, suivies séparément.
- [ ] Déploiement, configuration des proxies réels et vérification de l'IP client / des limites dans l'environnement cible.

Les tests HTTP utilisent des limiteurs en mémoire pour observer les clés et les
réponses des guards ; ils ne testent pas Redis ni les proxies de production.
Aucune modification de variable de production ni aucun déploiement effectué.

Références : [avis de sécurité proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h),
[politique Express derrière un proxy](https://expressjs.com/en/guide/behind-proxies/).

La [checklist après déploiement](security-post-deployment-checklist.md) est alimentée
à chaque correction et sera finalisée à la fin du chantier.

## SEC-03 — Suppressions UploadThing et preuve de propriété

Les deux routes `/api/uploadthing/delete` autorisaient une suppression à partir
d'une clé fournie par l'appelant, sans session ni contrôle du propriétaire.
Les uploads utilisaient tous la valeur fixe `salon-user`, qui ne permettait pas
de vérifier cette propriété.

### Correction

- Les routes exigent une session Auth.js utilisable et valident les clés : chaînes bornées, pas de doublons, au maximum 20 fichiers. Les contrats existants restent `{ fileKeys }` côté professionnel et `{ key }` côté public.
- Le backend autorise le lot entier à partir du JWT et du registre `UploadedFile`. Une clé inconnue, d'une autre application ou d'un autre propriétaire bloque tout le lot avant l'appel à UploadThing.
- Le propriétaire est enregistré depuis le callback serveur UploadThing, à partir de l'identité de session établie dans le middleware d'upload. Aucun endpoint client ne permet de revendiquer un fichier à partir de son URL.
- Le callback transmet une signature HMAC-SHA256 couvrant l'application, le propriétaire, la clé et l'horodatage. La fenêtre acceptée est de 5 minutes et les comparaisons sont faites en temps constant. L'enregistrement est idempotent et ne réattribue jamais une clé existante.
- Les origines navigateur étrangères sont refusées ; les requêtes doivent être JSON. Les réponses sont privées et non mises en cache. Les logs de clés et les détails d'erreurs du stockage ont été retirés des routes.
- Le nettoyage UploadThing de l'action administrateur exige également une autorisation du registre pour le compte explicitement ciblé. L'accès administrateur ne permet pas de supprimer une clé arbitraire trouvée dans une URL du profil.

Les uploads d'images invités des réservations et des liens de suivi sont
préservés, avec `userId: null` : ils ne confèrent aucun droit de suppression de
compte. Les documents professionnels et les consentements PDF exigent une
session. **SEC-10 reste ouvert** pour les capacités des uploads invités, les
permissions métier détaillées et les quotas.

### Migration et configuration requises avant livraison

Migration additive préparée :
`prisma/migrations/20261029150000_upload_file_ownership/migration.sql`.
Elle crée le registre `UploadedFile`, indexé par application / clé, avec une
relation vers le compte propriétaire. **Appliquée le 29 octobre 2026 à la base
configurée, identique à celle du backend Railway de production.** Prisma confirme
que les 25 migrations sont à jour. La table est accessible en lecture et vide
après création ; aucun fichier ni compte utilisateur n'a été modifié.

Créer deux secrets aléatoires indépendants d'au moins 32 octets d'entropie et
configurer les correspondances suivantes, sans préfixe `NEXT_PUBLIC_` :

| Backend | Frontend correspondant |
| --- | --- |
| `UPLOAD_OWNERSHIP_PRO_SECRET` | `UPLOAD_OWNERSHIP_SECRET` du frontend professionnel |
| `UPLOAD_OWNERSHIP_PUBLIC_SECRET` | `UPLOAD_OWNERSHIP_SECRET` du frontend public |

Ordre de livraison : migration additive, configuration des secrets et backend,
puis les deux frontends. Les anciennes routes frontend restent vulnérables tant
que ces frontends ne sont pas livrés. Les erreurs de registre / configuration
bloquent les suppressions ; un secret manquant bloque les nouveaux uploads
authentifiés avant leur envoi.

Configuration effectuée le 29 octobre 2026 à la demande de l'utilisateur :

- [x] Deux secrets indépendants générés avec 32 octets aléatoires chacun (encodage hexadécimal), sans affichage des valeurs.
- [x] Backend `.env` : `UPLOAD_OWNERSHIP_PRO_SECRET` et `UPLOAD_OWNERSHIP_PUBLIC_SECRET`.
- [x] `.env` de chaque frontend : `UPLOAD_OWNERSHIP_SECRET` correspondant. Les trois fichiers sont ignorés par Git.
- [x] Railway, projet `Inkera-Api`, service `Inkera-API`, environnement `production` : les deux variables backend ajoutées avec `--skip-deploys`, puis relues uniquement pour comparaison en mémoire.
- [x] Concordance des configurations et signatures HMAC vérifiée pour chaque paire frontend / backend. Aucun secret préexistant n'a été remplacé.
- [x] Ajout de `UPLOAD_OWNERSHIP_SECRET` dans chacun des projets frontend Vercel confirmé par l'utilisateur. Les valeurs n'ont pas été relues directement depuis Vercel ; leur concordance et leur activation restent à vérifier lors du déploiement.

Les variables Railway seront utilisées lors du prochain démarrage / déploiement
du service. Aucun déploiement ni redémarrage n'a été déclenché.

### Fichiers historiques et limites

Les fichiers antérieurs à la correction n'ont pas de preuve de propriété dans
ce registre. **Leur suppression physique est refusée**, y compris lors du
nettoyage d'un compte administrateur, tant qu'une reprise vérifiée n'a pas été
effectuée. Les parcours qui retirent déjà leur référence en base peuvent donc
laisser ces fichiers dans le stockage. Ne pas assimiler la disparition d'une
image de l'interface à sa suppression physique.

La reprise historique doit s'appuyer sur des preuves d'upload fiables, puis un
inventaire validé : les URL et clés actuelles des profils / moodboards sont
modifiables par les utilisateurs et ne suffisent pas à prouver la propriété.
Aucune reprise automatique ni suppression de fichier réel n'a été effectuée.
Le registre prouve le compte ayant téléversé le fichier ; il n'accorde pas une
délégation de suppression au salon lié ni au destinataire d'un message.

### Validation locale

- [x] 26 tests HTTP backend avec vraie validation DTO, stratégie JWT et signatures HMAC ; accès non authentifié, JWT forgé / expiré, signatures altérées / périmées, réattribution, lots mixtes et droits administrateur.
- [x] 33 tests frontend professionnel et 28 tests frontend public sur les handlers réels, les callbacks et le nettoyage administrateur ; aucun appel au stockage en cas de refus, y compris pour un refus dans le dernier lot d'un nettoyage de 25 fichiers.
- [x] Suites frontend combinées : 77 tests professionnels et 66 tests publics réussis, incluant les non-régressions d'authentification, d'images, de PDF, de messagerie et de réservation.
- [x] Génération du client Prisma, validation du schéma, comparaison du SQL de migration avec le diff Prisma attendu (sans connexion à la base) et build backend.
- [x] Builds de production et TypeScript des deux frontends ; ESLint ciblé sur les nouveaux helpers, routes, callbacks et tests.
- [x] Appliquer la migration et configurer les secrets locaux et du backend Railway ; vérifier la table et la concordance des signatures.
- [x] Ajout des secrets de production Vercel confirmé par l'utilisateur.
- [ ] Livrer les trois applications et vérifier la concordance des secrets et les callbacks UploadThing réels.
- [ ] Établir puis traiter l'inventaire historique vérifié ; contrôler la suppression physique et le nettoyage des comptes avec plus de 20 fichiers.

Les tests backend simulent les opérations Prisma ; les tests frontend simulent
les appels réseau et le stockage. Ils ne remplacent pas un upload / une
suppression de test dans l'environnement cible.

Référence : [callbacks et métadonnées des routes UploadThing](https://docs.uploadthing.com/file-routes).

## SEC-04 — Suivis post-tatouage et création d'historique

Les trois opérations de `/aftercare` et la création de `/tattoo-history`
étaient accessibles sans authentification. Les identifiants envoyés suffisaient
à créer ou modifier des données rattachées à une fiche client.

### Correction

- Les créations, modifications et suppressions de suivi post-tatouage exigent un JWT backend valide. L'identité utilisée vient de la requête authentifiée.
- Avant création, la fiche client doit appartenir au compte connecté. La relation Prisma est créée avec les conditions `id` et `userId` réunies, pour conserver cette exigence au moment de l'écriture.
- Avant modification ou suppression d'un suivi, le propriétaire de sa fiche client est vérifié. La requête d'écriture conserve aussi le filtre de propriété ; elle ne peut pas modifier la relation client.
- La création d'un historique de tatouage exige également un JWT et une fiche client appartenant au compte connecté. Une tentative sur le client d'un autre compte renvoie 403, sans création.
- Les réponses de suivi réussies conservent leur structure `{ error, message, aftercare }`. Un refus est désormais une erreur HTTP 401 / 403 ; un suivi absent renvoie 404. Les détails bruts des erreurs Prisma ne sont plus renvoyés par le service Aftercare.
- Les autorisations déjà présentes sur la réponse / suppression des soumissions de cicatrisation ont été vérifiées par des tests négatifs.

Le parcours public `GET /follow-up/requests/:token` et `POST /follow-up/submissions`
reste contrôlé par son jeton de suivi, ses règles d'expiration et de soumission
unique. Il n'est pas remplacé par l'API professionnelle Aftercare. Le simple
rattachement d'un tatoueur à un salon n'accorde pas de droit sur toutes ses fiches
CRM dans cette intervention.

### Validation locale

- [x] 29 nouveaux tests HTTP utilisant les contrôleurs et services réels, les DTO et la stratégie JWT ; Prisma et les emails sont simulés.
- [x] Rejet des JWT absents, expirés ou forgés sur les quatre opérations concernées avant l'accès aux données.
- [x] Refus des écritures sur les données d'un autre compte, sans mutation ni email ; succès pour le propriétaire légitime.
- [x] Tentatives de transfert de suivi vers un autre client ignorées par la validation DTO ; propriété conservée dans les écritures.
- [x] Non-régression de l'historique existant, de la validation des dates et du parcours public de cicatrisation : **80 tests réussis dans 7 suites**.
- [x] Build backend et ESLint ciblé sur le contrôleur, le service et les nouveaux tests Aftercare.
- [ ] Déployer le backend et effectuer les vérifications des parcours avec deux comptes distincts.

Aucune nouvelle migration, modification de données réelles, mise à jour frontend
ou opération de déploiement n'est nécessaire pour la validation locale de ce
point. La vérification des permissions des fichiers eux-mêmes reste suivie dans
SEC-03 / SEC-10 et dans les contrôles après déploiement.

## SEC-05 — Profils publics et comptes privés

La route publique `GET /users/:userId` appelait le même getter que `GET /auth`.
Pour un compte client, elle pouvait donc retourner l'email, le téléphone et le
profil client avec date de naissance. `GET /users/:userId/param` était également
public. Le contrôle de visibilité ne distinguait pas un compte professionnel
d'un compte client ayant la valeur de visibilité par défaut.

### Correction

- `GET /users/:userId` utilise désormais une méthode publique indépendante : seuls les rôles `user`, `user_salon` et `user_tatoueur` sont admissibles. Les autres rôles et profils masqués ne sont pas publiés.
- Les profils publics par identifiant et par slug partagent une liste explicite de champs Prisma, suivie d'une projection de réponse qui filtre aussi les relations imbriquées. Les champs `clientProfile`, `password`, `googleSubject`, les identifiants Stripe et les réglages privés de relance ne sont pas exposés par cette projection.
- Le guard commun aux ressources de profil public vérifie aussi le rôle professionnel du compte ciblé : un identifiant de compte client ne permet plus de parcourir ses ressources comme celles d'un salon.
- Les lectures publiques n'utilisent pas les clés Redis des comptes privés. Un ancien cache contenant une identité privée ne peut pas servir de réponse au nouveau getter public.
- `GET /users/:userId/param` exige un JWT et l'identité du propriétaire. Une nouvelle route `GET /users/:userId/private` applique les mêmes contrôles pour le formulaire de compte professionnel. Le rôle administrateur ne contourne pas ces routes propriétaire ; le back-office conserve ses propres endpoints autorisés.
- `GET /auth` conserve le getter privé et l'identité issue du JWT. Ses réponses et celles des deux routes privées portent `Cache-Control: private, no-store`.
- Le frontend professionnel utilise la nouvelle route privée pour modifier le compte, encode l'identifiant dans l'URL et désactive le cache des deux lectures privées.

Les coordonnées professionnelles déjà affichées publiquement (email, téléphone,
adresse), le nom public, les prestations, les horaires, le portfolio commercial,
les paramètres nécessaires à la réservation et les artistes liés sont conservés.
Les profils `SEARCH_HIDDEN` restent accessibles par lien direct ; les paramètres
d'un professionnel `HIDDEN` restent accessibles à son propriétaire sur les routes
privées. Cette correction ne remplace pas les contrôles d'accès aux rendez-vous,
CRM et moodboards suivis dans SEC-06.

### Validation locale

- [x] 24 nouveaux tests backend sur les contrôleurs / services réels avec stratégie JWT et guard global ; Prisma et Redis sont simulés.
- [x] Refus des comptes clients, administrateurs et formateurs sur les profils publics ; 404 pour les profils absents ou masqués.
- [x] Refus des lectures privées sans JWT, avec un jeton expiré / forgé ou depuis un autre compte ; succès du propriétaire avec ses champs privés et sans cache HTTP public.
- [x] Filtrage des champs imbriqués, absence d'utilisation du cache privé dans le getter public et sélection de rôle / visibilité lors de la résolution par slug.
- [x] 113 tests de non-régression existants : service et contrôleur utilisateurs, visibilité publique, surnoms et réservation d'artistes liés. Avec la nouvelle suite : **137 tests backend validés dans 7 suites**.
- [x] 6 nouveaux tests frontend des actions réelles : route privée, authentification, absence de cache, identifiant encodé et propagation d'un refus 403.
- [x] Builds backend et frontend professionnel avec TypeScript ; ESLint ciblé sur les nouveaux modules / tests et sur le guard public, ainsi que sur l'action frontend modifiée.
- [ ] Livrer le backend puis le frontend professionnel ; vérifier les profils publics et les paramètres privés avec des comptes de test distincts.

Aucune migration ni modification de données réelles effectuée. Le frontend public
ne nécessite pas de modification pour cette intervention. Les tests ne remplacent
pas la vérification des réponses réellement livrées et des éventuels caches CDN.

## SEC-06 — Identité des réservations, CRM et moodboards

Le parcours public acceptait `clientUserId` depuis le formulaire, ou retrouvait
un compte client à partir du seul email saisi. Cette identité déclarée pouvait
ensuite servir à lier une fiche CRM, un moodboard et une conversation. Les
créations de fiche, rendez-vous et détail de prestation étaient séparées : un
échec intermédiaire pouvait laisser des écritures partielles.

### Identité et fiches clients

- `BookingIdentityGuard` conserve le parcours invité lorsqu'aucun JWT n'est fourni. Un JWT fourni doit être valide, non expiré et porter un rôle client : il n'est jamais silencieusement dégradé en parcours invité.
- L'identité transmise au service provient exclusivement du principal authentifié. Le champ historique `clientUserId` reste accepté uniquement s'il correspond à ce principal ; une identité contradictoire est refusée. Le champ imbriqué est retiré par les DTO et n'est plus lu par le service.
- L'action serveur du frontend public ne transmet plus d'identifiant client déclaré et retire aussi ce champ d'un ancien objet de formulaire. Le JWT est toujours transmis par les headers serveur.
- Le compte client est relu dans la transaction sous verrou avant sa liaison. Les coordonnées d'un compte connecté viennent du compte, et l'email de notification utilise son email canonique.
- Pour un invité, aucune recherche de compte par email n'est faite, aucune conversation de compte n'est créée et aucune fiche CRM existante n'est revendiquée par rapprochement d'email.
- Pour un client connecté, seule une fiche déjà liée à son compte dans le salon concerné est réutilisée. Une ancienne fiche non liée ayant le même email reste distincte.
- Dans la création professionnelle, un email permet toujours de retrouver une fiche du salon, mais ne permet plus de découvrir ou de lier un compte Inkera. Une liaison existante peut être réutilisée.
- Une proposition explicitement acceptée par le client constitue aussi une preuve pour un premier rendez-vous professionnel. Cette acceptation est revérifiée et verrouillée dans la transaction ; elle permet de créer une nouvelle fiche liée, sans reprendre automatiquement le dossier historique non lié ni lire les autres champs privés du compte.

**Conséquence volontaire :** plusieurs réservations invitées peuvent créer des
fiches CRM distinctes pour le même email. Aucun rapprochement avec un ancien
dossier médical / historique n'est fait automatiquement. Une fusion future devra
s'appuyer sur une preuve ou une vérification autorisée, et non sur l'email seul.

### Moodboards et transactions

- Un client connecté peut joindre son propre moodboard. Un invité ne peut pas joindre un moodboard de compte et un identifiant appartenant à un autre compte est refusé avant la création de fiche.
- Un professionnel doit également disposer d'un contexte autorisé : projet publié non bloqué avec éligibilité au contact, proposition acceptée ou rendez-vous ayant déjà partagé le moodboard, pour le bon compte client. Une fiche CRM seule n'autorise pas tous les moodboards privés.
- Les connexions / déconnexions ultérieures conservent dans la condition d'écriture le client, le participant autorisé et le lien précédemment vérifié. Une modification concurrente ne permet pas d'écrire avec une autorisation devenue obsolète.
- La fiche CRM, le rendez-vous et son détail de prestation sont écrits dans une seule transaction pour les parcours public et professionnel. Les erreurs de validation dans la transaction provoquent aussi un rollback.
- La persistance du rendez-vous d'un artiste lié réutilise cette même transaction. Elle ne crée plus un commit autonome qui survivrait à l'échec du détail ou de la fiche.
- Emails, cache et messagerie sont traités après commit. Une erreur de notification ne transforme pas un rendez-vous enregistré en faux échec de création. Aucun nouveau mécanisme durable de reprise des notifications n'a été ajouté ; les échecs restent à surveiller et à reprendre selon les mécanismes existants.

Les contrôles d'horaires, blocages et conflits des artistes internes restent
suivis dans **SEC-08** : l'atomicité de ces écritures d'identité ne signifie pas
que toute la concurrence de réservation des créneaux est déjà corrigée.

### Validation locale

- [x] 30 nouveaux tests de réservation : vrais JWT et contrôleur HTTP pour l'identité ; service réel avec doubles Prisma transactionnels pour les écritures et échecs partiels.
- [x] Invité, compte connecté, identifiant usurpé, JWT forgé / expiré, mauvais rôle et compte devenu indisponible.
- [x] Absence de rapprochement par email, réutilisation d'une liaison dans le bon salon, destinataire de notification canonique et aucune conversation de compte pour un invité.
- [x] Moodboard propre / étranger, partage professionnel, projet publié, proposition acceptée et acceptation retirée avant verrouillage.
- [x] Rollback de la fiche et du rendez-vous lors d'un échec du détail pour les trois cas : invité, client connecté et professionnel. Notification tentée seulement après commit.
- [x] 2 nouveaux tests des conditions d'écriture de connexion / déconnexion de moodboard, et 1 test de réutilisation de la transaction par la persistance d'un artiste lié.
- [x] **116 tests backend réussis dans 6 suites**, incluant les régressions des rendez-vous, des moodboards et du tatoueur FREE dans un salon Business.
- [x] 5 nouveaux tests frontend de l'action réelle : JWT, suppression des identités déclarées, réponse 401, erreur métier et redirection vers un artiste lié.
- [x] Builds backend et frontend public avec TypeScript ; ESLint ciblé sur les nouveaux tests / guard et l'action frontend modifiée.
- [ ] Déployer le backend puis le frontend public et vérifier les parcours réels avec des comptes de test distincts.
- [ ] Revoir les liaisons historiques éventuellement créées sur la seule base d'un email ou d'un identifiant déclaré. Le correctif n'efface ni ne certifie rétroactivement ces associations.

Les scénarios de rollback simulent le comportement transactionnel de Prisma et
vérifient que les écritures utilisent le même client de transaction ; ils ne sont
pas des tests de panne sur la base de production. Aucun rendez-vous réel, email
client, migration ou déploiement n'a été effectué pour cette intervention.

Prochaine intervention : **SEC-08 — revalider l'éligibilité, les horaires, blocages et conflits des artistes internes à l'écriture du rendez-vous** (SEC-07 déjà traité).

## Intervention SEC-08 — Validation finale des créneaux internes

État : corrigé et testé localement le 29 octobre 2026 ; déploiement en attente.

### Faille et correction

Le filtrage des créneaux et certaines vérifications préalables ne constituaient
pas une garantie à l'écriture. Un appel direct pouvait contourner les horaires
ou l'ouverture des réservations d'un artiste interne. Deux demandes concurrentes
pouvaient toutes deux lire un créneau libre avant d'enregistrer un chevauchement.
Une erreur de lecture des disponibilités pouvait aussi être assimilée à un
créneau libre.

La création, le déplacement et la confirmation des rendez-vous internes passent
maintenant par une validation dans la transaction d'écriture, sous verrou de
l'agenda du salon. Les créations / modifications / suppressions d'indisponibilités
utilisent le même verrou. Les données du salon et de l'artiste sont relues après
verrouillage ; l'artiste doit toujours appartenir au salon. Les changements
d'artiste et la propriété du rendez-vous sont revérifiés lors du déplacement.

Pour une réservation publique, le serveur vérifie le rôle professionnel, la
visibilité, le forfait et son expiration, la prestation proposée, l'ouverture
des réservations de l'artiste et l'intervalle complet dans ses horaires publiés.
Les dates doivent être valides, futures et ordonnées. Les heures sont interprétées
en Europe/Paris, avec la même fonction pour l'affichage et la validation finale.
Le drapeau historique `User.appointmentBookingEnabled` n'est pas utilisé pour
réintroduire une restriction incompatible avec le parcours des salons.

Les réservations publiques et les saisies manuelles respectent les blocages et
les conflits PENDING / CONFIRMED, avec intervalles semi-ouverts : deux rendez-vous
adjacents sont possibles. PAR_TATOUEUR distingue les artistes, mais tient compte
des blocages globaux et des rendez-vous non assignés. GLOBAL réserve l'ensemble
du calendrier du salon. La saisie manuelle peut être hors des horaires publics ;
elle ne contourne pas les indisponibilités ou les conflits.

La confirmation transmet l'identité authentifiée de l'acteur et conserve un
prédicat de statut actif à l'écriture pour éviter de réactiver un rendez-vous
annulé ou terminé. Les erreurs de lecture des disponibilités interrompent la
réponse au lieu d'ouvrir des créneaux par défaut.

### Périmètre et livraison

Aucune migration ni nouveau secret. Livraison backend nécessaire. La politique
des artistes liés / résidences reste gérée par son parcours existant, avec tests
de régression pour les artistes FREE sponsorisés par un salon Business.

Le verrou garantit l'ordre des opérations : un blocage validé avant la
réservation la fait refuser. L'ajout ultérieur d'un blocage n'annule pas
automatiquement les rendez-vous déjà enregistrés. Les chevauchements historiques
ne sont pas corrigés automatiquement.

Les tests de concurrence locaux utilisent un double de transactions et un
verrou simulé ; le contrôle sur PostgreSQL réel est ajouté à la checklist de
préproduction / déploiement. Aucune action de charge ni mutation de production
n'a été effectuée pour cette intervention.

La fusion sécurisée de deux fiches client demandée par l'utilisateur est notée
dans la liste, à traiter après toutes les corrections de sécurité.

### Validation locale

**220 tests réussis dans 8 suites ciblées**, dont 46 nouveaux tests SEC-08.
Compilation backend réussie ; lint des nouveaux fichiers de politique et de
tests ainsi que de la fonction d'horaires réussi. Les premières exécutions ont
rencontré des erreurs transitoires de lecture de fichiers locaux ; les suites
concernées ont été relancées avec succès, sans modification des dépendances.

Les nouveaux tests couvrent l'éligibilité publique, l'appartenance de l'artiste,
les intervalles invalides, les horaires, les blocages et conflits, les changements
d'heure, les droits relus lors du déplacement et trois scénarios concurrents
(même artiste, artistes distincts, agenda GLOBAL). Ils vérifient aussi l'usage du
verrou lors de la création d'une indisponibilité et le passage de l'acteur
authentifié depuis le contrôleur de confirmation.

Les tests de régression couvrent les transactions d'identité SEC-06, les
créations / déplacements / confirmations existants, les créneaux et blocages,
ainsi que les résidences et réservations FREE sponsorisées.

Prochaine intervention : **SEC-09 — limitation des tentatives et sécurisation
des codes email**.

## Intervention SEC-09 — Limitation des tentatives et liens email

État : corrigé et testé localement le 29 octobre 2026 ; déploiement en attente.

### Failles et correction

Les connexions par mot de passe / Google, la vérification email, les demandes et
consommations de réinitialisation ainsi que la réservation publique n'avaient
pas de limitation dédiée. Les codes de vérification email à six chiffres
utilisaient `Math.random()` et étaient conservés en clair. La vérification et
la réinitialisation modifiaient le compte puis supprimaient le lien dans deux
opérations distinctes, permettant une consommation concurrente ou partielle.
La protection d'inscription existante autorisait les demandes en cas de panne
Redis et séparait l'incrément du compteur de son expiration.

Les routes sensibles sont protégées par des compteurs Redis partagés entre les
instances. Un script Lua incrémente le compteur et garantit son expiration en
une seule opération, y compris pour un ancien compteur sans TTL. Les identités
IP / email / compte sont hachées dans les clés. Les emails sont normalisés pour
la limitation ; aucun identifiant déclaré par le client ne remplace le principal
JWT pour le quota de compte. L'IP provient d'Express selon la politique de
proxies fiables DEP-04, jamais d'une lecture libre de `X-Forwarded-For`.

Les refus renvoient 429, `Retry-After` et `retryAfterSeconds`. Les compteurs ont
des fenêtres fixes ; une nouvelle demande refusée ne prolonge pas la fenêtre.
Une indisponibilité Redis ou un délai de plus de 1,5 seconde par opération
interrompt la demande en 503. Il n'y a pas de repli en mémoire ni d'autorisation
automatique sur panne. L'inscription utilise aussi ce moteur, en conservant ses
variables de configuration existantes avec validation des valeurs.

### Quotas par défaut

Toutes les demandes sont comptées, y compris celles valides ou rejetées ensuite
par la validation. Les plafonds s'appliquent séparément à chaque axe et chaque
type d'opération.

| Opération | IP | Email | Compte authentifié |
| --- | --- | --- | --- |
| Connexion mot de passe | 120 / 15 min | 10 / 15 min | — |
| Connexion Google | 120 / 15 min | — | — |
| Vérification email | 60 / 15 min | 10 / 15 min | — |
| Mot de passe oublié | 10 / 15 min | 3 / heure | — |
| Consommation réinitialisation | 20 / 15 min | 5 / 15 min | — |
| Changement mot de passe | 20 / 15 min | — | 5 / 15 min |
| Réservation publique | 60 / 15 min | 5 / 15 min | 10 / 15 min |
| Inscription (trois routes cumulées) | 10 / 15 min | 5 / heure | — |

Les plafonds hors inscription peuvent être adaptés avec
`SECURITY_RATE_LIMIT_<OPERATION>_<AXE>_MAX`, par exemple
`SECURITY_RATE_LIMIT_LOGIN_IP_MAX`. Opérations : `LOGIN`, `GOOGLE`, `VERIFY`,
`FORGOT`, `RESET`, `CHANGE`, `BOOKING` ; axes présents dans la table : `IP`,
`EMAIL`, `USER`. Un entier de 1 à 10000 est accepté ; une valeur absente,
invalide, négative ou nulle conserve le défaut. Les fenêtres restent fixes.
Ces variables sont facultatives et ne sont pas des secrets.

Vérifier en préproduction les appels serveur Vercel → Railway : plusieurs
utilisateurs peuvent partager une IP de sortie. Les quotas IP doivent être
adaptés au trafic observé, sans supprimer les quotas email / compte ni accepter
des en-têtes de provenance non authentifiés. Aucun quota basé sur l'identifiant
public du salon ne permet de bloquer tout un salon.

### Nouveaux liens email

Les deux usages génèrent 32 octets aléatoires cryptographiques, transmis sous
forme d'un secret hexadécimal de 64 caractères dans le lien. La base stocke
uniquement une empreinte SHA-256 préfixée, distincte selon l'usage vérification
ou réinitialisation. Le secret brut sert seulement à construire l'email.
Durées conservées : 10 minutes pour vérifier, 15 minutes pour réinitialiser.

L'émission et la consommation verrouillent le compte dans une transaction.
Un nouvel envoi révoque les précédents liens du même usage. La consommation
vérifie l'email, l'empreinte et l'expiration, réclame une suppression unique,
modifie le compte et invalide les autres liens du même usage dans la même
transaction. Une erreur annule ces écritures ensemble. Un mot de passe de
réinitialisation doit contenir au moins 8 caractères et ne pas dépasser les
72 octets UTF-8 pris en charge par bcrypt. Les entrées HTTP sont validées avant
la logique métier.

Le message de demande de réinitialisation reste identique pour un compte
existant ou absent. La révocation des JWT après changement de mot de passe
reste à traiter dans SEC-11.

### Livraison

Aucune migration de schéma ni nouveau secret. Déployer le backend ; les pages
de vérification existantes transmettent déjà le secret du lien sans imposer un
code à six chiffres. Les anciennes valeurs stockées en clair ne sont plus
acceptées, y compris les anciens liens de réinitialisation longs. Elles peuvent
rester dans les tables historiques jusqu'à nettoyage ; l'assertion « empreinte
uniquement » concerne les nouvelles émissions.

Après livraison, renvoyer les liens nécessaires via la connexion d'un compte
non vérifié ou « mot de passe oublié ». Les compteurs changent d'espace de clés
à la première livraison ; les quotas d'inscription démarrent donc une nouvelle
fenêtre. Les contrôles Redis / PostgreSQL réels et des parcours Vercel sont
ajoutés à la checklist de déploiement.

### Validation locale

**157 tests réussis dans 7 suites ciblées**, dont **41 nouveaux tests SEC-09** :
22 pour les compteurs / protections HTTP, 19 pour les liens et transactions.
Les régressions couvrent l'authentification existante, les contrôleurs auth et
rendez-vous, l'identité de réservation SEC-06 et les proxies fiables DEP-04.
Compilation backend et lint des nouveaux fichiers / moteur d'inscription
réussis. Aucune modification des sources frontend ni des dépendances.

Les tests HTTP utilisent les vrais guards et JWT avec un double Redis ; les
tests transactionnels simulent la sérialisation et le rollback. Les compteurs
entre instances, les erreurs Redis, le timeout, les plafonds email / compte,
les faux en-têtes d'IP et les refus avant appel métier sont couverts. Les liens
couvrent l'empreinte distincte par usage, le renvoi, l'expiration, la réutilisation,
la concurrence, l'échec d'écriture et les anciennes valeurs en clair.

Des lectures intermittentes de fichiers locaux ont interrompu certaines premières
exécutions. Les suites concernées ont été relancées avec succès, sans masquer
les erreurs ni changer les dépendances. Les vérifications sur Redis / PostgreSQL
réels restent explicitement dans la checklist de préproduction.

Prochaine intervention : **SEC-10 — autorisation des uploads, propriétaire réel
et quotas**.

## Intervention SEC-10 — Autorisation et quotas des uploads

État : corrigé et testé localement le 29 octobre 2026. Migration
**appliquée à la base configurée** (`inkstudio`, schéma `public`) à la demande
de l'utilisateur. Les 26 migrations sont à jour ; les 13 colonnes et les six
index de `UploadReservation` ont été vérifiés en lecture seule. Aucun déploiement
applicatif ni nettoyage de stockage effectué.

### Faille et correction

La route d'images des deux frontends acceptait les invités sans preuve d'un
parcours autorisé. Les limites de taille / nombre concernaient un seul envoi,
sans empêcher sa répétition. Une session suffisait pour les documents et les
consentements, sans contrôle du rôle ou du client concerné. Les images invitées
n'avaient pas de registre de contexte ni de budget permettant un nettoyage sûr.

Chaque middleware UploadThing demande maintenant au backend une autorisation
avant la génération d'une URL d'envoi. La requête est signée avec les secrets
serveur SEC-03 existants, sur une enveloppe distincte `upload-v2`, l'action,
l'application, le payload exact et l'horodatage. Une signature d'une autre
action / application ou de plus de cinq minutes est refusée. L'IP du demandeur
de préparation est limitée à 240 demandes / 15 minutes par le moteur SEC-09
(`SECURITY_RATE_LIMIT_UPLOAD_IP_MAX`, facultatif).

Le backend vérifie le JWT réellement fourni et relit le compte en base. Un JWT
invalide ne devient jamais une demande invitée. Les images publiques de compte
acceptent un compte client ou professionnel valide ; les images de l'application
professionnelle et les documents exigent un rôle professionnel / administrateur.
Un consentement PDF exige aussi l'identifiant d'un client CRM appartenant au
compte. Les contrôles métier sont refaits au callback, avant l'enregistrement.

Les usages invités sont explicites :

- Réservation : profil professionnel public et éligible, identité de navigateur
  temporaire signée dans un cookie HttpOnly / SameSite=Lax / Secure en production,
  valable 30 minutes. Le profil FREE d'un artiste reste accepté s'il dispose d'un
  salon Business actif avec les deux autorisations publiques de rattachement.
  Il s'agit d'une autorisation pour les images d'une réservation en préparation,
  pas de la preuve qu'un rendez-vous a déjà été créé.
- Suivi : possession du lien de suivi, encore valide et non soumis. Le budget
  est rattaché à la demande de suivi, même si le navigateur a une session. Le
  fichier n'est pas attribué artificiellement au compte du salon ou à un patient
  identifié seulement par email.

### Réservations de capacité et propriété

La table `UploadReservation` enregistre application, propriétaire éventuel,
contexte, budget, type déclaré, taille comptabilisée, échéance, état et clé de
stockage. Chaque fichier reçoit un identifiant opaque utilisé comme `customId`
UploadThing. Le callback doit correspondre à l'un des identifiants du middleware.
Il ne permet ni réattribution ni consommation avec une autre clé ; sa répétition
exacte reste idempotente.

La capacité est réservée en transaction sous verrous PostgreSQL partagés. Les
budgets de compte sont communs aux deux frontends, ceux des suivis sont communs
aux utilisateurs du même lien. Un budget global invité limite aussi les
changements de cookie et le nombre de petits fichiers. Les réservations prennent
la taille maximale du canal, pas une taille déclarée arbitrairement petite :
8 MiB par image / consentement, 32 MiB par document. Après un callback accepté,
la taille réelle fournie par le stockage remplace cette estimation. La propriété
SEC-03 et l'état COMPLETE sont enregistrés dans la même transaction.

Les types déclarés acceptés sont JPEG, PNG, WebP, GIF, AVIF, HEIC / HEIF et PDF
sur les canaux documentaires autorisés. SVG et PDF sur le canal images sont
refusés. Le nombre de documents est limité à un au total, même si la
configuration du fournisseur distingue PDF et image. Ce contrôle ne constitue
pas une analyse antivirus ni une inspection profonde du contenu des fichiers.

| Budget | Capacité totale | Volume quotidien UTC | Fichiers / jour UTC |
| --- | --- | --- | --- |
| Compte professionnel | 2048 MiB | 512 MiB | 200 |
| Compte client | 256 MiB | 128 MiB | 40 |
| Navigateur invité / lien de suivi | 40 MiB | 40 MiB | 10 |

Le pool global invité est limité à 20480 MiB et 10000 fichiers / réservations
encore comptabilisés. Les volumes sont ajustables avec
`UPLOAD_PRO_TOTAL_MB`, `UPLOAD_PRO_DAILY_MB`, `UPLOAD_CLIENT_TOTAL_MB`,
`UPLOAD_CLIENT_DAILY_MB`, `UPLOAD_GUEST_TOTAL_MB`, `UPLOAD_GUEST_DAILY_MB`,
`UPLOAD_GUEST_POOL_MB` ; entiers positifs jusqu'à 1024000 MiB, sinon défaut.
`UPLOAD_GUEST_POOL_FILES` accepte un entier de 1 à 1000000, sinon 10000.
Ces variables sont facultatives. Un transfert nécessite de la capacité libre
pour sa réservation maximale avant de pouvoir revenir à sa taille réelle.

Les compteurs journaliers conservent aussi les fichiers supprimés pour empêcher
de contourner la limite en alternant envoi et suppression. Les quotas techniques
ci-dessus concernent les **nouveaux transferts suivis**, pas un inventaire
rétroactif de tous les fichiers historiques. Les limites métier du portfolio
restent celles de ses propres endpoints.

### Expiration et nettoyage

Les URLs d'envoi du fournisseur expirent après 10 minutes ; l'acceptation d'un
callback est limitée à 20 minutes. Une échéance ou une erreur réseau ne libère
jamais automatiquement le quota. Un callback au résultat incertain ne supprime
pas non plus immédiatement un fichier qui pourrait avoir été enregistré.

Lors de la création transactionnelle d'une réservation ou d'une réponse de suivi,
les nouvelles images invitées connues sont rattachées au bon contexte. Les URLs
externes / historiques conservent leur contrat ; ce suivi ne revendique pas leur
propriété. Le nettoyage conserve les images invitées rattachées et tous les
uploads de compte terminés, sauf suppression physique explicitement demandée.

Chaque frontend fournit `scripts/cleanup-upload-reservations.cjs`, **en simulation
par défaut**. Il traite par lots de 100 les réservations sans callback et les
images invitées non rattachées de plus de 24 heures. En mode `--apply`, le backend
les réclame en état CLEANING sous le même verrou que le rattachement. Une photo
ainsi réclamée ne peut plus être rattachée à un nouveau rendez-vous / suivi.
Le stockage est ensuite supprimé par son `customId` et le quota libéré seulement
après succès du fournisseur ou confirmation exacte d'absence pour cet identifiant.
Une erreur laisse le quota conservé et le lot peut être repris. Le lookup exact
utilise l'API `getFileUrls` encore fournie par le SDK, plutôt qu'un inventaire
paginé non atomique susceptible de manquer un fichier.

Les suppressions ordinaires de fichiers de compte transmettent aussi un reçu
signé après la suppression physique. La capacité reste conservée en CLEANING
jusqu'au contrôle différé, après expiration des autorisations d'envoi. Le script
doit donc être exécuté régulièrement ; aucune tâche de production n'a été
installée ou lancée pendant cette intervention.

### Livraison et limites

- Migration additive : `20261029190000_upload_reservations`, à appliquer avant
  la livraison applicative. Aucun secret supplémentaire : réutilisation des
  secrets d'application SEC-03, avec séparation des usages par signature.
- Livrer le backend puis les deux frontends. Leurs appels SDK transmettent
  maintenant une entrée explicite ; réservation, suivi et consentement
  transmettent leur contexte. `core-new.ts` réexporte le routeur sécurisé au
  lieu de conserver un exemple d'upload ouvert.
- Les routes signées SEC-03 restent disponibles pour compatibilité de callbacks
  historiques ; les routeurs actifs utilisent exclusivement les réservations
  v2 pour les nouveaux transferts. La sécurisation complète exige donc la
  livraison des deux frontends, pas le seul déploiement backend.
- La reprise du stockage historique et de ses preuves de propriété reste
  inscrite dans SEC-03. Aucun ancien fichier n'est supprimé sur une simple
  supposition de propriétaire ou d'ancienneté.
- Cette correction autorise les **transferts** et leur comptabilisation ; elle
  ne transforme pas les URLs de stockage existantes en liens privés ni ne
  remplace les contrôles d'accès des ressources métier.

Les contrôles PostgreSQL / Redis / UploadThing réels et la surveillance des
quotas, refus et nettoyages sont ajoutés à la checklist de livraison.

### Validation locale

**194 tests ciblés validés** : 109 backend dans cinq suites (dont 43 nouveaux
tests de quota / autorisation et suivi expiré), 44 frontend professionnel et 41 frontend public
(dont 24 nouveaux tests de permis / callbacks). Les régressions couvrent la
propriété SEC-03, la réservation SEC-06 et les suivis publics. Les tests des
callbacks au résultat incertain garantissent qu'aucune suppression hasardeuse
n'est effectuée.

Les builds des trois applications ont réussi. Après la dernière modification
des callbacks, les tests et la vérification TypeScript des deux frontends ont
été relancés avec succès. Schéma Prisma validé, client généré, lint des nouveaux
fichiers backend et syntaxe des scripts de nettoyage validés. Les premières
erreurs de compilation liées à l'entrée explicite / aux tableaux readonly du SDK
ont été corrigées et les contrôles relancés.

Les services réseau, les compteurs SQL et les verrous sont simulés dans les
tests de sécurité locaux. Aucune preuve de concurrence PostgreSQL réelle,
d'upload UploadThing réel ou de nettoyage effectif n'est déduite de ces tests.
Ces opérations restent à vérifier en préproduction selon la checklist.

Prochaine intervention : **DEP-05 — autres alertes de dépendances élevées et
modérées**, avant les points de priorité moyenne SEC-11 et suivants.
