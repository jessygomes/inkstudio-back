# Vérifications de sécurité après déploiement

Liste en cours de construction au fil des corrections. Elle sera complétée et
remise à la fin du chantier. Une case reste vide tant que le contrôle n'a pas été
effectué sur l'environnement cible. Utiliser des comptes et documents de test.

## Versions et configuration

- [ ] Vérifier les versions réellement livrées du backend et des deux frontends, les variables requises et l'absence d'erreur au démarrage.
- [ ] Confirmer la migration `20261029120000_verified_google_identity` sur la base cible.
- [ ] Contrôler HTTPS, les en-têtes de sécurité, CORS et l'accès aux documents sensibles.

## Connexion et sessions — SEC-01, DEP-02, SEC-07

- [ ] Vérifier l'audience Google backend, puis une connexion Google et une connexion par mot de passe sur chaque frontend.
- [ ] Vérifier la liaison autorisée d'un compte Google existant et le refus d'un jeton invalide ou destiné à une autre application.
- [ ] Vérifier la reconnexion obligatoire des anciennes sessions et les nouveaux cookies HttpOnly / Secure / SameSite.
- [ ] Vérifier la déconnexion, l'expiration, les redirections des pages privées et le refus du back-office pour un compte non administrateur.
- [ ] Vérifier qu'une mise à jour de session ne permet pas de changer d'identité, de rôle ou de jeton.

## Abonnements — SEC-02

- [ ] Vérifier le refus sans authentification des routes SaaS protégées et l'absence des anciennes routes publiques de réparation / changement de forfait.
- [ ] Vérifier qu'un compte ne peut pas consulter ou modifier le forfait d'un autre compte.
- [ ] Vérifier l'affichage du forfait et des fonctionnalités sur le frontend professionnel.

## Images et documents — DEP-01, DEP-03

- [ ] Vérifier l'affichage et le redimensionnement des images sur les deux frontends.
- [ ] Télécharger une facture de test et vérifier ses données, son montant et sa lisibilité.
- [ ] Générer et envoyer un consentement signé de test ; vérifier la signature et les coordonnées du représentant légal pour un mineur.

## Proxies et limitation — DEP-04

- [ ] Identifier la chaîne réelle CDN / load balancer / reverse proxy jusqu'au backend et les adresses sources vues par celui-ci.
- [ ] Définir `TRUSTED_PROXY_CIDRS` avec les seules adresses / sous-réseaux des proxies autorisés. Sans valeur, le backend utilise l'IP de la connexion directe, ce qui peut regrouper les visiteurs derrière un même proxy.
- [ ] Vérifier que les proxies retirent / reconstruisent les en-têtes transmis par le client et que l'origine ne permet pas de contourner les contrôles du proxy.
- [ ] Vérifier que deux clients distincts obtiennent des budgets IP distincts pour l'inscription et le contact public.
- [ ] Vérifier que changer une adresse ajoutée à `X-Forwarded-For` ne réinitialise pas le budget du même client.
- [ ] Vérifier la réponse 429 et `Retry-After` après dépassement, sans déclencher d'envoi réel massif.

## Suppressions de fichiers — SEC-03

- [ ] Confirmer sur la base cible que `20261029150000_upload_file_ownership` est appliquée (déjà appliquée le 29 octobre 2026 sur la base configurée du backend Railway).
- [ ] Configurer deux secrets distincts et aléatoires : backend `UPLOAD_OWNERSHIP_PRO_SECRET` / `UPLOAD_OWNERSHIP_PUBLIC_SECRET`, chacun correspondant au `UPLOAD_OWNERSHIP_SECRET` du frontend concerné. Ne jamais utiliser de variable publique pour ces secrets.
  Configuration locale et variables du backend Railway effectuées le 29 octobre 2026 sans redéploiement ; ajout dans les deux projets Vercel confirmé par l'utilisateur. Concordance et activation à vérifier après déploiement.
- [ ] Vérifier les callbacks UploadThing réels et l'enregistrement de la bonne application, de la clé et du propriétaire ; vérifier qu'un nouvel upload authentifié reste utilisable dans le produit.
- [ ] Vérifier qu'une suppression sans session ou depuis un autre compte est refusée, sans suppression physique.
- [ ] Vérifier qu'un propriétaire peut supprimer son nouveau fichier et qu'il disparaît effectivement du stockage ; essayer aussi un lot mélangeant un fichier autorisé et un fichier interdit, qui doit être refusé en entier.
- [ ] Vérifier les parcours de photos, flashs, produits, messagerie, moodboards, consentements et documents professionnels.
- [ ] Vérifier que les uploads invités des réservations et des liens de suivi fonctionnent sans revendiquer une propriété de compte ni obtenir de droit de suppression.
- [ ] Vérifier les suppressions après retrait de la référence en base : l'autorisation doit encore reposer sur le registre stable.
- [ ] Vérifier le nettoyage administrateur : seulement les fichiers prouvés du compte cible, y compris le cas de plus de 20 fichiers. Le refus de fichiers historiques peut laisser du stockage à nettoyer séparément.
- [ ] Inventorier les anciens fichiers et établir leur propriétaire à partir de preuves fiables avant une reprise contrôlée ; ne pas attribuer automatiquement les fichiers à partir des URL actuelles.
- [ ] Vérifier qu'une panne du registre ou des secrets ne permet aucune suppression ; surveiller les échecs de callback et de suppression sans journaliser de secrets ni de documents sensibles.

## Suivis et historique — SEC-04

- [ ] Vérifier qu'un appel sans connexion ou avec un JWT expiré ne peut pas créer / modifier / supprimer un suivi Aftercare ni créer un historique de tatouage.
- [ ] Avec deux comptes professionnels distincts, vérifier qu'un compte ne peut pas écrire dans le dossier client de l'autre, même en connaissant ses identifiants.
- [ ] Vérifier la création, la modification et la suppression d'un suivi appartenant au compte connecté, ainsi que la création et les opérations existantes d'historique.
- [ ] Vérifier qu'un suivi ne peut pas être déplacé vers une fiche d'un autre compte par ajout de champs dans la requête.
- [ ] Vérifier le lien public de cicatrisation : lien valide, expiré, déjà utilisé ; confirmation de soumission unique et consultation par le salon concerné.
- [ ] Vérifier qu'un autre salon ne peut ni répondre à une soumission ni la supprimer, et qu'aucun email n'est envoyé en cas de refus.

## Données publiques / privées — SEC-05

- [ ] Déployer le backend avant le frontend professionnel qui appelle `GET /users/:userId/private`.
- [ ] Vérifier qu'un identifiant de compte client, administrateur ou formateur ne renvoie pas un profil professionnel public, y compris sans connexion.
- [ ] Contrôler les réponses par identifiant et par slug : absence de profil client, date de naissance, hash de mot de passe, identifiant Google et identifiants de facturation privés.
- [ ] Vérifier les profils professionnels publics et `SEARCH_HIDDEN`, leurs coordonnées professionnelles, les prestations, les horaires, les artistes liés et la redirection de réservation vers l'artiste choisi.
- [ ] Vérifier que `/users/:id/param` et `/users/:id/private` refusent l'accès sans connexion ou depuis un autre compte et autorisent le propriétaire, y compris pour son profil masqué.
- [ ] Vérifier `/auth`, la modification de compte et les paramètres professionnels ; confirmer `Cache-Control: private, no-store` sur les lectures privées.
- [ ] Vérifier qu'aucune ancienne réponse privée ne subsiste dans un cache applicatif / CDN servant les URL publiques ; invalider ces réponses si nécessaire.

## Identité de réservation et liaisons — SEC-06

- [ ] Livrer le backend puis le frontend public ; vérifier la réservation invitée et la réservation avec un compte client connecté.
- [ ] Vérifier qu'un JWT expiré ou forgé est refusé, qu'un jeton professionnel ne devient pas une identité client et qu'un `clientUserId` contradictoire ne provoque aucune écriture.
- [ ] Avec deux comptes clients, tenter d'utiliser l'identifiant ou le moodboard de l'autre : refus sans création de fiche CRM ni de rendez-vous.
- [ ] Réserver en invité avec l'email d'un compte de test existant : aucun rattachement au compte, aucune récupération de son ancien dossier et aucune conversation de compte automatique.
- [ ] Réserver connecté avec un email différent saisi dans la requête : liaison au compte réellement connecté et notification à son adresse canonique.
- [ ] Vérifier la réutilisation d'une fiche déjà liée dans le bon salon, sans réutilisation de la fiche d'un autre salon ni fusion avec une ancienne fiche non liée.
- [ ] Vérifier les créations professionnelles : pas de liaison de compte par email seul ; premier rendez-vous avec une proposition acceptée, y compris le refus d'une acceptation retirée.
- [ ] Vérifier les moodboards propres, publiés et explicitement partagés ; refuser le moodboard privé non partagé d'un autre client.
- [ ] En préproduction avec des données synthétiques, provoquer un échec sur le détail de prestation : aucune fiche ou réservation partielle ne doit rester, y compris pour un artiste lié.
- [ ] Vérifier les statuts PENDING / CONFIRMED, les emails, la messagerie et la visibilité des nouvelles réservations / fiches après commit ; surveiller les échecs de notification sans confondre échec d'email et échec de réservation.
- [ ] Vérifier le parcours Gleamy Ink → artiste lié FREE → salon Business : bon artiste, bon salon gestionnaire et conservation du lieu de réservation.
- [ ] Examiner les anciennes associations compte / CRM / moodboard créées avant le correctif ; ne pas supposer qu'un lien historique prouve l'identité. Prévoir une vérification avant tout rapprochement des fiches invitées.

## Créneaux et artistes internes — SEC-08

- [ ] Avec des données synthétiques en préproduction, lancer deux réservations simultanées sur le même créneau et le même artiste : une seule doit être enregistrée. Vérifier sur PostgreSQL réel, les tests locaux utilisant un double de transactions avec verrouillage simulé.
- [ ] En mode PAR_TATOUEUR, deux artistes distincts peuvent recevoir un rendez-vous au même horaire ; un rendez-vous non assigné et un blocage global rendent ce créneau indisponible pour tous. En mode GLOBAL, tout rendez-vous actif ou blocage du salon rend le créneau indisponible.
- [ ] Vérifier que les statuts PENDING et CONFIRMED occupent le créneau, que les intervalles adjacents restent autorisés et que le déplacement d'un rendez-vous ne le détecte pas lui-même comme conflit.
- [ ] Envoyer directement une réservation publique pour un artiste désactivé, étranger au salon, un profil masqué / FREE / expiré, une prestation non proposée, une date passée ou hors horaires : refus et aucune écriture partielle.
- [ ] Vérifier que l'affichage et l'enregistrement utilisent les horaires de l'artiste sélectionné en Europe/Paris, y compris lorsque le serveur est en UTC et lors des changements d'heure.
- [ ] Vérifier le déplacement par le client et la confirmation par le salon : aucun chevauchement ni réactivation d'un rendez-vous annulé / terminé via confirmation. Un créneau bloqué doit également être refusé lors d'une saisie manuelle ; les horaires publics ne limitent pas cette saisie manuelle.
- [ ] En préproduction, mettre en concurrence une création de blocage et une réservation : si le blocage est validé en premier, la réservation doit être refusée. Une indisponibilité ajoutée après un rendez-vous existant ne l'annule pas automatiquement.
- [ ] Simuler une panne de lecture des disponibilités en préproduction : afficher une erreur, jamais des créneaux présentés comme disponibles par défaut.
- [ ] Rejouer le parcours d'un artiste lié FREE dans son salon Business ; vérifier que la gestion des résidences et du lieu de rendez-vous fonctionne toujours.

## Tentatives et liens email — SEC-09

- [ ] Vérifier sur Redis réel que `EVAL`, `INCR`, `TTL` et `EXPIRE` sont autorisés pour le backend. Une panne ou un délai Redis refuse ces opérations en 503 ; prévoir une alerte pour éviter de laisser les connexions et réservations indisponibles sans diagnostic.
- [ ] En préproduction, répartir des demandes entre deux instances backend : les quotas doivent rester partagés, renvoyer 429 avec `Retry-After` puis permettre une nouvelle tentative après expiration. Le script Lua et les verrous PostgreSQL doivent être vérifiés réellement ; les tests locaux utilisent des doubles.
- [ ] Vérifier l'IP observée pour les parcours navigateur et pour les appels serveur Vercel → Railway. Plusieurs utilisateurs peuvent partager une IP de sortie. Ajuster les quotas IP au trafic réel sans faire confiance à un en-tête envoyé librement par le client.
- [ ] Vérifier les quotas par email malgré les variantes de casse / espaces, par compte connecté malgré un changement d'email déclaré, et par IP malgré un changement de `X-Forwarded-For` non fiable. Ne jamais bloquer tout un salon sur la seule base de son identifiant public.
- [ ] Vérifier que les deux frontends affichent correctement les refus temporaires 429 / 503 et permettent la reprise après le délai, sans boucle automatique d'envoi d'emails ou de réservations.
- [ ] Avec un compte synthétique, valider une nouvelle inscription et le renvoi depuis la connexion non vérifiée : lien long, expiration de 10 minutes, ancien lien invalidé après renvoi, consommation unique.
- [ ] Prévenir que les liens de vérification et de réinitialisation émis avant cette livraison sont invalides. Renvoyer une vérification par connexion avec mot de passe, ou redemander « mot de passe oublié ». Aucune migration de schéma ni secret supplémentaire n'est requis.
- [ ] Vérifier « mot de passe oublié » pour un compte existant et une adresse inexistante : message générique identique ; lien valable 15 minutes, nouveau lien invalidant le précédent, refus d'un mot de passe trop court ou dépassant 72 octets UTF-8.
- [ ] Vérifier que les nouvelles émissions stockent `sha256:…`, jamais le secret de lien brut. Les anciennes lignes en clair peuvent rester jusqu'à nettoyage, mais ne doivent plus être acceptées. Une empreinte de vérification ne doit pas être utilisable pour une réinitialisation, même copiée dans l'autre table.
- [ ] En préproduction sur PostgreSQL réel, utiliser simultanément deux fois chaque type de lien : une seule modification doit réussir. En cas d'échec de mise à jour du compte, la consommation du lien doit être annulée avec la transaction.
- [ ] Surveiller les refus de limitation, les erreurs Redis et la délivrabilité des emails, sans journaliser les mots de passe ni les secrets des liens. La révocation des JWT après changement de mot de passe reste suivie dans SEC-11.

## Autorisations et quotas des uploads — SEC-10

- [x] Appliquer `20261029190000_upload_reservations` avant la livraison du backend et des deux frontends : appliquée le 29 octobre 2026 à la base configurée (`inkstudio`, schéma `public`). État des 26 migrations à jour, colonnes et index vérifiés en lecture seule. Aucun nouveau secret ; vérifier les correspondances SEC-03 existantes lors de la livraison.
- [ ] Livrer les trois applications et contrôler qu'aucun routeur ancien ouvert n'est encore actif. Le backend seul ne protège pas un ancien frontend qui continuerait à générer des URLs d'envoi sans réservation de quota.
- [ ] Vérifier sur PostgreSQL réel deux transferts simultanés dépassant ensemble un budget : un seul doit obtenir une autorisation. Vérifier les budgets partagés entre les deux applications et le pool invité, par volume et nombre de fichiers.
- [ ] Revoir les plafonds techniques configurables avant livraison : professionnel 2048 MiB / 512 MiB par jour / 200 fichiers par jour, client 256 MiB / 128 MiB par jour / 40 fichiers par jour, invité ou lien de suivi 40 MiB / 10 fichiers par jour. Pool invité global : 20480 MiB et 10000 fichiers. Les paramètres et leurs valeurs par défaut sont documentés dans SEC-10.
- [ ] Vérifier l'IP de sortie Vercel → Railway et adapter `SECURITY_RATE_LIMIT_UPLOAD_IP_MAX` au trafic réel si nécessaire. Le quota de préparation vaut 240 demandes / 15 minutes par défaut, partagé entre instances via Redis.
- [ ] Vérifier les uploads authentifiés : profil, galerie, portfolio par lots, messagerie, dessin, photos de rendez-vous, documents de vérification et PDF de consentement. Le consentement doit être refusé pour un client d'un autre compte et les documents professionnels pour un simple compte client.
- [ ] Vérifier qu'un invité sans contexte, une session expirée, un lien de suivi expiré / utilisé ou un profil de réservation non éligible sont refusés avant génération de l'URL de transfert.
- [ ] Rejouer la réservation invitée avec référence et croquis, puis le suivi sans compte. Vérifier le cookie HttpOnly signé, le contexte du registre, le quota et le rattachement transactionnel des images. Vérifier aussi le parcours FREE lié à un salon Business autorisé.
- [ ] Vérifier sur UploadThing réel que chaque fichier conserve le `customId` de sa réservation, que le callback contient la taille réelle et que `awaitServerData: true` attend l'enregistrement backend. Vérifier l'expiration des URLs d'envoi à 10 minutes et le refus des callbacks expirés / réutilisés avec une autre clé.
- [ ] Provoquer en préproduction un callback refusé, puis un callback au résultat réseau incertain : suppression prudente après refus certain, conservation du fichier et du quota en cas de résultat incertain. Un timeout ne doit pas libérer de capacité ni supprimer un fichier éventuellement déjà enregistré.
- [ ] Vérifier les déclarations de type et les limites : SVG interdit, PDF interdit sur le canal images, un seul document au total, 8 MiB maximum pour images / consentements et 32 MiB pour documents. Ce contrôle ne remplace pas une analyse antivirus ou une inspection du contenu.
- [ ] Sur chaque frontend, exécuter d'abord `node --env-file=.env scripts/cleanup-upload-reservations.cjs` avec les variables de l'application cible : simulation uniquement. Utiliser le fichier d'environnement réellement configuré si ce n'est pas `.env`. Ne pas exposer les secrets dans les journaux.
- [ ] En préproduction avec des données synthétiques de plus de 24 heures, lancer le même script avec `--apply`. Vérifier la réclamation CLEANING, la suppression par `customId`, la confirmation du fournisseur ou l'absence exacte et le passage en DELETED. Une panne doit conserver le quota et permettre une reprise. Traiter les lots de 100 jusqu'à résorption du retard.
- [ ] Mettre en concurrence nettoyage et rattachement d'une photo invitée : une photo déjà rattachée est conservée ; une photo réclamée pour nettoyage ne peut plus être rattachée. Les uploads de compte terminés ne doivent pas être supprimés automatiquement.
- [ ] Vérifier la suppression normale d'un fichier de compte : autorisation SEC-03 puis reçu signé après suppression physique. La capacité reste conservée jusqu'au contrôle différé après expiration des URLs d'envoi ; ne pas la libérer sur simple délai ou erreur.
- [ ] Définir une exécution régulière du nettoyage et une alerte sur les budgets saturés, les réservations / CLEANING anciens et les échecs de callbacks. Aucun nettoyage ni automatisme de production n'a été exécuté / installé pendant la correction.
- [ ] Réconcilier séparément les fichiers historiques et leur propriété selon SEC-03. Les nouveaux quotas ne constituent pas un inventaire rétroactif. Ne pas supprimer les anciens fichiers sans preuve et ne pas supposer que l'autorisation d'upload rend les URLs de stockage privées.

## Compléments à ajouter

Les points encore ouverts du suivi de remédiation ne sont pas validés par cette
liste. Ajouter leurs contrôles au moment de leur correction, puis effectuer une
revue finale de complétude avant la remise à l'utilisateur.
