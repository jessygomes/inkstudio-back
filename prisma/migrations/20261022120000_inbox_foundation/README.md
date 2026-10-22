# Inbox omnicanale — fondation additive

Cette migration ajoute uniquement les modèles, énumérations, clés étrangères et
index de l'inbox multicanale. Elle ne supprime ni `Conversation`, ni `Message`,
ni `Conversation.appointmentId`.

## Avant toute application

1. Sauvegarder la base PostgreSQL de production et tester sur une copie.
2. Vérifier l'absence de dérive entre la base cible et les migrations existantes.
3. Vérifier les doublons des conversations Inkera :

   ```sql
   SELECT "salonId", "clientUserId", COUNT(*) AS total
   FROM "Conversation"
   GROUP BY "salonId", "clientUserId"
   HAVING COUNT(*) > 1;
   ```

4. Ne pas déployer de contrôles d'accès fondés sur `InboxThread` avant d'avoir
   créé un `InboxThread` pour **chaque** conversation Inkera existante.
5. Ne pas appliquer immédiatement `@@unique([salonId, clientUserId])` : cette
   étape nécessite la consolidation contrôlée des doublons et le rattachement
   de leurs messages, notifications et rendez-vous, sans perte d'historique.

## Règles métier à conserver

- Pour un professionnel donné : **une seule conversation Inkera par compte client**.
- Une fiche CRM `Client` peut être liée à plusieurs `InboxThread`, provenant
  de canaux différents. Ne jamais fusionner leurs messages.
- Les associations externes vers la fiche CRM sont manuelles/confirmées.
- Le propriétaire salon voit toutes **ses** conversations ; un indépendant
  rattaché ne peut consulter/répondre qu'aux conversations **assignées à lui**
  et uniquement si ses permissions sont valides. Retirer l'attribution révoque
  immédiatement les droits, y compris pour les WebSockets et les fichiers.
- `InboxThread.conversationId` et `externalConversationId` : exactement un des
  deux doit être renseigné. De même, `assignedUserId` et `assignedTatoueurId`
  ne peuvent pas être remplis simultanément.
- Les relations professionnelles (propriétaire, fiche CRM, salon du tatoueur,
  compte externe et rendez-vous) doivent toutes appartenir au même tenant.

**Attention :** le schéma est une première fondation. Les adaptations NestJS,
frontend, l'import des conversations existantes, les connecteurs externes et les
contrôles SQL de cohérence restent à réaliser avant une mise en production.
