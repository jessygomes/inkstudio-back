# API Documentation - Appointment Consumables

## Objectif
Permettre au tatoueur d'enregistrer les consommables utilises pendant un rendez-vous.

- Saisie optionnelle: aucun consommable n'est obligatoire pour un rendez-vous.
- Saisie flexible: le consommable peut etre cree avec ou sans lien vers le stock.
- Portee: uniquement pour les prestations `TATTOO`, `PIERCING`, `RETOUCHE`.

## Authentification
Toutes les routes ci-dessous sont protegees par `JwtAuthGuard`.

## Modele de donnees
Table Prisma: `AppointmentConsumable`

Champs techniques obligatoires:
- `id`
- `appointmentId`
- `userId`
- `createdAt`
- `updatedAt`

Champs metier optionnels:
- `stockItemId`
- `category`
- `productName`
- `brand`
- `reference`
- `pigment`
- `lotNumber`
- `expirationDate`
- `quantity`
- `unit`
- `notes`

## Workflow front recommande
1. Ouvrir un rendez-vous.
2. Lister les consommables existants du rendez-vous.
3. Ajouter 0, 1 ou plusieurs consommables.
4. Possibilite de lier a un produit stock (`stockItemId`) ou de saisir en libre.
5. Mettre a jour/supprimer si besoin.

## Endpoints

### 1) Ajouter un consommable a un rendez-vous
Route:
`POST /appointments/:appointmentId/consumables`

Exemple body (avec stock):
```json
{
  "stockItemId": "ck_stock_123",
  "category": "INK",
  "productName": "Dynamic Black 240ml",
  "brand": "Dynamic",
  "reference": "DY-BLK-240",
  "pigment": "Carbon Black",
  "lotNumber": "LOT-2026-0042",
  "expirationDate": "2027-12-31",
  "quantity": 3,
  "unit": "ml",
  "notes": "Utilise pour contour"
}
```

Exemple body (sans stock):
```json
{
  "category": "NEEDLE",
  "productName": "Cartouche RL 7",
  "brand": "Kwadron",
  "reference": "KW-RL7",
  "lotNumber": "RL7-260518-A",
  "expirationDate": "2028-01-10",
  "quantity": 1,
  "unit": "piece"
}
```

Exemple reponse:
```json
{
  "error": false,
  "message": "Consommable ajoute au rendez-vous.",
  "consumable": {
    "id": "cm1...",
    "appointmentId": "apt_123",
    "userId": "usr_123",
    "stockItemId": null,
    "category": "NEEDLE",
    "productName": "Cartouche RL 7",
    "brand": "Kwadron",
    "reference": "KW-RL7",
    "pigment": null,
    "lotNumber": "RL7-260518-A",
    "expirationDate": "2028-01-10T00:00:00.000Z",
    "quantity": 1,
    "unit": "piece",
    "notes": null,
    "createdAt": "2026-05-18T10:00:00.000Z",
    "updatedAt": "2026-05-18T10:00:00.000Z"
  }
}
```

### 2) Lister les consommables d'un rendez-vous
Route:
`GET /appointments/:appointmentId/consumables`

Exemple reponse:
```json
{
  "error": false,
  "consumables": [
    {
      "id": "cm1...",
      "appointmentId": "apt_123",
      "category": "INK",
      "productName": "Dynamic Black 240ml",
      "lotNumber": "LOT-2026-0042",
      "expirationDate": "2027-12-31T00:00:00.000Z",
      "createdAt": "2026-05-18T10:00:00.000Z",
      "updatedAt": "2026-05-18T10:00:00.000Z"
    }
  ]
}
```

### 3) Modifier un consommable
Route:
`PATCH /appointments/:appointmentId/consumables/:consumableId`

Exemple body partiel:
```json
{
  "lotNumber": "LOT-2026-0042-B",
  "notes": "Correction lot apres verification"
}
```

Exemple reponse:
```json
{
  "error": false,
  "message": "Consommable mis a jour.",
  "consumable": {
    "id": "cm1...",
    "lotNumber": "LOT-2026-0042-B",
    "notes": "Correction lot apres verification"
  }
}
```

### 4) Supprimer un consommable
Route:
`DELETE /appointments/:appointmentId/consumables/:consumableId`

Exemple reponse:
```json
{
  "error": false,
  "message": "Consommable supprime."
}
```

### 5) Recherche globale (lot / reference / date de peremption)
Route:
`GET /appointments/consumables/search`

Query params supportes:
- `lotNumber` (recherche partielle, insensible a la casse)
- `reference` (recherche partielle, insensible a la casse)
- `expirationDateFrom` (ISO date)
- `expirationDateTo` (ISO date)
- `page` (defaut: 1)
- `limit` (defaut: 20, max: 100)

Exemple:
`GET /appointments/consumables/search?lotNumber=LOT-2026&reference=KW&expirationDateFrom=2026-01-01&expirationDateTo=2026-12-31&page=1&limit=20`

Exemple reponse:
```json
{
  "error": false,
  "consumables": [
    {
      "id": "cm1...",
      "lotNumber": "LOT-2026-0042",
      "reference": "KW-RL7",
      "expirationDate": "2026-11-30T00:00:00.000Z",
      "appointment": {
        "id": "apt_123",
        "prestation": "TATTOO",
        "start": "2026-05-01T09:00:00.000Z",
        "end": "2026-05-01T10:30:00.000Z"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

## Codes d'erreur usuels
- `error: true` + `message: "Rendez-vous introuvable ou non autorise."`
- `error: true` + `message: "Les consommables sont disponibles uniquement pour Tattoo, Retouche et Piercing."`
- `error: true` + `message: "Consommable introuvable pour ce rendez-vous."`

## Notes techniques
- Les routes invalidents le cache detail du rendez-vous (`appointment:{id}`) apres create/update/delete.
- Le detail d'un rendez-vous inclut aussi `appointmentConsumables` pour simplifier le front.
