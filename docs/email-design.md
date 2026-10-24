# Design des emails Inkera Studio

Tous les emails utilisent `src/email/email-layout.ts` : les 25 modèles
transactionnels, les notifications de messagerie et le mail de test Mailgun.
Le nom du salon ou de l'artiste reste visible comme contexte sous la marque
Inkera et dans le pied de page des emails concernés.

## Charte

La palette vient du frontend (`app/globals.css`) : noir `#131313`, nude
`#c79f8b`, brun `#3e2c27`, orange `#ff9d00` et accent `#ff5500`.
Les surfaces claires `#fffdfb` et `#f5eee9` gardent les messages lisibles.
Les boutons orange utilisent du texte sombre pour le contraste.

Didact Gothic est utilisée pour le corps, Exo 2 pour les titres et les actions,
Montserrat Alternates pour la signature de marque. Les polices distantes sont
une amélioration progressive : Arial/Helvetica prennent le relais si elles
sont bloquées. Outlook classique reçoit explicitement Arial.

La structure principale utilise des tableaux de présentation et une largeur
maximale de 600 px, avec un tableau conditionnel pour Outlook. Les styles
essentiels sont intégrés aux éléments HTML. Les boutons disposent d'une cellule
avec couleur de fond et espacement de secours pour Outlook. Les requêtes média
adaptent les marges et la largeur des boutons sur mobile. Le contenu reste
lisible sans images, sans polices distantes et sans la feuille CSS embarquée.

## Prévisualiser

```powershell
npm.cmd run preview:emails
npm.cmd run check:email-previews
```

La galerie est générée dans `.tmp/email-previews/index.html` avec 27 aperçus
fictifs et des modes desktop/mobile. Le contrôle visuel nécessite Chrome ou
Edge sur Windows. Il vérifie les 27 rendus à 375 et 900 px, l'absence de
débordement horizontal, et la hauteur des boutons (44 px minimum). Les captures
et le rapport JSON sont enregistrés dans le même dossier. Ces commandes
n'envoient aucun email et ne se connectent pas à la base.

Les modèles transactionnels sont également disponibles en développement :
`/dev/email-preview?template=email-verification`. Les noms possibles sont
déclarés dans `src/email/email-preview.data.ts`. Cet endpoint reste désactivé
en production.

## Validation et limites

Les tests couvrent la génération de tous les modèles, les liens d'action,
le style de secours intégré et l'échappement des données de messagerie.
Les aperçus Chromium ne remplacent pas des tests reçus dans Gmail, Apple Mail
et Outlook, notamment pour le mode sombre et les particularités Outlook.
Aucun test d'envoi réel n'est exécuté par la galerie.

Références de compatibilité :
[CSS pris en charge par Gmail](https://developers.google.com/gmail/design/css),
[rendu HTML dans Outlook](https://learn.microsoft.com/en-us/troubleshoot/outlook/user-interface/formatting-lost-when-editing-the-htmlbody-property).
