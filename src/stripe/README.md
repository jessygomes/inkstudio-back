# Stripe Module README

## Objectif
Ce module gere la facturation SaaS avec Stripe pour 3 plans:
- FREE
- PRO
- BUSINESS

Il couvre:
- creation d'abonnement (checkout)
- changement de plan (upgrade/downgrade)
- annulation (retour FREE)
- synchronisation via webhooks
- consultation des factures
- acces au portail client Stripe

## Endpoints exposes
- `POST /stripe/checkout` (auth): creation d'une session checkout pour PRO/BUSINESS
- `POST /stripe/change-plan` (auth): changement de plan global (FREE/PRO/BUSINESS)
- `GET /stripe/invoices` (auth): historique de facturation pagine
- `GET /stripe/portal` (auth): URL du portail client Stripe
- `POST /stripe/webhook` (public): reception des evenements Stripe

## Regles de base
- Le backend essaie toujours de reutiliser une souscription Stripe existante avant de recreer un checkout.
- Le backend conserve en base les IDs Stripe (`stripeCustomerId`, `stripeSubscriptionId`) pour garder un lien fiable avec Stripe.
- Les changements d'etat critiques sont resynchronises via webhooks pour rester coherents meme si un evenement vient de Stripe Dashboard.

## Flux metier par cas

### 1) FREE -> PRO/BUSINESS
1. Le front appelle `POST /stripe/checkout` avec `plan`.
2. Le backend cree (ou recupere) le customer Stripe.
3. Le backend cree une session Stripe Checkout (`mode=subscription`).
4. Le front redirige l'utilisateur vers l'URL Stripe.
5. Une fois paiement valide, Stripe envoie `checkout.session.completed`.
6. Le webhook met a jour:
   - `saasPlan` vers PRO ou BUSINESS
   - `stripeSubscriptionId`

Quand est-ce que l'utilisateur paye ?
- Il paye au moment de la validation du checkout sur Stripe.

### 2) PRO <-> BUSINESS pendant une periode en cours
1. Le front appelle `POST /stripe/change-plan` avec `plan` payant.
2. Le backend cherche une souscription active reutilisable.
3. Si trouvee, il met a jour la souscription directement avec:
   - nouveau prix
   - `cancel_at_period_end=false`
   - `proration_behavior=create_prorations`
4. Le backend renvoie `updated: true` (pas de redirection checkout).

Quand est-ce que l'utilisateur paye ?
- L'acces au nouveau plan est applique tout de suite.
- Stripe calcule un prorata sur le restant de la periode.
- Avec `create_prorations`, l'ajustement est en general porte sur la prochaine facture (pas forcement debite immediatement).

### 3) PRO/BUSINESS -> FREE
1. Le front appelle `POST /stripe/change-plan` avec `plan=FREE`.
2. Si une souscription active existe, le backend programme:
   - `cancel_at_period_end=true`
3. Le plan payant reste actif jusqu'a la fin deja payee.
4. Le backend stocke la date de fin via `saasPlanUntil`.
5. A la fin, Stripe emet les evenements (update/delete) et le webhook repasse l'utilisateur en FREE.

Quand est-ce que l'utilisateur paye ?
- Pas de nouveau paiement.
- L'utilisateur consomme simplement la fin de periode deja payee.

### 4) Aucun abonnement Stripe actif mais demande FREE
- Le backend bascule directement en FREE localement.
- `stripeSubscriptionId` est nettoye.

### 5) Souscription locale perimee/invalide
- Si `stripeSubscriptionId` n'existe plus chez Stripe (`resource_missing`), le backend:
  - nettoie l'ID local
  - tente un fallback par `stripeCustomerId`
  - reprend une souscription valide si disponible

## Webhooks traites
Le endpoint `POST /stripe/webhook` verifie la signature avec `STRIPE_WEBHOOK_SECRET`.

Evenements geres:
- `checkout.session.completed`
  - active le plan payant et enregistre `stripeSubscriptionId`
- `customer.subscription.updated`
  - synchronise plan/prix, date de fin planifiee, et ID abonnement
  - si statut `canceled`, bascule FREE
- `customer.subscription.deleted`
  - bascule FREE et nettoie `stripeSubscriptionId`

Important:
- Le payload brut est requis pour verifier la signature Stripe.

## Factures et portail

### Factures (`GET /stripe/invoices`)
- Retourne un historique pagine (page/limit).
- Inclut:
  - montant
  - devise
  - statut
  - periode
  - lien PDF
  - lien hosted Stripe

### Portail client (`GET /stripe/portal`)
- Ouvre le portail Stripe pour:
  - gestion moyen de paiement
  - historique complet
  - telechargement factures

## Variables d'environnement requises
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_BUSINESS`
- `FRONTEND_URL` (ou `FRONT_URL`)

## Reponses utiles pour le frontend

### `POST /stripe/checkout`
- `updated=false` + `url`: redirection checkout necessaire
- `updated=true`: plan deja ajuste sans checkout

### `POST /stripe/change-plan`
- vers plan payant:
  - `updated=false` + `url` => ouvrir checkout
  - `updated=true` => changement direct effectue
- vers FREE:
  - `scheduledPlan=FREE`
  - `currentPeriodEnd` peut etre fourni
  - `alreadyScheduled` indique si la fin etait deja planifiee

## FAQ rapide

### Upgrade en milieu de mois: paiement immediat ?
- Pas toujours immediat dans la config actuelle.
- Le changement de droits est immediat.
- Le cout supplementaire est calcule au prorata puis generalement regularise sur la prochaine facture.

### Comment forcer un paiement immediat a l'upgrade ?
- Changer la strategie Stripe (ex: invoice immediate type `always_invoice`) puis finaliser/payer la facture dans le flux.

## Points d'attention techniques
- Garder `STRIPE_WEBHOOK_SECRET` strictement configure en prod.
- Verifier que la route webhook recoit bien le body brut.
- Ne jamais faire confiance uniquement au retour frontend: l'etat source de verite final reste Stripe + webhooks.
- Toujours resynchroniser les IDs Stripe en base locale apres update/recovery.
