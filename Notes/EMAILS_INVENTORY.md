# Inventaire des emails envoyés par l'application

Ce document liste les emails réellement envoyés par le backend, avec le moment où ils partent, à qui ils sont destinés et les points d'entrée principaux dans le code.

## Authentification et compte

| Email | Quand il est envoyé | Destinataire | Code principal |
| --- | --- | --- | --- |
| Vérification email salon | À l'inscription d'un salon, et au login si l'email n'est pas vérifié | Email du salon | [src/auth/auth.service.ts](../src/auth/auth.service.ts) |
| Vérification email client | À l'inscription d'un client, et au login si l'email n'est pas vérifié | Email client | [src/auth/auth.service.ts](../src/auth/auth.service.ts) |
| Notification admin nouvelle inscription | Après création d'un compte salon | Admin configuré via `ADMIN_EMAIL` | [src/auth/auth.service.ts](../src/auth/auth.service.ts) |
| Réinitialisation du mot de passe | Quand l'utilisateur demande un reset via `forgot-password` | Utilisateur ayant demandé la réinitialisation | [src/auth/auth.service.ts](../src/auth/auth.service.ts) |
| Confirmation de changement de mot de passe | Après changement réussi du mot de passe | Utilisateur connecté | [src/auth/auth.service.ts](../src/auth/auth.service.ts) |

## Rendez-vous

| Email | Quand il est envoyé | Destinataire | Code principal |
| --- | --- | --- | --- |
| Confirmation de rendez-vous | Création d'un RDV par le salon, ou confirmation manuelle d'un RDV | Client | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts) |
| RDV en attente de confirmation | Création d'un RDV par un client quand `addConfirmationEnabled = true` | Salon | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts) |
| RDV auto-confirmé | Création d'un RDV par un client quand `addConfirmationEnabled = false` | Client | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts) |
| Notification nouveau rendez-vous | En parallèle du RDV auto-confirmé, pour prévenir le salon | Salon | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts) |
| Modification de rendez-vous | Quand le salon ou le client modifie l'horaire / le tatoueur | Client | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts) |
| Email custom au client | Action manuelle via l'endpoint de mail personnalisé | Client du RDV | [src/appointments/appointments.controller.ts](../src/appointments/appointments.controller.ts), [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts) |
| Annulation de rendez-vous | Quand le salon annule un RDV | Client | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts) |
| Annulation de rendez-vous par le client, notification salon | Quand le client annule son RDV | Salon | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts) |
| Confirmation d'annulation | Quand le client annule son RDV | Client | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts) |
| Proposition de reprogrammation | Quand le salon propose un nouveau créneau | Client | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts) |
| Confirmation de reprogrammation | Quand le client accepte une reprogrammation valide | Client | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts) |
| Notification salon de reprogrammation acceptée | Après validation de la reprogrammation par le client | Salon | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts) |

## Suivi de cicatrisation et retouches

| Email | Quand il est envoyé | Destinataire | Code principal |
| --- | --- | --- | --- |
| Suivi de cicatrisation | Quand un RDV passe au statut `COMPLETED` pour un tattoo ou un piercing, avec envoi différé par scheduler | Client | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts), [src/follow-up/followup-scheduler.service.ts](../src/follow-up/followup-scheduler.service.ts) |
| Réponse du salon au suivi | Quand le salon répond à un suivi déjà soumis | Client | [src/follow-up/follow-up.controller.ts](../src/follow-up/follow-up.controller.ts) |
| Rappel retouches | Quand un tattoo est marqué `COMPLETED`, avec envoi différé par scheduler | Client | [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts), [src/follow-up/followup-scheduler.service.ts](../src/follow-up/followup-scheduler.service.ts) |

## Emails automatiques post-rendez-vous

| Email | Quand il est envoyé | Destinataire | Code principal |
| --- | --- | --- | --- |
| Suivi J+7 | Job quotidien lancé à 09:00, pour les RDV `COMPLETED` éligibles jamais traités | Client | [src/appointments/jobs/post-appointment-email.scheduler.ts](../src/appointments/jobs/post-appointment-email.scheduler.ts), [src/appointments/post-appointment-email.service.ts](../src/appointments/post-appointment-email.service.ts) |
| Rappel retouches J+30 | Job quotidien lancé à 09:00, pour les tattoos `COMPLETED` jamais traités | Client | [src/appointments/jobs/post-appointment-email.scheduler.ts](../src/appointments/jobs/post-appointment-email.scheduler.ts), [src/appointments/post-appointment-email.service.ts](../src/appointments/post-appointment-email.service.ts) |

## Messagerie

| Email | Quand il est envoyé | Destinataire | Code principal |
| --- | --- | --- | --- |
| Notification de nouveau message | Quand un message est envoyé, que le destinataire est hors ligne, que ses préférences autorisent l'email, puis traitement de la queue toutes les 5 minutes | Autre participant de la conversation | [src/messaging/websocket/messages.gateway.ts](../src/messaging/websocket/messages.gateway.ts), [src/messaging/notifications/email-notification.service.ts](../src/messaging/notifications/email-notification.service.ts), [src/messaging/jobs/email-notification.scheduler.ts](../src/messaging/jobs/email-notification.scheduler.ts), [src/messaging/jobs/send-email-notifications.job.ts](../src/messaging/jobs/send-email-notifications.job.ts) |

## Emails définis mais non branchés en runtime direct

| Email | Statut |
| --- | --- |
| Demande d'avis / feedback | Méthode présente dans [src/email/mailer.service.ts](../src/email/mailer.service.ts) mais pas trouvée dans un appel runtime hors tests |

## Points importants

- Il existe deux mécaniques de suivi/retouches en parallèle : le scheduler in-memory de [src/follow-up/followup-scheduler.service.ts](../src/follow-up/followup-scheduler.service.ts) et le job quotidien de [src/appointments/post-appointment-email.service.ts](../src/appointments/post-appointment-email.service.ts).
- Le scheduler in-memory perd ses timers si le serveur redémarre.
- Les emails de messagerie passent directement par `MailgunService`, pas par `MailService`.

## Références utiles

- [src/email/mailer.service.ts](../src/email/mailer.service.ts)
- [src/auth/auth.service.ts](../src/auth/auth.service.ts)
- [src/appointments/appointments.service.ts](../src/appointments/appointments.service.ts)
- [src/follow-up/followup-scheduler.service.ts](../src/follow-up/followup-scheduler.service.ts)
- [src/appointments/post-appointment-email.service.ts](../src/appointments/post-appointment-email.service.ts)
- [src/messaging/notifications/email-notification.service.ts](../src/messaging/notifications/email-notification.service.ts)