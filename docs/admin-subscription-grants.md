# Offrir un abonnement depuis une fiche admin

Dans le back-office, ouvrir la fiche d’un salon ou d’un tatoueur indépendant.
Dans **Abonnement**, le bouton **Modifier** ouvre le panneau latéral.

- Salon : formule Business ; indépendant : formule Pro.
- Choisir une durée entière en mois (1 à 120) ou en jours (1 à 3650).
- Sans abonnement Stripe, la période commence à l’enregistrement et remplace la période actuelle.
- Les mois suivent le calendrier, avec ajustement à la fin du mois.
- Les jours correspondent à des périodes de 24 heures.

Sans abonnement Stripe, l’offre est enregistrée à 0 €, sans prochain paiement ni appel Stripe. Elle est
identifiée par `paymentMethod = ADMIN_GIFT`. Les paramètres d’agenda existants et
l’historique du premier abonnement payant sont conservés. Le changement est
journalisé avec l’administrateur, le bénéficiaire et les dates accordées.

Avec un abonnement Stripe actif, le panneau propose d’abord une vérification des dates
et du tarif de base (hors taxes et remises). L’administrateur confirme explicitement
la reprise automatique. L’offre commence après la période déjà payée et la prochaine
échéance est décalée à sa fin, sans prorata, changement de prix ni changement de moyen
de paiement. La souscription est conservée ; elle n’est pas résiliée.
Le bénéficiaire conserve son accès puis est facturé à nouveau par Stripe à la date
prévue. Un échec de paiement suit la gestion habituelle des impayés.

La réalisation utilise `trial_end` et `proration_behavior=none` pour les abonnements
classiques compatibles. La dernière facture doit être payée ; les abonnements en
résiliation, en pause, en impayé ou soumis à un autre échéancier sont refusés.
La reprise est limitée aux 730 prochains jours. Les offres Stripe existantes sont
modifiables depuis leur date de début d’origine, sans cumuler une nouvelle période.
Les tarifs et dates sont revérifiés à la confirmation ; une clé d’idempotence et des
métadonnées Stripe permettent de rejouer une demande sans ajouter une deuxième offre.
Les webhooks synchronisent l’offre (`STRIPE_GIFT`) puis rétablissent le statut payant
à la reprise. Une résiliation demandée par le client reste respectée.

La présence d’un ancien client Stripe sans abonnement ne bloque pas l’offre.

La fiche admin affiche les dates de début et de fin, puis se rafraîchit après
l’enregistrement. Les paramètres du bénéficiaire indiquent que l’abonnement est
offert et annoncent les dates de reprise pour Stripe. Le contrôle d’accès et le traitement
planifié existants ramènent les offres sans Stripe en Free à l’échéance.
Les offres d’invitation ultérieures ne remplacent pas une
offre accordée directement par l’administration.

La vérification périodique du plan et le retour sur l’onglet synchronisent aussi
le plan de la session et la navigation du bénéficiaire, sans reconnexion.

API : `PATCH /admin/users/:id/subscription`, réservée au rôle admin avec JWT,
corps `{ "duration": 12, "unit": "MONTHS" }` ou `{ "duration": 30, "unit": "DAYS" }`.
Le backend détermine la formule à partir du rôle du bénéficiaire.
Pour Stripe, appeler d’abord `POST /admin/users/:id/subscription/preview` avec la
durée ; transmettre ensuite les champs `confirmation` et `requestId` reçus dans le
PATCH. La prévisualisation ne modifie rien et reste réservée à l’administrateur.
Aucune migration de base de données n’est nécessaire.
