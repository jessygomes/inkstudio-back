# Stripe - Guide Production et Billing Lifecycle

## 1. Objectif

Ce document est la reference Stripe pour ce backend:
- passage en production Stripe Live
- cycle de vie complet abonnement (trial, paiement, echec, downgrade)
- webhooks et idempotence
- checklist de validation et runbook incident

Date de mise a jour: 2026-05-22

---

## 2. Perimetre fonctionnel implemente

### 2.1 Plans supportes
- FREE
- PRO
- BUSINESS

### 2.2 Endpoints Stripe exposes
- POST /stripe/checkout
- POST /stripe/change-plan
- POST /stripe/webhook
- GET /stripe/invoices
- GET /stripe/portal

### 2.3 Regles metier validees
- Une souscription payante est creee via Stripe Checkout avec 30 jours d'essai.
- Stripe envoie trial_will_end (J-3 en general) et le backend envoie un email de rappel au salon.
- En cas d'echec de paiement, le compte passe en PAST_DUE sans restriction immediate.
- Si paiement reussi ensuite, retour automatique en ACTIVE.
- Si le compte reste en PAST_DUE plus de 5 jours, downgrade automatique vers FREE.

---

## 3. Implementation technique (etat actuel)

### 3.1 Checkout avec trial 30 jours
Dans Stripe checkout session:
- payment_method_collection: always
- subscription_data.trial_period_days: 30

Objectif:
- collecter un moyen de paiement
- laisser 30 jours gratuits avant la premiere tentative de facturation

### 3.2 Webhooks traites
Le backend traite:
- checkout.session.completed
- customer.subscription.trial_will_end
- invoice.payment_failed
- invoice.payment_succeeded
- customer.subscription.updated
- customer.subscription.deleted

### 3.3 Idempotence webhook
Chaque event Stripe est enregistre dans la table StripeWebhookEvent.
- eventId unique
- en cas de re-livraison du meme event, le backend ignore le doublon

Cela evite les doubles transitions de plan et les doubles envois email.

### 3.4 Synchronisation statut Stripe vers plan local
La synchro locale se fait selon le status Stripe:
- trialing -> markSubscriptionTrialing(...)
- past_due ou unpaid -> markSubscriptionPastDue(...)
- active (et cas nominal) -> markSubscriptionActive(...)

### 3.5 Gestion PAST_DUE et downgrade J+5
Un job Bull quotidien (08:00) execute:
- downgradeExpiredPastDueUsers(5)

Logique:
- cible uniquement les comptes PRO/BUSINESS en PAST_DUE
- si pastDueSince <= now - 5 jours -> passage en FREE
- statut local mis a EXPIRED

### 3.6 Email J-3 (fin d'essai)
Sur customer.subscription.trial_will_end:
- recherche utilisateur local via subscription/customer Stripe
- envoi mail au salon (adresse du compte salon)
- template centralise via EmailTemplateService (pas de HTML inline)

Preview dev disponible:
- GET /dev/email-preview?template=trial-ending-soon

---

## 4. Schema Prisma requis

### 4.1 Enum
SaasPlanStatus contient:
- ACTIVE
- PAST_DUE
- EXPIRED
- CANCELED
- TRIAL

### 4.2 SaasPlanDetails
Champs utilises par le lifecycle billing:
- trialEndDate DateTime?
- lastPaymentDate DateTime?
- nextPaymentDate DateTime?
- pastDueSince DateTime?

Index important:
- @@index([pastDueSince])

### 4.3 Idempotence
Nouveau modele:
- StripeWebhookEvent

Champs:
- eventId unique
- eventType
- createdAt

---

## 5. Variables d'environnement Stripe

Obligatoires:
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- STRIPE_PRICE_PRO
- STRIPE_PRICE_BUSINESS

Frontend/redirect:
- FRONTEND_URL
- FRONT_URL

Recommandation:
- mettre FRONTEND_URL et FRONT_URL a la meme valeur HTTPS en production

Exemple (sans secrets reels):

```env
NODE_ENV=production
FRONTEND_URL=https://app.ton-domaine.com
FRONT_URL=https://app.ton-domaine.com

STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_PRO=price_xxx
STRIPE_PRICE_BUSINESS=price_xxx
```

---

## 6. Configuration webhook Stripe Dashboard (Live)

Endpoint:
- https://api.ton-domaine.com/stripe/webhook

Events a cocher:
- checkout.session.completed
- customer.subscription.trial_will_end
- invoice.payment_failed
- invoice.payment_succeeded
- customer.subscription.updated
- customer.subscription.deleted

Important:
- ne pas melanger objets test/live (cles, price, webhook secret)

---

## 7. Verification et tests

### 7.1 Tests automatises cibles
- src/stripe/stripe.controller.spec.ts
- src/saas/saas.service.spec.ts

Resultat actuel:
- 6 passed
- 0 failed

### 7.2 Cas metier a valider en environnement
1. Souscription PRO/BUSINESS depuis FREE
2. Reception trial_will_end et envoi email salon
3. invoice.payment_failed -> statut PAST_DUE sans blocage
4. invoice.payment_succeeded -> retour ACTIVE
5. PAST_DUE > 5 jours -> downgrade FREE par job quotidien

---

## 8. Observabilite et exploitation

A monitorer:
- erreurs 4xx/5xx sur /stripe/webhook
- erreurs de verification signature
- ecart plan local vs statut Stripe
- volume des comptes en PAST_DUE

Alertes conseillees:
- event webhook non traite
- hausse anormale invoice.payment_failed
- absence de webhook apres checkout reussi

---

## 9. Runbook incident

Si incident critique:
1. Geler temporairement les nouveaux achats (flag frontend/back)
2. Verifier STRIPE_SECRET_KEY, prices live, webhook secret
3. Verifier endpoint webhook et events coches
4. Analyser logs webhook + table StripeWebhookEvent
5. Corriger puis redelivrer les events necessaires depuis Stripe Dashboard

---

## 10. Limites connues

- Les tests cibles Stripe/SaaS sont verts.
- La suite de tests complete du projet contient encore des echecs historiques non lies a ce scope Stripe.

---

## 11. Statut du document

Version: 2.0
Scope: Stripe go-live + billing lifecycle (trial/past_due/downgrade)
Projet: tattoo-studio-back
