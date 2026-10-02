# BoP Vector Map Editor

Éditeur **vectoriel** de provinces pour WW2 Sphere. Même esprit que BoP Map Editor 2 (PWA, stylet/souris,
hors-ligne), mais les provinces sont des **polygones lon/lat** et non des pixels.

Départ : carte du monde **Natural Earth** (terres, 242 pays déjà séparés, frontières voisines partagées).
50 m par défaut, **10 m** (côtes précises, ~545 000 sommets) via la carte « Nouveau — détaillé ». Tu **découpes**
les terres en provinces, tu génères les **mers**, tu regroupes en pays / régions.

## Lancer

```
python -m http.server 8778      # dans ce dossier
# puis http://localhost:8778
```
(`index.html` en `file://` marche aussi, sans hors-ligne ; le 10 m demande le serveur.)

## Vues et outils

| Vue (touche) | Outils |
|---|---|
| **Provinces** `1` | Sélection `V` · **Découpe** `C` · **Fusion** `M` · Sommets `D` · **Polygone** `P` · Éclater · Supprimer · **Océans** |
| **Pays** `2` / **Régions** `3` | Assigner `A` (glissé, clic droit = retirer) · Pipette `I` · Voir · Nommer les provinces |
| **Terrain** `4` | Stylo (12 terrains, `[` `]`) · Pipette |
| **Fonds** `5` | Placer `B` : déplacer / redimensionner (coins, ratio conservé) jusqu'à 3 images, opacité, ordre |

- **Découpe** : trace à main levée à travers les terres (dépasse de chaque côté) ou clique des points puis
  double-clic / `Entrée`. Coupe toutes les provinces traversées, trous compris ; les voisines reçoivent les
  nouveaux sommets (pas de T-jonction).
- **Fusion** : sélectionne une province puis clique les voisines. **Vraie union** : la frontière commune
  disparaît des données ; si les contours ne concordent pas, les parties sont conservées (message).
- **Océans** (🌊 ou menu) : génère les mers = complément exact des terres dans le monde (-180..180, -90..90),
  collé aux côtes. Une zone par bassin (Océan, Mer 1, 2…), terrain « mer ». Découpe-les ensuite avec **Découpe**,
  fusionne-les avec **Fusion**. Relançable : ne crée que ce qui manque.
- **Polygone** : clique des points (accrochés aux sommets existants) ; ferme en recliquant le 1er point, double-clic
  ou `Entrée`. Dans une terre → **trou + nouvelle province** (lac…) ; dans le vide → nouvelle zone. Type choisi dans
  le panneau (Mer / Terre / Lac). Refusé s'il traverse une province ou se recoupe.
- **Sommets** : glisse un sommet (les provinces voisines qui le partagent suivent) ; clique une arête de la province
  sélectionnée pour ajouter un sommet ; clic droit sur un sommet pour le supprimer.
- **Recherche** `/` : provinces et pays, `Entrée` pour y aller. **Bilan** (☰) : terres sans pays/région/terrain,
  mers rattachées à un pays, noms en double, minuscules provinces, pays/régions vides — chaque entrée est cliquable.
  L'export rappelle les problèmes bloquants.
- **Nommer les provinces** (panneau Pays/Région) : « Nom 1, Nom 2… » du nord au sud.
- `Ctrl+Z` / `Ctrl+Y`, `F` tout voir, `L` noms, `Espace` déplacer. Tablette : 2 doigts = déplacer/zoomer, doigt/paume
  ignorés quand le stylet touche.

## Projets

Sauvegarde auto dans le navigateur (IndexedDB). Menu ☰ → **.bopvec** (projet complet, JSON, fonds inclus).
Accueil → Importer : `.bopvec` ou **GeoJSON** (Polygon/MultiPolygon) pour partir de ta propre carte.
`node tools/build-ne.js <in.geojson> <out.js> 4 NE10_COUNTRIES` régénère un jeu de données.

## Export (☰ → Export complet → .zip)

- `provinces.json` — `{ format:1, projection:'equirectangular', unit:'degrees', terrains, provinces:[{id,name,color,country,region,terrain,type,bbox,polygons}] }`
  · `polygons` = `[ [ anneau extérieur, trous... ], ... ]`, anneaux fermés `[lon,lat]`, extérieur anti-horaire, trous horaires.
  · `type` = `land` / `sea` / `impassable` (déduit du terrain ; mer = terrain « mer », lac = « infranchissable »).
- `provinces.geojson` — mêmes données en FeatureCollection de MultiPolygon.
- `regions.json`, `countries.json` — comme BoP Map Editor 2 (pays d'une région = pays majoritaire de ses provinces).

## Fichiers

`index.html` (UI) · `core.js` (géométrie : découpe, union, complément, ZIP — testable sous node) ·
`ne50.js` / `ne10.js` (données Natural Earth, domaine public) · `sw.js`, `manifest.webmanifest`.
Tests : `node tools/test-core.js` ; `tools/selftest*.html` (Chrome headless : `chrome --headless=new --virtual-time-budget=90000 --dump-dom http://localhost:8778/tools/selftest2.html`).

## Limites connues

- Une corde de découpe qui part et revient sur le même trou n'est pas gérée.
- Les noms/couleurs de pays et régions ne sont pas annulables (les assignations de provinces le sont).
- Le 10 m pèse ~16 Mo de projet : la sauvegarde auto (toutes les 4 s après modification) est un peu plus lente.
- Les terres chevauchant l'antiméridien sont déjà coupées à ±180° dans Natural Earth ; pas de projection spéciale.

## Test bout-en-bout

`tools/e2e.js` pilote un vrai Chrome (souris, stylet, tactile, IndexedDB, export, hors-ligne, perf 10 m). Prérequis : `npm i puppeteer-core` et le serveur sur le port 8778 (voir plus haut), puis `node tools/e2e.js` (adapte le chemin de chrome.exe en tête de fichier si besoin).


## Utiliser la carte dans le globe Godot (WW2 Sphere)

1. Éditeur → ☰ → **Export complet** → un `.zip`.
2. `cd ww2_map_benchmark_godot4\data` puis `python build_world_from_vector.py <export.zip>` (3 s pour 400 provinces,
   libs : numpy shapely triangle pillow). Écrit `data/vector/{world.json, fill.bin, chains.bin, province_ids.dat}`.
3. Le jeu charge `data/vector/` s'il existe (`-- --world=raster` force l'ancien monde WorldPaint). Les couleurs de pays
   choisies dans l'éditeur, les noms de provinces et de régions apparaissent dans le HUD ; mer et lac = eau, terrain
   « infranchissable » = zone injouable, régions de l'éditeur = états (les provinces sans région sont regroupées
   automatiquement par ~10).
4. Test : `godot --headless --path . -- --selftest`.


## Sauvegarde cloud (reprendre le même projet de n'importe où)

Les projets sont stockés dans le navigateur de chaque appareil ; le **cloud GitHub** les synchronise (menu ☰ → *Cloud GitHub*,
ou la carte « Ouvrir depuis le cloud » de l'accueil).

Mise en place, **une seule fois** :
1. GitHub → *New repository* → nom `bop-saves` → **Private**.
2. GitHub → Settings → Developer settings → *Fine-grained tokens* → Generate : *Only select repositories* = `bop-saves`,
   permission **Contents : Read and write**.
3. Dans l'éditeur : Dépôt = `ton-compte/bop-saves`, Jeton = celui créé, *Enregistrer et tester*.
   Sur chaque nouvel appareil, seule cette étape 3 est à refaire.

Fonctionnement : chaque projet est un fichier `saves/<nom>.bopvec.gz` (compressé, ~0,7 Mo en 50 m). Envoi automatique ~15 s
après chaque sauvegarde locale (désactivable), ou bouton « Envoyer maintenant ». « Ouvrir depuis le cloud » liste les projets du
dépôt. Un projet est lié au cloud par son nom et le *sha* de la dernière version synchronisée : si un autre appareil a envoyé
une version entre-temps, l'envoi automatique s'arrête avec un message de conflit (rien n'est écrasé en silence) ; tu choisis
ensuite de récupérer la version du cloud ou d'écraser. Bonus gratuit : l'historique Git garde toutes les versions.
Le jeton n'est stocké que dans le `localStorage` de l'appareil et n'est envoyé qu'à api.github.com.
Tests : `node tools/cloudtest.js` (faux serveur GitHub `tools/ghfake.js`, deux profils Chrome = deux appareils).
## Publier (GitHub Pages)

Le dossier `deploy/` contient uniquement les fichiers utiles (`index.html`, `core.js`, `ne50.js`, `ne10.js`, `sw.js`,
manifest, icônes). Pousse son contenu à la racine d'un dépôt GitHub, puis Settings → Pages → branche `main`, dossier `/`.
(Le 10 m pèse 8,6 Mo, chargé uniquement si tu le choisis.)