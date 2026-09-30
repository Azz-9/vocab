# Vocab Trainer

## Arborescence
```
index.html
style.css
script.js
vocab.json
assets/
  audio/    <- tes fichiers .mp3
  icons/    <- correct.svg, wrong.svg, sound.svg
```

## Déploiement sur GitHub Pages
1. Crée un repo, mets-y tous ces fichiers en gardant l'arborescence ci-dessus.
2. Settings → Pages → source = branche principale, dossier `/root`.

## Remplir le vocabulaire
Édite `vocab.json` en gardant le format donné : `terms` = liste de semestres, chaque semestre = liste de catégories `{name, list}`, chaque entrée de `list` = `{en:[...], fr:[...]}` où `fr` est une liste de chaînes (synonymes) et `en` est une liste d'objets `{word, phonetic?, audio?}` — un objet par mot anglais synonyme, chacun avec sa propre prononciation/audio. `phonetic` et `audio` sont optionnels et gérés indépendamment pour chaque mot anglais. Les fichiers audio vont dans `assets/audio/` (n'importe quel format lisible par le navigateur : mp3, ogg, wav...).

Quand une question affiche un seul mot anglais (QCM EN → FR, ou audio), l'appli choisit **aléatoirement** un des synonymes anglais de l'entrée (et son audio/phonétique associés) à chaque fois — ex. tantôt "Abroad", tantôt "Overseas" pour la même entrée.

## Icônes
`correct.svg`, `wrong.svg` et `sound.svg` sont injectés en inline dans le DOM (fetch + innerHTML), ce qui permet de contrôler leur taille et leur couleur en CSS via les classes `.icon-sound`, `.icon-correct`, `.icon-wrong` (règles `width`, `height`, `fill`) dans `style.css`.

## Mode sombre
Le bouton en haut à droite bascule entre clair/sombre ; le choix est mémorisé dans le `localStorage` (clé `theme`) et réappliqué au rechargement. Sans préférence enregistrée, l'appli suit le thème du système.

## Raccourci clavier
Sur une question à réponse tapée, Entrée valide la réponse ; une fois la correction affichée, Entrée (ou le bouton Suivant) passe à la question suivante — ça marche aussi après une réponse en QCM.

## Normalisation des réponses tapées
Certains mots du JSON contiennent des précisions entre parenthèses (ex: `"Blow (blew, blown)"`, `"Cart (US) (trolley (UK))"`). Lors de la correction d'une réponse tapée, tout le contenu entre parenthèses est retiré avant comparaison (y compris les parenthèses imbriquées), donc l'utilisateur n'a qu'à taper `Blow` ou `Cart`. Le texte complet (avec parenthèses) reste affiché dans le feedback pour information.

## Mode infini
La case « Mode infini » sur l'écran de sélection ignore le nombre de questions : les questions sont générées à la volée sans limite. Un bouton « Arrêter » apparaît pendant le quiz pour terminer à tout moment et afficher le score obtenu sur le nombre de questions réellement faites.

## Blocage audio
Sur une question qui nécessite de l'audio, le bouton « Je ne peux pas écouter » désactive les types de questions audio (`audio_to_en_choice`, `audio_to_fr_choice`, `audio_type_en`) pendant 15 minutes (stocké dans `localStorage`, clé `audioBlockedUntil`) et régénère immédiatement une nouvelle question (sans pénalité).

## Ajuster les types de questions
Sur l'écran de sélection, le bloc dépliable « Pondération des types de questions » permet de régler à la volée le poids (probabilité relative) de chaque type avant de lancer un test :
- `fr_to_en_type` : mot FR → taper l'anglais
- `en_to_fr_choice` : mot EN (+ phonétique/audio si dispo) → QCM français
- `audio_to_en_choice` : audio → QCM anglais
- `audio_to_fr_choice` : audio → QCM français
- `audio_type_en` : audio → taper l'anglais (dictée)

Mettre un poids à 0 désactive complètement ce type. Les types `audio_*` ne sortent de toute façon que pour les mots qui ont un champ `audio`, et pas du tout tant que le blocage de 15 min est actif.

Les valeurs par défaut (affichées au chargement) restent réglables dans le code, dans l'objet `WEIGHTS` en haut de `script.js`.
