# Instagram Business Login — Inkera Studio

Ce connecteur ajoute les messages privés Instagram à l'Inbox existante d'Inkera Studio, sans modifier les conversations natives Inkera.

## 1. Configurer Meta Developers

Dans l'application Meta **Inkera Studio-IG** :

1. Activer l'API Instagram avec **Instagram Login** (connexion avec un compte professionnel Instagram).
2. Ajouter les autorisations `instagram_business_basic` et `instagram_business_manage_messages`.
3. Configurer l'URI de redirection OAuth **exacte** :
   `https://VOTRE-BACKEND/messaging/instagram/callback`
4. Dans les Webhooks Instagram, déclarer l'URL de rappel :
   `https://VOTRE-BACKEND/messaging/instagram/webhook`
5. Renseigner le **même jeton de vérification** dans Meta et `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`.
6. S'abonner au champ **`messages`**. L'application appelle aussi `/{ig-user-id}/subscribed_apps` lors de chaque connexion de compte.

> Les deux URL doivent être accessibles en HTTPS sur le backend NestJS (Railway), pas sur le frontend Vercel. Utiliser le domaine réel du backend et recopier les URL caractère par caractère dans Meta.

## 2. Variables d'environnement du backend

Ajouter les variables de `instagram.env.example` dans Railway et dans le `.env` backend local. Garder leurs valeurs secrètes. Il n'est **pas** nécessaire d'insérer le jeton de test généré dans Meta dans le frontend ni dans la base : les salons autorisent **leur propre compte** grâce au bouton « Connecter Instagram » de l'Inbox.

Générer une clé de chiffrement aléatoire, conservée durablement :

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Utiliser sa sortie pour `INSTAGRAM_TOKEN_ENCRYPTION_KEY`. Générer une **autre** valeur longue et aléatoire pour `INSTAGRAM_OAUTH_STATE_SECRET` et un jeton distinct pour `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`. Ne jamais changer la clé de chiffrement sans migration des jetons enregistrés, sinon les comptes devront être reconnectés.

`INSTAGRAM_STUDIO_RETURN_URL` est l'URL **complète de la page Inbox Studio** où l'utilisateur revient après OAuth, par exemple `https://VOTRE-FRONTEND/chemin/de/votre/inbox`. Ne pas la confondre avec l'URI OAuth du backend.

## 3. Déploiement

Déployer le backend avec sa nouvelle migration Prisma :

```bash
npx prisma migrate deploy
npm run build
```

Déployer également la nouvelle version du frontend, puis ouvrir l'Inbox > **Instagram** > **Connecter Instagram** et autoriser `the.inkera` pour le premier essai.

Les jetons d'accès sont chiffrés en AES-256-GCM dans PostgreSQL. Le front ne les reçoit jamais. Les jetons longue durée sont renouvelés lorsqu'une connexion est utilisée et approche de son expiration (ce MVP n'inclut pas encore de renouvellement planifié en arrière-plan).

## 4. Vérification de bout en bout

1. Meta valide le GET de vérification du Webhook.
2. Le compte pro `the.inkera` est connecté dans l'Inbox ; son statut passe à « Connecté ». Un statut « Webhooks à vérifier » signifie que l'abonnement du compte à Meta n'a pas été confirmé.
3. Depuis **un autre compte Instagram autorisé pour le test**, envoyer un nouveau DM à `the.inkera`.
4. Le DM apparaît en direct dans l'onglet Instagram de l'Inbox, avec le compteur de non-lus ; sélectionner le fil marque les messages comme lus.
5. Répondre dans l'Inbox Studio, puis vérifier sa réception dans Instagram. Refaire l'essai avec une photo et sur mobile.
6. Déconnecter puis reconnecter le compte, et vérifier que les échanges précédemment synchronisés restent visibles.

## 5. Limites et autorisations Meta

- L'Inbox synchronise **les nouveaux messages livrés par le Webhook après activation**. L'import des anciens DM Instagram n'est pas encore inclus.
- Les réponses automatiques libres ne sont pas autorisées : une réponse est limitée ici à la fenêtre de **24 heures après le dernier message reçu**. Si la fenêtre est expirée, le client doit écrire à nouveau.
- Un message envoyé peut comporter du texte et une image : le texte et l'image sont envoyés séparément à Instagram. Les autres formats média ne sont pas pris en charge dans ce premier connecteur.
- Les événements de lecture et d'autres événements Instagram ne sont pas encore synchronisés dans les deux sens.
- En **mode Développement Meta**, seuls les comptes disposant des rôles appropriés peuvent généralement tester. Pour permettre aux salons et tatoueurs externes à l'équipe Inkera de connecter leurs comptes, il faut les autorisations **Advanced Access** et la validation/activation requises par Meta.
- Les conversations externes ne sont **pas automatiquement associées** à un client Inkera : le salon peut utiliser les fonctions CRM existantes pour faire le rapprochement.

## 6. Diagnostic

| Symptôme | Vérification |
| --- | --- |
| La connexion redirige vers une erreur | `INSTAGRAM_APP_ID`, secret, scopes et **URI OAuth identique** dans Meta |
| Statut « Webhooks à vérifier » | Champ `messages`, webhook public HTTPS, autorisations et app Meta |
| Aucun DM n'arrive | Les événements sont-ils présents dans Meta ? Un autre compte de test a-t-il envoyé un **nouveau** message ? |
| Réponse refusée | Connexion active, droit de messagerie, fenêtre des 24 h et URL HTTPS pour les images |
| Reconnexion requise | Jeton expiré/révoqué ou clé de chiffrement changée |

N'enregistrer **aucun jeton d'accès** dans les logs ou dans les tickets support.
