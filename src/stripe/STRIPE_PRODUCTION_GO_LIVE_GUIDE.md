# Stripe - Guide de Passage en Production

## 1. Objectif

Ce guide décrit **toute la démarche** pour passer de Stripe Test a Stripe Production (Live) sur ce backend.

Il couvre:
- la preparation Stripe Dashboard
- la configuration backend
- le deploiement
- les tests de validation
- le plan de rollback

---

## 2. Rappel du fonctionnement actuel dans le projet

### 2.1 Plans geres
- `FREE`
- `PRO`
- `BUSINESS`

### 2.2 Endpoints Stripe importants
- `POST /stripe/checkout`
- `POST /stripe/change-plan`
- `POST /stripe/webhook`

### 2.3 Evenements webhook traites
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

### 2.4 Variables d'environnement Stripe utilisees
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_BUSINESS`
- `FRONTEND_URL`
- `FRONT_URL` (utilisee pour CORS dans la config actuelle)

---

## 3. Pre-requis avant bascule Live

- [ ] Avoir acces Stripe Dashboard avec droits admin
- [ ] Avoir le domaine frontend de production (HTTPS)
- [ ] Avoir le domaine backend/API de production (HTTPS)
- [ ] Avoir un environnement backend de production deployable
- [ ] Avoir un plan de rollback en cas d'incident

Important:
- Les objets Stripe Test et Live sont separes.
- Une cle Test ne fonctionne pas en Live.
- Un `price_...` Test ne fonctionne pas en Live.

---

## 4. Procedure detaillee pas a pas

## 4.1 Etape 1 - Creer les ressources Stripe en mode Live

1. Ouvrir Stripe Dashboard.
2. Basculer en **mode Live** (pas Test).
3. Creer (ou dupliquer) les produits/plans pour:
   - PRO
   - BUSINESS
4. Verifier le type de prix (mensuel/annuel selon ton business).
5. Noter les IDs Live:
   - `price_live_pro`
   - `price_live_business`

Checklist:
- [ ] Produit PRO Live cree
- [ ] Produit BUSINESS Live cree
- [ ] Price ID Live PRO note
- [ ] Price ID Live BUSINESS note

---

## 4.2 Etape 2 - Recuperer les cles Live Stripe

Dans Stripe Dashboard (Live):
1. Recuperer la cle secrete Live: `sk_live_...`
2. Conserver la cle publishable Live pour le frontend: `pk_live_...`

Checklist:
- [ ] Cle secrete Live recuperee
- [ ] Cle publishable Live recuperee

---

## 4.3 Etape 3 - Configurer les variables d'environnement backend

Mettre a jour les variables de **l'environnement de production**:

| Variable | Valeur attendue en production |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_PRICE_PRO` | `price_...` Live du plan PRO |
| `STRIPE_PRICE_BUSINESS` | `price_...` Live du plan BUSINESS |
| `FRONTEND_URL` | URL frontend prod en HTTPS |
| `FRONT_URL` | Meme URL frontend prod en HTTPS |
| `NODE_ENV` | `production` |

Note importante:
- Dans ce code, `FRONTEND_URL` est utilisee dans plusieurs services, mais `FRONT_URL` est encore utilisee pour le CORS principal.
- Pour eviter les surprises en production, mets **les deux** a la meme valeur.

Exemple de bloc de variables (sans secrets reels):

```env
NODE_ENV=production
PORT=3000

FRONTEND_URL=https://app.ton-domaine.com
FRONT_URL=https://app.ton-domaine.com

STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
STRIPE_PRICE_PRO=price_xxxxxxxxxxxxx
STRIPE_PRICE_BUSINESS=price_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

Checklist:
- [ ] Toutes les variables Live Stripe renseignees
- [ ] `FRONTEND_URL` et `FRONT_URL` coherentes
- [ ] Secrets stockes dans un coffre/secrets manager

---

## 4.4 Etape 4 - Configurer le webhook Stripe Live

1. Dans Stripe Dashboard Live, creer un endpoint webhook:
   - `https://api.ton-domaine.com/stripe/webhook`
2. Selectionner les evenements:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
3. Copier le secret webhook (`whsec_...`) dans `STRIPE_WEBHOOK_SECRET`.

Checklist:
- [ ] Endpoint webhook Live cree sur `/stripe/webhook`
- [ ] Evenements requis actives
- [ ] `STRIPE_WEBHOOK_SECRET` mis a jour cote backend

---

## 4.5 Etape 5 - Deployer le backend en production

Ordre recommande:

1. Build applicatif:
```bash
npm run build
```

2. Demarrage production:
```bash
npm run start:prod
```

3. Verifier que l'API repond (healthcheck/probe de ton infra).

Checklist:
- [ ] Build OK
- [ ] Service demarre
- [ ] Logs sans erreur Stripe au boot

---

## 4.6 Etape 6 - Validation fonctionnelle apres deploiement

Faire un test reel bout en bout (petit montant si possible):

### Cas A - Nouvelle souscription payante
1. Creer un compte utilisateur.
2. Lancer un checkout PRO ou BUSINESS.
3. Payer en Live.
4. Verifier:
   - webhook recu
   - `stripeCustomerId` present
   - `stripeSubscriptionId` present
   - plan local mis a jour (PRO ou BUSINESS)

### Cas B - Changement de plan payant vers payant
1. Utilisateur deja en PRO.
2. Passer a BUSINESS via `POST /stripe/change-plan`.
3. Verifier update direct et synchro locale.

### Cas C - Passage vers FREE
1. Demander FREE via `POST /stripe/change-plan`.
2. Verifier que la fin est **planifiee en fin de periode** (pas coupure immediate si mois deja paye).
3. Verifier la date de fin (`currentPeriodEnd`) et la bascule finale via webhook.

Checklist:
- [ ] Cas A valide
- [ ] Cas B valide
- [ ] Cas C valide
- [ ] Webhooks recus sans erreur

---

## 4.7 Etape 7 - Monitoring des premieres 24h

Surveiller:
- taux d'erreur endpoint `/stripe/webhook`
- erreurs 4xx/5xx sur endpoints Stripe
- creation de souscription incomplete
- desynchronisation plan local vs Stripe

Alertes recommandees:
- echec verification signature webhook
- webhook non traite
- absence de webhook apres checkout reussi

Checklist:
- [ ] Monitoring applicatif actif
- [ ] Alerting configure
- [ ] Aucune anomalie critique sur 24h

---

## 5. Plan de rollback (si incident)

Si incident critique apres passage Live:

1. Geler les nouveaux achats (feature flag/maintenance sur abonnement).
2. Revenir sur la derniere release stable backend.
3. Verifier les webhooks en erreur dans Stripe Dashboard.
4. Corriger les variables ou mapping prix si besoin.
5. Rejouer les events manques si necessaire.

Important:
- Ne pas melanger objets Test et Live pour corriger un incident Live.
- Toujours corriger dans le mode correspondant.

---

## 6. Checklist finale Go-Live (resume executif)

- [ ] Produits/prix crees en Live
- [ ] `STRIPE_SECRET_KEY` en `sk_live_...`
- [ ] `STRIPE_PRICE_PRO` et `STRIPE_PRICE_BUSINESS` en Live
- [ ] Webhook Live configure sur `https://.../stripe/webhook`
- [ ] `STRIPE_WEBHOOK_SECRET` Live configure
- [ ] `FRONTEND_URL` et `FRONT_URL` alignes
- [ ] Build + demarrage prod OK
- [ ] Parcours de paiement reel valide
- [ ] Changement de plan valide
- [ ] Passage FREE avec fin de periode valide
- [ ] Monitoring 24h en place

---

## 7. Annexe - Erreurs frequentes a eviter

1. Utiliser une cle `sk_test_...` en production.
2. Mettre un `price_...` Test dans une variable Live.
3. Pointer le webhook sur `/webhook` au lieu de `/stripe/webhook`.
4. Oublier de mettre une URL frontend avec schema (`https://...`).
5. Avoir `FRONTEND_URL` et `FRONT_URL` differents et provoquer des problemes CORS.

---

## 8. Statut du document

Version: 1.0  
Date: 2026-03-18  
Scope: Passage Stripe Test -> Stripe Live pour tattoo-studio-back
