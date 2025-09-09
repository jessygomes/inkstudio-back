# ⏰ API Documentation - Module Time Slots

## Table des matières

1. [🏢 Créneaux salon](#créneaux-salon)
2. [👨‍🎨 Créneaux tatoueur](#créneaux-tatoueur)
3. [🚫 Système de blocage](#système-de-blocage)
4. [⚙️ Logique métier](#logique-métier)

---

## 🏢 Créneaux salon

### 1. Obtenir créneaux d'un salon pour une date
**Route :** `GET /timeslots/salon/:salonId`  
**Authentification :** Non requise

```typescript
@Get('/salon/:salonId')
async getSLots(@Query('salonId') salonId: string, @Query('date') dateStr: string,) {
  if (!salonId || !dateStr) {
    throw new BadRequestException('Les paramètres date et salonId sont requis');
  }

  const date = new Date(dateStr);

  const user = await this.prisma.user.findUnique({
    where: {
      id: salonId,
    },
    select: {
      id: true,
      salonHours: true,
    },
  });

  if (!user) {
    throw new NotFoundException("Salon introuvable");
  }

  const slots = this.timeSlotService.generateTimeSlotsForDate(
    date,
    user.salonHours ?? '{}'
  );

  return slots;
}
```

**Exemple d'usage :**
```
GET /timeslots/salon/cm8uhfodj0000th6wi3m2afnj?date=2025-04-23
```

**Service associé :** `generateTimeSlotsForDate()`

**Logique du service :**
- Récupère les horaires du salon depuis `salonHours` (JSON)
- Parse le JSON des horaires
- Détermine le jour de la semaine en français puis conversion anglaise
- Vérifie si le salon est ouvert ce jour-là
- Génère des créneaux de 30 minutes entre heures d'ouverture/fermeture
- Filtre les créneaux bloqués (si `userId` fourni)

**Mapping des jours :**
```typescript
{
  lundi: 'monday',
  mardi: 'tuesday',
  mercredi: 'wednesday',
  jeudi: 'thursday',
  vendredi: 'friday',
  samedi: 'saturday',
  dimanche: 'sunday',
}
```

**Gestion des erreurs :**
- JSON invalide → Retourne tableau vide
- Salon fermé → Retourne tableau vide
- Salon introuvable → `NotFoundException`

---

## 👨‍🎨 Créneaux tatoueur

### 2. Obtenir créneaux d'un tatoueur pour une date
**Route :** `GET /timeslots/tatoueur`  
**Authentification :** Non requise

```typescript
@Get('tatoueur')
async getTatoueurSlots(
  @Query('tatoueurId') tatoueurId: string,
  @Query('date') date: string
) {
  if (!tatoueurId || !date) {
    return { error: true, message: 'tatoueurId et date requis' };
  }

  const dateObj = new Date(date);
  const slots = await this.timeSlotService.generateTatoueurTimeSlots(
    dateObj,
    tatoueurId
  );

  return slots;
}
```

**Exemple d'usage :**
```
GET /timeslots/tatoueur?date=2025-04-23&tatoueurId=cm8uhfodj0000th6wi3m2afnj
```

**Service associé :** `generateTatoueurTimeSlots()`

**Logique du service :**
- Récupère le tatoueur avec ses horaires personnalisés
- Inclut l'ID du salon (`user: { select: { id: true } }`)
- Génère les créneaux de base selon les horaires du tatoueur
- **Double filtrage des blocages :**
  1. Blocages salon généraux (dans `generateTimeSlotsForDate`)
  2. Blocages spécifiques au tatoueur (dans la boucle)

**Différence avec salon :**
- Utilise `tatoueur.hours` au lieu de `salon.salonHours`
- Filtrage plus spécifique (blocages tatoueur + salon)

---

## 🚫 Système de blocage

### 3. Vérification des créneaux bloqués
**Méthode :** `isTimeSlotBlocked()` (privée)

```typescript
private async isTimeSlotBlocked(startDate: Date, endDate: Date, tatoueurId?: string, userId?: string): Promise<boolean>
```

**Logique de détection des conflits :**

#### **Chevauchement de créneaux :**
```typescript
{
  AND: [
    {
      startDate: {
        lt: endDate, // Le blocage commence avant la fin du créneau demandé
      },
    },
    {
      endDate: {
        gt: startDate, // Le blocage se termine après le début du créneau demandé
      },
    },
  ],
}
```

#### **Types de blocages gérés :**

**1. Blocage spécifique tatoueur :**
```typescript
if (tatoueurId) {
  whereConditions.OR = [
    { tatoueurId: tatoueurId }, // Bloqué pour ce tatoueur précis
    { tatoueurId: null }, // Bloqué pour tous les tatoueurs du salon
  ];
}
```

**2. Blocage salon général :**
```typescript
if (userId) {
  whereConditions.userId = userId; // Reste dans le périmètre du salon
}
```

**Priorité des blocages :**
1. **Blocage tatoueur spécifique** → Affecte seulement ce tatoueur
2. **Blocage salon global** (`tatoueurId: null`) → Affecte tous les tatoueurs
3. **Intersection** → Un créneau peut être bloqué par les deux

---

## ⚙️ Logique métier

### Format des horaires

#### **Salon (`salonHours`) :**
```json
{
  "monday": { "start": "09:00", "end": "18:00" },
  "tuesday": { "start": "09:00", "end": "18:00" },
  "wednesday": null,
  "thursday": { "start": "10:00", "end": "17:00" },
  "friday": { "start": "09:00", "end": "18:00" },
  "saturday": { "start": "09:00", "end": "16:00" },
  "sunday": null
}
```

#### **Tatoueur (`tatoueur.hours`) :**
- Même format que salon
- Peut avoir des horaires différents/réduits
- `null` = jour non travaillé

### Génération des créneaux

#### **Durée standard :** 30 minutes par créneau

#### **Algorithme de génération :**
1. Parse les horaires (JSON → objet)
2. Détermine le jour de la semaine (français → anglais)
3. Vérifie si ouvert ce jour (`null` = fermé)
4. Crée créneaux de 30min de `start` à `end`
5. Filtre les créneaux bloqués
6. Retourne liste des créneaux disponibles

#### **Gestion des limites :**
- Créneau doit finir avant ou exactement à l'heure de fermeture
- Pas de créneau qui dépasse les horaires
- Créneaux parfaitement alignés (30min exactement)

### Types de données

#### **TimeSlot :**
```typescript
{
  start: Date,
  end: Date
}
```

#### **SalonHours :**
```typescript
{
  [key: string]: {
    start: string,
    end: string,
  } | null,
}
```

#### **BlockedTimeSlotWhereCondition :**
```typescript
interface BlockedTimeSlotWhereCondition {
  AND: Array<{
    startDate?: { lt: Date };
    endDate?: { gt: Date };
  }>;
  OR?: Array<{ tatoueurId: string | null }>;
  userId?: string;
}
```

### Points techniques importants

#### **Gestion des fuseaux horaires :**
- Utilise `Date` JavaScript standard
- Format horaires : "HH:MM" (24h)
- Calculs avec `date-fns` pour précision

#### **Performance :**
- Génération en mémoire (pas de BDD pour créneaux de base)
- Requête BDD seulement pour vérifier blocages
- Algorithme O(n) où n = nombre de créneaux dans la journée

#### **Robustesse :**
- Try-catch sur parsing JSON
- Retour tableau vide si erreur
- Vérifications existence tatoueur/salon

#### **Cas d'usage :**
1. **Frontend booking :** Afficher créneaux disponibles
2. **Calendrier tatoueur :** Créneaux personnalisés
3. **Gestion salon :** Vue d'ensemble tous tatoueurs
4. **Système de blocage :** Congés, fermetures exceptionnelles

#### **Integration avec autres modules :**
- **Appointments :** Vérification conflits lors création RDV
- **Blocked-time-slots :** Système de réservation/blocage
- **Users :** Récupération horaires salon/tatoueur
- **Tatoueurs :** Horaires individualisés

#### **Limitations actuelles :**
- Créneaux fixes 30 minutes (pas paramétrable)
- Pas de gestion de créneaux variables selon prestation
- Horaires identiques 7j/7 (pas de gestion période/saison)
