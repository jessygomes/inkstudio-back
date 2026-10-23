# Ancienneté d'abonnement payant

Les réponses admin (liste des salons/indépendants et détail utilisateur)
exposent `saasPlanDetails.firstPaidPlanAt`, une date ISO ou `null`.
`currentPlan` et `planStatus` sont également présents dans `saasPlanDetails`.

Cette date correspond au premier abonnement actif enregistré, hors essai.
Stripe fournit le début de la souscription ou la fin de son essai.
Les renouvellements, changements de plan et résiliations ne la réinitialisent pas.
Elle mesure le temps écoulé depuis ce début, pas un cumul des périodes payées.

Pour l'admin, afficher « Abonné depuis le … » lorsque la date est connue,
ou « Non renseigné » sinon. Le statut courant permet de distinguer un ancien
abonné d'un abonné encore actif.

La migration ne reconstitue pas l'historique des comptes existants à partir
de leur date d'inscription ou du dernier paiement. Leur date reste inconnue
jusqu'à la synchronisation d'un abonnement actif ; si un compte a eu plusieurs
souscriptions avant ce suivi, un import de l'historique Stripe est nécessaire
pour connaître sa toute première souscription.

Déploiement : appliquer les migrations Prisma et régénérer le client avant
de démarrer le backend. Les réponses admin déjà en cache expirent sous 10 minutes.
