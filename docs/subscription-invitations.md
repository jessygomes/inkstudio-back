# Abonnements offerts sur invitation

Dans **Admin → Utilisateurs → Invitations**, choisir l’email, le type de compte,
la formule et la durée en mois (12 par défaut, entre 1 et 120).
Copier le lien à sa création pour l’envoyer au bénéficiaire. Il n’est pas envoyé
automatiquement et ne peut pas être relu ensuite : seul son hash est conservé.
Un lien perdu peut être révoqué puis remplacé par une nouvelle invitation.

Le lien est valable 30 jours, personnel et utilisable une fois. L’inscription
crée le compte et son offre dans une transaction, puis conserve le parcours
habituel de vérification de l’email. La durée commence à la création du compte.
L’offre ne crée ni client ni abonnement Stripe et ne demande pas de carte.

Le badge **Invité** apparaît dans la liste des salons/indépendants et sur la fiche
admin. Il reste visible après expiration. L’onglet Invitations affiche la fin
de l’offre et permet de changer sa durée, même après utilisation : la nouvelle
date est calculée depuis le début de l’offre, pas depuis la modification.
Une prolongation peut réactiver une offre expirée. Une réduction peut la terminer
immédiatement. Un compte passé sur un abonnement Stripe n’est pas modifiable ici.

À la fin de l’offre, l’accès est ramené en Free lors de sa vérification et par le
traitement planifié des abonnements. Aucun paiement n’est déclenché.

## Mise en service

- Déployer la migration `20261026120000_subscription_invitations` avec
  `npx prisma migrate deploy`, puis générer le client Prisma et déployer le backend.
- Définir `FRONTEND_URL` côté backend sur l’URL du front professionnel.
- Déployer le front avec `NEXT_PUBLIC_BACK_URL` pointant vers ce backend.
- Le traitement existant `saas-billing` prend aussi en charge les offres.

La migration est fournie avec le code ; elle n’est pas appliquée automatiquement.
