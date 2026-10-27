# Audit des villes existantes

Ce script ne modifie aucune donnée : la transaction PostgreSQL est explicitement
en lecture seule. Il examine les champs `city` et `postalCode` de `User` et de
`ClientProfile`, sans exporter les noms, adresses email ou autres données du compte.

## Exécution

Depuis la racine du backend, avec `DATABASE_URL` configurée pour la base à auditer :

```powershell
npm.cmd run audit:cities -- --communes="D:/CORPORATE/INKERA/Frontend/inkstudio-front/public/data/communes-france.json"
```

Sur le serveur, fournir le fichier `public/data/communes-france.json` de la version
du frontend déployée, puis passer son chemin avec `--communes=...`.
Le référentiel n'est pas téléchargé : l'audit doit utiliser exactement la même liste
que le sélecteur d'inscription. Son empreinte SHA-256 figure dans le rapport.

Le fichier JSON est créé dans `reports/cities/` (exclu de Git). On peut choisir
un autre emplacement avec `--output=...`. Un rapport existant n'est jamais écrasé.
Seul `state: "complete"` signifie que l'audit a abouti. Un fichier `running` ou
`failed` ne constitue pas un audit exploitable. Les rapports contiennent des
identifiants et des localisations : les conserver dans un emplacement privé.

## Lecture du rapport

- `conform` : nom officiel et code postal déjà conformes.
- `correctable` : une seule commune correspond au nom normalisé **et** au code
  postal. `before` conserve les valeurs actuelles, `after` propose les valeurs
  officielles. Les accents, la casse et les séparateurs sont ignorés pour le
  rapprochement ; les abréviations et fautes de frappe ne sont pas devinées.
- `review` : nom inconnu, code postal manquant ou incompatible, homonyme ambigu,
  etc. Jusqu'à dix candidats sont fournis pour aider une vérification humaine.
  Aucune correction n'est proposée sur le seul code postal.
- `missing` : ville et code postal absents.

Le rapport conserve aussi la date `updatedAt` de chaque ligne, le code INSEE de
la correspondance et les anciens/nouveaux slugs de localisation. Les clients
peuvent avoir deux localisations distinctes (`User` et `ClientProfile`) ; elles
sont évaluées séparément, sans écraser l'une avec l'autre.

## Avant une future application

L'audit n'a pas d'option `--apply` : les caches et les URL restent inchangés.
Après examen du rapport, préparer une commande distincte qui :

1. ne traite que les lignes `correctable`, en vérifiant que les anciennes valeurs
   et `updatedAt` n'ont pas changé depuis l'audit ;
2. conserve un historique des modifications et permet leur annulation ;
3. préserve les URL publiques quand `slugChanged` est vrai (redirection/alias,
   à prévoir avant toute modification de ces profils) ;
4. invalide les caches des profils, listes, villes et slugs après écriture.

Les cas `review` et `missing` doivent être confirmés par l'utilisateur dans le
sélecteur officiel déjà présent dans la modification du salon, ou vérifiés
manuellement. `correctable` désigne une correspondance certaine, pas une
autorisation d'écriture sans ces vérifications.

## Vérification locale

```powershell
npm.cmd test -- --runInBand src/user/city-audit.spec.ts
```
