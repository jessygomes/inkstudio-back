# Abonnements offerts sur invitation

Dans **Admin → Utilisateurs → Invitations**, choisir le type de lien :

- **Personnel** : lié à un email précis, une seule inscription. Un autre email
  est refusé par le backend, même si le formulaire est modifié.
- **Partageable** : aucun destinataire imposé, quota d’inscriptions configurable
  (5 par défaut, entre 1 et 1000). Chaque utilisateur choisit son email.

Choisir le type de compte, la formule, la durée de l’offre par compte en mois
(12 par défaut, entre 1 et 120) et la validité du lien en jours
(30 par défaut, entre 1 et 365).

Le type de compte et la formule peuvent rester « Au choix du bénéficiaire ».
Le formulaire d’inscription propose alors tatoueur avec Pro ou salon avec Business.
Chaque utilisation conserve la formule accordée, même lors d’un changement ultérieur
de la durée sur un lien ayant servi à différents types de comptes.
Les invitations personnelles restent limitées à un seul compte, y compris en choix libre.
Copier le lien à sa création pour l’envoyer au bénéficiaire. Il n’est pas envoyé
automatiquement et ne peut pas être relu ensuite : seul son hash est conservé.
Un lien perdu peut être révoqué puis remplacé par une nouvelle invitation.

Le lien est refusé à expiration, après révocation ou dès que son quota est atteint.
Le compteur est incrémenté dans la même transaction que la création du compte :
deux inscriptions simultanées ne peuvent pas dépasser le quota. Un échec de création
du compte ne consomme aucune place. La suppression d’un compte ne libère pas sa place.
L’inscription
crée le compte et son offre dans une transaction, puis conserve le parcours
habituel de vérification de l’email. La durée commence à la création du compte.
L’offre ne crée ni client ni abonnement Stripe et ne demande pas de carte.

Le badge **Invité** apparaît dans la liste des salons/indépendants et sur la fiche
admin. Il reste visible après expiration. L’onglet Invitations affiche le compteur,
les bénéficiaires, la fin de chaque offre et permet de changer le quota, la date
limite du lien et la durée de l’offre, même après utilisation : la nouvelle
date est calculée depuis le début de l’offre, pas depuis la modification.
Une prolongation peut réactiver une offre expirée. Une réduction peut la terminer
immédiatement. Les comptes passés sur Stripe conservent leur abonnement indépendant
et ne sont pas modifiés. Une révocation bloque les futures inscriptions sans supprimer
les offres déjà accordées. Augmenter un quota atteint permet de réutiliser le même lien
tant qu’il n’est ni expiré ni révoqué.

À la fin de l’offre, l’accès est ramené en Free lors de sa vérification et par le
traitement planifié des abonnements. Aucun paiement n’est déclenché.

## Mise en service

- Déployer les migrations `20261026120000_subscription_invitations`,
  `20261026140000_shared_subscription_invitations` et
  `20261026160000_flexible_invitation_accounts` avec
  `npx prisma migrate deploy`, puis générer le client Prisma et déployer le backend.
- Définir `FRONTEND_URL` côté backend sur l’URL du front professionnel.
- Déployer le front avec `NEXT_PUBLIC_BACK_URL` pointant vers ce backend.
- Le traitement existant `saas-billing` prend aussi en charge les offres.

La nouvelle migration reprend les utilisations existantes pour conserver les badges,
les offres et le caractère personnel des anciens liens. Redémarrer le backend après
génération du client Prisma ; les anciennes versions du code ne lisent pas le nouveau
modèle d’utilisations.
