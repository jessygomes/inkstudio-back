# Résumé du dashboard : `GET /dashboard/summary`

Une seule requête pour l'accueil (site Studio et application mobile) au lieu d'une quinzaine d'appels successifs.
Les requêtes partent en **parallèle** côté serveur (`Promise.all`) et **chaque bloc réussit ou échoue seul**.

## Requête

`GET /dashboard/summary` (JWT obligatoire). Tous les paramètres sont facultatifs.

| Paramètre | Rôle | Défaut |
| --- | --- | --- |
| `date` | Jour des rendez-vous (`YYYY-MM-DD`) | aujourd'hui |
| `fillStart`, `fillEnd` | Période du taux de remplissage (ISO) | semaine en cours (UTC) |
| `month`, `year` | Chiffres mensuels (nouveaux clients, encaissé) | mois en cours |
| `sections` | Blocs voulus, séparés par des virgules | tous |

## Réponse

```json
{
  "today":         { "ok": true, "data": [ ... ] },
  "pending":       { "ok": true, "data": { ... } },
  "conversations": { "ok": true, "data": [ ... ] },
  "followUps":     { "ok": true, "data": { "followUps": [ ... ] } },
  "drawingCards":  { "ok": true, "data": [ ... ] },
  "fillRate":      { "ok": true, "data": { ... } },
  "cancelRate":    { "ok": true, "data": { ... } },
  "newClients":    { "ok": true, "data": { ... } },
  "paid":          { "ok": true, "data": { ... } },
  "recentReviews": { "ok": true, "data": [ ... ] }
}
```

Un bloc en erreur vaut `{ "ok": false, "status": 403, "message": "…" }`. Chaque `data` est **identique** à la réponse de la route d'origine :

| Bloc | Route d'origine |
| --- | --- |
| `today` | `GET /appointments/today` |
| `pending` | `GET /appointments/pending-confirmation` |
| `conversations` | `GET /messaging/conversations/unread` |
| `followUps` | `GET /follow-up/unanswered` |
| `drawingCards` | `GET /suiviDessin/cards` (sans filtre) |
| `fillRate` | `GET /appointments/weekly-fill-rate` |
| `cancelRate` | `GET /appointments/cancellation-rate` |
| `newClients` | `GET /clients/new-clients-count/:id` |
| `paid` | `GET /appointments/monthly-paid-appointments` |
| `recentReviews` | `GET /salon-review/salon/recent` |

## Offre gratuite

Les blocs `today`, `fillRate`, `cancelRate`, `newClients` et `paid` portaient `@SaasLimit('dashboard')` : pour un compte `user_salon` / `user_tatoueur` en plan FREE, ils renvoient `{ ok: false, status: 403, … }`. Les autres blocs restent disponibles. Le droit est vérifié une seule fois par requête, et pas du tout si `sections` n'en demande aucun.

## Hors résumé

Les statistiques de visibilité du profil (`/salon-analytics/:id/stats|realtime|comparative`) restent des routes séparées : elles sont plus lourdes et se chargent à la demande (défilement, changement de période).

## Code

`src/dashboard/` (module, contrôleur, service, test). `src/follow-up/unanswered-follow-ups.ts` partage la requête des suivis avec `GET /follow-up/unanswered`. `AppointmentsModule`, `ClientsModule` et `SalonReviewModule` exportent maintenant leur service.
