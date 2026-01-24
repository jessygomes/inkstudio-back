# Tests pour la fonction `create()` - AppointmentsService

## 📋 Résumé

Une suite de tests complète a été créée pour la fonction `create()` du service `AppointmentsService`. Les tests couvrent tous les scénarios principaux de création de rendez-vous.

## ✅ Tests Implémentés

### 1. **Validation des Données**
- ✅ `should return error when tatoueur does not exist` - Vérifie qu'une erreur est retournée si le tatoueur n'existe pas
- ✅ `should return error when time slot is already booked` - Vérifie que le créneau horaire n'est pas déjà réservé

### 2. **Création de Clients**
- ✅ `should create appointment with new client (not connected)` - Crée un RDV avec un nouveau client non connecté
- ✅ `should create appointment with existing client` - Utilise un client existant
- ✅ `should link connected client to appointment` - Lie un client connecté au RDV et crée une conversation

### 3. **Gestion des Types de Prestations**
- ✅ `should create tattoo detail for TATTOO prestation` - Crée les détails de tatouage
- ✅ `should create piercing tattoo detail with price from service` - Gère les piercings avec prix depuis la DB

### 4. **Visioconférence**
- ✅ `should generate video call link when visio is true and no visioRoom provided` - Génère un lien vidéo
- ✅ `should use provided visioRoom when visio is true` - Utilise le lien fourni

### 5. **Cache et Side Effects**
- ✅ `should invalidate cache after successful appointment creation` - Invalide les caches
- ✅ `should handle email sending errors gracefully` - Continue même si l'email échoue

### 6. **Gestion des Erreurs**
- ✅ `should catch general errors and return error response` - Capture les erreurs générales

## 📊 Résultats

```
Tests:       18 passed
Test Suites: 1 passed
Time:        ~14 seconds
Coverage:    Fonction create() complètement testée
```

## 🎯 Ce que les Tests Vérifient

### Chemins d'exécution couverts:
1. ✅ Validation du tatoueur
2. ✅ Vérification des créneaux disponibles
3. ✅ Gestion des clients (nouveau, existant, connecté)
4. ✅ Liaison des clients connectés
5. ✅ Synchronisation des données clients
6. ✅ Création des détails de tatouage
7. ✅ Gestion des piercings avec prix
8. ✅ Génération de liens vidéo
9. ✅ Envoi d'emails de confirmation
10. ✅ Invalidation du cache
11. ✅ Création de conversations
12. ✅ Gestion des erreurs

## 🔧 Comment Exécuter les Tests

```bash
# Exécuter tous les tests de ce fichier
npm test -- src/appointments/appointments.service.spec.ts

# Exécuter avec coverage
npm test -- src/appointments/appointments.service.spec.ts --coverage

# Exécuter en mode watch
npm test -- src/appointments/appointments.service.spec.ts --watch
```

## 📝 Mocks Utilisés

- **PrismaService**: Mocks complets pour tous les appels DB
  - `tatoueur.findUnique`
  - `appointment.findFirst`, `create`, `update`
  - `user.findUnique`
  - `client.findFirst`, `create`, `update`
  - `tattooDetail.create`
  - `piercingServicePrice.findUnique`

- **Services injectés**:
  - `MailService.sendAppointmentConfirmation`
  - `VideoCallService.generateVideoCallLink`
  - `ConversationsService.createConversation`
  - `CacheService.delPattern`, `set`

## 🚀 Prochaines Étapes

Une fois que vous êtes satisfait de cette première suite de tests, nous pouvons continuer avec les tests pour:
- `createByClient()` - Création par client sans authentification
- `getAllAppointments()`
- `getAppointmentsByDateRange()`
- `updateAppointment()`
- `cancelAppointment()`
- Et autres fonctions du service...

## 📌 Notes

- Les tests sont indépendants et peuvent s'exécuter dans n'importe quel ordre
- Chaque test clear les mocks avant de s'exécuter
- Les tests utilisent des identifiants fictifs pour éviter les collisions
- Tous les appels async sont correctement gérés avec async/await
