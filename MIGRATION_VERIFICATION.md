# Vérification des Migrations du 11 Novembre 2026

## ✅ État des Migrations

Les 2 migrations suivantes ont été appliquées avec succès :
- `20261111090000_personal_booking_links` ✅
- `20261111150000_project_client_info_practices_same_day` ✅

---

## 📋 Fonctionnalité 1 : Budget Client

### Schéma de Base de Données
Les champs suivants ont été ajoutés à la table `Appointment` :
- `projectBudgetMinCents` (INTEGER, nullable)
- `projectBudgetMaxCents` (INTEGER, nullable)
- `isFirstTattoo` (BOOLEAN, nullable)

**Contrainte DB :** Budget min ≤ Budget max, nombres ≥ 0, seulement pour les prestations PROJET

### Implémentation Backend
**Fichiers clés :**
- [src/appointments/project-client-info.ts](src/appointments/project-client-info.ts) : Logique métier
- [src/appointments/dto/project-client-info.dto.ts](src/appointments/dto/project-client-info.dto.ts) : DTO de validation
- [src/appointments/appointments.service.ts](src/appointments/appointments.service.ts) : Intégration dans les services

**Endpoints accessibles :**
- `POST /appointments` avec les champs `projectBudgetMinCents`, `projectBudgetMaxCents`, `isFirstTattoo` dans le body

**Tests :**
- ✅ 17 tests unitaires PASSÉS (project-client-info.spec.ts)
  - Valide les options budgétaires frontend
  - Valide les valeurs de premier tatouage
  - Rejette les budgets invalides (négatifs, décimaux, min > max, hors limites)
  - Rejette la métadonnée projet sur les prestations non-PROJET
  - Valide à la limite du DTO

### Intégration Frontend
Les champs sont inclus dans :
- `CreateAppointmentDto` (via héritage de `DesiredTattooPeriodDto` → `ProjectClientInfoDto`)
- `CreateAppointmentByClientRequestDto` pour les réservations clients

---

## 📋 Fonctionnalité 2 : RDV le Même Jour

### Schéma de Base de Données
Les champs suivants ont été ajoutés :
- `User.allowSameDayBooking` (BOOLEAN, default=true)
- `Tatoueur.allowSameDayBooking` hérité via relation
- `TattooPractice` ENUM : MACHINE, HANDPOKE, TRADITIONAL, OTHER
- `User.tattooPractices` (ENUM[], array)
- `Tatoueur.tattooPractices` (ENUM[], array)
- `User.tattooPracticeDetails` (TEXT, nullable)
- `Tatoueur.tattooPracticeDetails` (TEXT, nullable)

### Implémentation Backend
**Fichiers clés :**
- [src/appointments/same-day-booking.ts](src/appointments/same-day-booking.ts) : Logique de vérification
- [src/appointments/internal-booking-policy.ts](src/appointments/internal-booking-policy.ts) : Validation aux points d'entrée
- [src/time-slot/time-slot.service.ts](src/time-slot/time-slot.service.ts) : Filtrage des créneaux
- [src/residencies/residencies.service.ts](src/residencies/residencies.service.ts) : Vérification par résidence

**Logique :**
- `isSameDayBookingBlocked()` : Détecte si le créneau est le même jour (utilise l'heure de Paris avec décalage DST)
- `assertSameDayBookingAllowed()` : Lève une `ForbiddenException` avec code `SAME_DAY_BOOKING_DISABLED` si bloqué
- Respecte le timezone Paris pour traverser minuit et changements d'heure d'été

**Endpoints affectés :**
- `POST /appointments` - Valide `allowSameDayBooking` du salon/tatoueur
- `GET /time-slots` - Filtre les créneaux du jour si `allowSameDayBooking=false`
- `PATCH /user/appointment-booking` - Paramètre de configuration

**Tests :**
- ✅ 9 tests unitaires PASSÉS (same-day-booking.spec.ts)
  - Gère correctement les passages minuit et DST (Paris)
  - Conserve l'ancien comportement (true/undefined = autorisé)
  - Rejette les réservations publiques le même jour
  - Autorise la création par professionals
  - S'applique aux artistes liés (par venue et par salon)
  - Masque les créneaux du jour même dans les slots publics

### Configuration Utilisateur
**Endpoint de paramétrage :**
```
PATCH /user/appointment-booking
Body: { allowSameDayBooking: boolean }
```

**DTO :**
- [src/user/dto/update-confirmation-setting.dto.ts](src/user/dto/update-confirmation-setting.dto.ts)
- `UpdateAppointmentBookingDto` avec champ `allowSameDayBooking: boolean` (valide false, rejette null/strings)

**Tests :**
- ✅ 8 tests unitaires PASSÉS (tattoo-practices.spec.ts)
  - Accepte et persiste false sans écraser les options projet
  - Inclus dans les profils publics en toute sécurité
  - Inclus dans les réponses de profil public

### Profil Public
- Les champs `allowSameDayBooking`, `tattooPractices`, `tattooPracticeDetails` sont inclus dans [src/user/public-user-profile.ts](src/user/public-user-profile.ts)
- Exposés de manière sûre via `publicUserProfileSelect`

---

## 🧪 Résumé des Tests
| Suite | Tests | Statut |
|-------|-------|--------|
| project-client-info.spec.ts | 17 | ✅ PASSED |
| same-day-booking.spec.ts | 9 | ✅ PASSED |
| tattoo-practices.spec.ts | 8 | ✅ PASSED |
| **TOTAL** | **34** | **✅ ALL PASSED** |

---

## 🔧 Corrections Appliquées
- Déplacement des champs `tattooPractices` et `tattooPracticeDetails` de Portfolio vers User/Tatoueur dans la requête Prisma (user.service.ts ligne ~2110)

---

## ✅ Conclusion
**Tout le code correspondant aux migrations est en place et testé :**
- ✅ Migration DB appliquée
- ✅ Models Prisma mis à jour
- ✅ DTOs de validation configurés
- ✅ Service métier implémenté
- ✅ Contrôleurs intégrés
- ✅ Endpoints accessibles
- ✅ Tests 34/34 PASSÉS
- ✅ Profils publics sécurisés
- ✅ Gestion des timezones (Paris)
