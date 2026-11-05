# Photos des rendez-vous

Migration à déployer avant d'utiliser le nouveau frontend :

```sh
npx prisma migrate deploy
npx prisma generate
```

La migration `20261024150000_appointment_photos` ajoute la table `AppointmentPhoto` et le lien optionnel depuis `Portfolio`. Elle ne modifie pas les rendez-vous existants.

Les images sont envoyées par le frontend à UploadThing, avec le routeur `imageUploader` existant : 5 images maximum par envoi, 8 Mo par image. Plusieurs envois peuvent enrichir un même rendez-vous. Le sélecteur appareil photo utilise `capture="environment"` ; son comportement dépend du navigateur et de l'appareil.

Toutes les routes ci-dessous exigent un JWT :

| Méthode | Route | Résultat |
| --- | --- | --- |
| GET | `/appointments/:id/photos` | Photos du rendez-vous et liens vers le portfolio |
| POST | `/appointments/:id/photos` | Ajoute un lot `{ "photos": [{ "url": "https://…", "caption": "optionnelle" }] }` |
| DELETE | `/appointments/:id/photos/:photoId` | Retire l'association au rendez-vous |
| GET | `/clients/:id/photos` | Photos des rendez-vous du client, avec titre et date du rendez-vous |

L'accès aux photos d'un rendez-vous est réservé à son propriétaire et au compte tatoueur assigné. La galerie client vérifie aussi que la fiche appartient au compte connecté. Ces lectures ne sont pas mises en cache et les photos ne sont pas ajoutées aux routes publiques des rendez-vous.

Pour publier une photo, `POST /portfolio` accepte `appointmentPhotoId` en plus des champs habituels (titre, catégories, styles, taille, hashtags, tatoueur). Le backend vérifie l'accès au rendez-vous et utilise l'URL stockée de la photo source. Une contrainte unique empêche de publier deux fois la même photo dans le portfolio du même compte.

La suppression d'une entrée de portfolio liée conserve le fichier UploadThing utilisé par le rendez-vous. La suppression d'un rendez-vous supprime ses associations photo, mais conserve les entrées déjà publiées au portfolio et leurs fichiers.

Frontend concerné : `D:/CORPORATE/INKERA/Frontend/inkstudio-front`. La galerie partagée `AppointmentPhotos` est intégrée aux détails RDV (agenda, tableau de bord, demandes et messagerie), à l'historique client et au nouvel onglet Photos de sa fiche.

Les tests automatiques vérifient les permissions, la validation des lots, la suppression limitée au bon rendez-vous et la publication à partir de l'URL source. La prise de vue et l'envoi réel à UploadThing restent à vérifier sur appareil avec une session connectée et la migration appliquée.

## Envoi direct depuis l'app mobile (`POST /appointments/:id/photos/upload`)

L'app mobile Inkera Studio ne peut pas utiliser la route Next `/api/uploadthing` (session NextAuth + signature HMAC). Le backend expose donc un envoi multipart qui fait le même travail côté serveur :

| Méthode | Route | Corps | Résultat |
| --- | --- | --- | --- |
| POST | `/appointments/:id/photos/upload` | `multipart/form-data`, champ `photos` (1 à 5 images, 8 Mo max chacune) | Liste des photos créées, comme `POST /appointments/:id/photos` |

Fonctionnement (`AppointmentPhotoUploadService`) :

1. Autorisation du RDV (propriétaire ou tatoueur assigné), puis validation des fichiers : le vrai format est détecté sur les premiers octets (JPEG, PNG, WebP, GIF, HEIC, AVIF), le type annoncé par le client n'est jamais utilisé.
2. Réservation de quota via `UploadQuotaService.prepare` (mêmes plafonds que le site, comptes professionnels uniquement). La demande est signée en interne avec `UPLOAD_OWNERSHIP_PRO_SECRET` (`UploadQuotaService.sign`) : aucune logique de quota n'est dupliquée.
3. Envoi à UploadThing avec le SDK serveur (`UTApi`), la réservation servant de `customId` comme sur le site.
4. Confirmation (`complete`) de chaque fichier, puis création des `AppointmentPhoto`.
5. En cas d'échec, les fichiers déjà envoyés sont supprimés et le quota n'est libéré (`deleted`) qu'après suppression physique confirmée.

Variable d'environnement requise : **`UPLOADTHING_TOKEN`** (la même valeur que le frontend `inkstudio-front`). Sans elle la route répond `503`. À définir en local (`.env`) et sur Railway avant le déploiement.

La route est limitée par `@SecurityThrottle('upload')`. Tests : `appointment-photo-upload.service.spec.ts` (service, avec quota et stockage simulés) et `appointment-photos.upload-route.spec.ts` (câblage multipart : champ, 5 fichiers max, 8 Mo max).
