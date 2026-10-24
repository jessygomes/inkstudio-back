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
