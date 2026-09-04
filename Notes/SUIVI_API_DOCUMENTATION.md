# API Suivi

Le module `Suivi` gère les cards de dessins entre un rendez-vous source et le rendez-vous Tattoo final.

## Statuts

L'ordre des colonnes est :

```text
A_DESSINER -> EN_COURS -> A_MODIFIER -> TERMINE -> APPROUVE
```

## Authentification

Toutes les routes nécessitent un bearer token JWT. Le salon propriétaire ou le tatoueur assigné peut accéder à la card.

## Cards

### Lister les cards

```text
GET /suiviDessin/cards
GET /suiviDessin/cards?status=EN_COURS
GET /suiviDessin/cards?search=Dupont&tatoueurId=tatoueur-id
GET /suiviDessin/cards?appointmentDateFrom=2026-01-01T00:00:00.000Z&appointmentDateTo=2026-01-31T23:59:59.000Z
```

Filtres disponibles : `status`, `search`, `tatoueurId`, `appointmentDateFrom`, `appointmentDateTo`.

### Vérifier un rendez-vous source

```text
GET /suiviDessin/appointments/:appointmentId/card-status
```

Cette route indique si le rendez-vous est terminé, si une card existe déjà et si l'action de création peut être affichée.

### Créer une card

```text
POST /suiviDessin/cards
```

```json
{
  "sourceAppointmentId": "appointment-id",
  "title": "Projet floral",
  "description": "Fleurs sur l'avant-bras",
  "additionalInfo": "Le client préfère une composition fine."
}
```

Le RDV source doit être un RDV `PROJET` ou un rendez-vous créé pour le tatoueur connecté. Les informations du client, du tatoueur et du moodboard sont reprises automatiquement.

### Modifier une card ou son statut

```text
PATCH /suiviDessin/cards/:id
```

```json
{
  "status": "A_MODIFIER",
  "additionalInfo": "Réduire la taille du motif."
}
```

Les valeurs possibles sont `A_DESSINER`, `EN_COURS`, `A_MODIFIER`, `TERMINE` et `APPROUVE`.

### Supprimer une card

```text
DELETE /suiviDessin/cards/:id
```

La suppression supprime également les notes et images liées grâce aux relations Prisma en cascade.

## Notes et échanges

### Ajouter une note

```text
POST /suiviDessin/cards/:id/notes
```

```json
{
  "content": "Le client souhaite déplacer le motif de 2 cm.",
  "type": "CLIENT_EXCHANGE"
}
```

Types possibles : `INTERNAL`, `CLIENT_EXCHANGE`, `DESIGN_UPDATE`.

## Images et versions

### Ajouter une version

```text
POST /suiviDessin/cards/:id/images
```

```json
{
  "url": "https://storage.example.com/drawing-v2.png",
  "caption": "Version avec motif réduit"
}
```

Le numéro de version est calculé automatiquement.

### Modifier une légende

```text
PATCH /suiviDessin/cards/:id/images/:imageId
```

```json
{
  "caption": "Version finale envoyée au client"
}
```

### Approuver une image

```text
PATCH /suiviDessin/cards/:id/images/:imageId/approve
```

Une seule image peut être approuvée à la fois.

### Supprimer une image

```text
DELETE /suiviDessin/cards/:id/images/:imageId
```

## Relier un RDV Tattoo

Une card doit être au statut `APPROUVE`.

```text
POST /suiviDessin/cards/:cardId/tattoo-appointment/:appointmentId
```

Le rendez-vous doit être un `TATTOO`, appartenir au même salon et concerner le même client.

Lors de la création ou modification d'un rendez-vous, le lien peut également être fourni directement :

```json
{
  "prestation": "TATTOO",
  "drawingCardId": "drawing-card-id"
}
```
