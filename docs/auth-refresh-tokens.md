# Jetons de rafraîchissement (sessions des applications)

Toutes les applications (Inkera Studio et People, sur le web et sur mobile) utilisent le même mécanisme :
un **jeton d'accès** (JWT, envoyé à chaque requête) et un **jeton de rafraîchissement** (opaque, envoyé uniquement à `/auth/*`).

## Routes

| Route | Rôle |
| --- | --- |
| `POST /auth/login`, `/auth/google`, `/auth/apple` | renvoient `access_token`, `refresh_token`, `refresh_expires_at` (et le reste de la session) |
| `POST /auth/refresh` `{ refreshToken }` | échange un jeton de rafraîchissement contre un nouveau couple de jetons (rotation) : `access_token`, `access_expires_at`, `refresh_token`, `refresh_expires_at`. 401 si le jeton est inconnu, expiré ou révoqué |
| `POST /auth/logout` `{ refreshToken }` | ferme la session de cet appareil (toute la famille de jetons) |
| `POST /auth/logout-all` (JWT) | ferme toutes les sessions du compte |

`/auth/refresh` et `/auth/logout` sont limités par `SecurityThrottle('refresh')` (par IP).
Un changement ou une réinitialisation du mot de passe ferme aussi toutes les sessions.

## Stockage et sécurité

- Table `RefreshToken` : seule l'**empreinte SHA-256** du jeton est enregistrée. Un jeton volé en base est inutilisable.
- Les jetons d'une même connexion forment une **famille** (`familyId`). À chaque renouvellement, l'ancien jeton est remplacé (`revokedAt`, `rotatedAt`) par un nouveau de la même famille.
- **Fenêtre de grâce** (30 s, `REFRESH_REUSE_GRACE_MS`) : un jeton tout juste remplacé reste accepté, car un même client peut envoyer deux renouvellements simultanés (onglets, requêtes parallèles). La famille continue.
- **Détection de vol** : un jeton remplacé depuis plus longtemps qui revient, ou un jeton révoqué à la main, révoque toute la famille (l'appareil légitime et le voleur doivent se reconnecter).
- Les révocations manuelles (déconnexion, changement de mot de passe) effacent `rotatedAt` : plus aucune fenêtre de grâce.

## Configuration

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `JWT_ACCESS_EXPIRES_IN` | `7d` | Durée du jeton d'accès (`15m`, `30m`, `2h`, `7d`…) |
| `JWT_REFRESH_DAYS` | `60` | Durée d'un jeton de rafraîchissement (renouvelée à chaque rotation) |

## Mise en service (ordre à respecter)

1. Appliquer la migration `20261107100000_refresh_tokens` (`npx prisma migrate deploy`), puis déployer le backend.
   Avec `JWT_ACCESS_EXPIRES_IN` inchangé (7 jours), **rien ne change pour les utilisateurs** : les jetons de rafraîchissement sont émis mais pas encore indispensables.
2. Déployer les deux sites web (Studio, People) et les deux applications mobiles. Elles renouvellent le jeton d'accès toutes seules.
   Les sessions ouvertes avant la mise à jour n'ont pas de jeton de rafraîchissement : elles continuent avec leur jeton de 7 jours puis demandent une reconnexion.
3. Quand toutes les applications sont à jour, définir `JWT_ACCESS_EXPIRES_IN=30m` (ou `15m`) sur le backend. Le jeton d'accès devient court, la session se prolonge en silence tant que le jeton de rafraîchissement est valide.

Ne pas raccourcir le jeton d'accès avant l'étape 2 : une application non mise à jour déconnecterait ses utilisateurs à chaque expiration.

## Nettoyage

Les jetons expirés restent en base. Purge possible à tout moment :
`DELETE FROM "RefreshToken" WHERE "expiresAt" < now() - interval '7 days';`
