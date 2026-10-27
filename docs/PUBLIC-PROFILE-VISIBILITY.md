# Visibilité publique et pseudo indépendant

La fiche utilisateur dans l'administration propose trois états :

| État | Recherche salons/indépendants | Lien du profil | Inspirations et profils liés |
| --- | --- | --- | --- |
| `VISIBLE` | Oui | Accessible | Selon les réglages existants |
| `SEARCH_HIDDEN` | Non | Accessible | Selon les réglages existants |
| `HIDDEN` | Non | Réponse 404 | Masqué |

`PATCH /admin/users/:id/public-visibility` reçoit `{ "publicVisibility": "HIDDEN" }`.
La route est soumise aux gardes JWT et rôle administrateur du contrôleur admin.
La modification de profil ordinaire ne permet pas d'écrire ce champ.

Le propriétaire authentifié et les administrateurs peuvent toujours utiliser les
routes privées par identifiant. Les routes publiques de profil, portfolio,
flashs, produits, équipe, avis et disponibilités vérifient la visibilité avant de
consulter leurs caches. Les réservations publiques vérifient également le compte
cible et le salon d'accueil. Les données professionnelles privées et les anciens
rendez-vous restent disponibles.

La recherche, les inspirations et le profil public sont résolus depuis la base,
sans réutiliser d'anciens résultats publics Redis. Le site public utilise une
requête sans cache serveur pour le profil et la réservation. Une page déjà ouverte
dans le navigateur doit être actualisée pour refléter une décision de masquage.

`nickname` est facultatif, limité à 80 caractères, réservé aux comptes
`user_tatoueur`. S'il est renseigné, `displayName` le privilégie sur les surfaces
publiques : recherche, en-tête du profil, métadonnées, réservation, inspirations,
favoris et artistes liés. Sinon, le nom public existant est conservé. La valeur
`salonName` continue à construire les URL : renseigner ou effacer le pseudo ne
modifie pas les liens des profils. Les champs `firstName` et `lastName` restent
obligatoires dans les formulaires d'identité et ne sont pas remplacés dans les
traitements de paiement.

## Déploiement

1. Appliquer la migration additive `20261027170000_public_visibility_nickname`
   avec la procédure habituelle (`npx prisma migrate deploy`). Les comptes
   existants restent `VISIBLE` et leur pseudo vaut `null`.
2. Régénérer Prisma et déployer le backend.
3. Déployer `inkstudio-front` pour les contrôles admin et le champ pseudo, ainsi
   que `inkstudio-front-public` pour l'affichage public et les requêtes sans cache.

La migration doit précéder le démarrage du nouveau backend. Aucun masquage ni
changement de pseudo n'est appliqué automatiquement aux comptes existants.
