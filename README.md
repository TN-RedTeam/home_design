# Home Design Studio

Application web professionnelle de **simulation de décoration intérieure** : cartographiez votre maison
pièce par pièce avec les vraies dimensions, ameublez-la virtuellement, testez des couleurs de peinture
et visualisez le résultat en 3D — avant d'acheter ou de repeindre quoi que ce soit.

## Fonctionnalités

### 🏢 Étages multiples reliés par les escaliers
- Niveaux illimités (rez-de-chaussée, étages…) : sélecteur au-dessus du plan, gestion (renommer,
  ajouter, supprimer) dans le panneau Propriétés
- Chaque niveau a ses pièces et ses meubles ; les contours du niveau inférieur s'affichent en
  filigrane pour aligner les murs porteurs
- **Liaison par les escaliers** : la trémie d'arrivée d'un escalier apparaît en pointillés sur le
  plan de l'étage supérieur, pour placer la trémie au bon endroit
- Vue 3D empilée « maison de poupée » (tous les niveaux à leur hauteur réelle) ou niveau par niveau

### 🗺️ Plan 2D coté
- Pièces **polygonales libres** : rectangle rapide ou forme libre point par point (murs en L,
  couloirs, sous-pentes) ; glissez les sommets, scindez un mur (◈), supprimez un sommet (double-clic)
- **Murs ouverts** : marquez n'importe quel côté comme « ouvert » (cuisine américaine, séjour
  traversant) — pointillés en 2D, aucun mur construit en 3D
- Cotes par mur en mètres/centimètres (longueur éditable au cm), surface calculée par pièce
- 5 types d'ouvertures : porte, **porte d'entrée**, fenêtre, **double fenêtre**, porte-fenêtre
  (largeur, hauteur, allège), plus **fenêtres de toit (Velux)** posées sur le plafond
- Grille avec accrochage 5 cm, outil de mesure, zoom/panoramique
- Raccourcis : `R` pivoter, `D` dupliquer, `Suppr` supprimer, `Échap` désélectionner, `Entrée`
  fermer le polygone en cours

### 🛋️ Ameublement aux vraies dimensions
- Catalogue de ~50 meubles avec dimensions réelles du marché (canapés, lits, rangements,
  luminaires, électroménager, salle de bain…)
- **4 types d'escaliers** comparables (droit, 1/4 tournant, 2/4 tournant, colimaçon) avec leurs
  emprises au sol réelles — marches et sens de montée dessinés sur le plan, volumes 3D à marches
- Distinction meubles **existants** (relevés chez vous, en pointillés) / **projets d'achat**
- **Produit du web** : repérez un meuble ou luminaire sur un site marchand, reportez ses dimensions
  et sa photo depuis la fiche produit, et testez-le immédiatement sur votre plan
- Glisser-déposer, rotation, duplication, édition des dimensions au centimètre

### 🎨 Peinture et matériaux
- Couleur de peinture **par mur** (N/S/E/O), 6 palettes déco professionnelles + code hexadécimal
  libre (relevez la référence couleur sur le site d'une marque de peinture)
- 7 matériaux de sol (parquets, carrelages, béton ciré, tomettes…)

### 🏠 Vue 3D temps réel
- Sols polygonaux extrudés, murs à la vraie hauteur avec ouvertures percées (linteaux, allèges,
  vitrages, vantaux de portes, meneaux de doubles fenêtres), verrières de toit lumineuses
- **Meubles procéduraux reconnaissables** : canapés avec assise/dossier/accoudoirs, lits avec
  matelas et tête de lit, tables sur pieds, chaises, plantes, escaliers à marches — les photos
  produit s'affichent sur la face avant des rangements
- Luminaires avec éclairage simulé, orbite/zoom à la souris, couleurs synchronisées avec le plan

### 📸 Studio Photo — repeindre et meubler sans travaux
- Importez une photo de votre pièce, peignez au pinceau les zones de mur à tester
- Le rendu **préserve les ombres et la texture** du mur (mélange teinte/saturation + assombrissement)
- **Incrustation d'objets en perspective** : projetez la photo d'un meuble (importée d'un site
  marchand ou reprise d'un « produit du web ») sur la photo de votre pièce en ajustant ses 4 coins ;
  opacité et mode « Multiplier » pour intégrer les visuels sur fond blanc, ordre des calques
- **Détourage automatique** du fond blanc des photos produit (remplissage par diffusion depuis les
  bords, contour adouci) — à l'ajout d'un objet, par objet incrusté (réversible), et dans le
  formulaire « Produit du web » du catalogue
- Palettes déco, intensité réglable, gomme, export PNG du rendu pour comparer

### 💾 Projet
- Sauvegarde automatique dans le navigateur (localStorage)
- Export / import du projet complet en JSON, avec migration automatique des anciens formats

## Démarrage

```bash
npm install
npm run dev       # développement (http://localhost:5173)
npm run build     # build de production
npm run preview   # prévisualisation du build
```

## Stack technique

- **React 19 + TypeScript** (strict) — Vite
- **Zustand** — état global avec persistance localStorage
- **Three.js / @react-three/fiber / drei** — vue 3D (chargée à la demande)
- **SVG natif** — éditeur de plan 2D (zoom, cotes, interactions pointeur)
- **Canvas 2D** — repeinture photo (masques normalisés, composition `color` + `multiply`)

Toutes les dimensions internes sont en **mètres** ; l'interface édite en centimètres.

## Architecture

```
src/
├── types.ts                    # Modèle de domaine (niveaux, pièces polygonales, murs, ouvertures, meubles, photos)
├── store/useStore.ts           # Store Zustand + persistance + migrations + niveaux + édition de sommets
├── utils/
│   ├── geometry.ts             # Polygones (aire, centroïde), murs, accrochage, ouvertures
│   ├── homography.ts           # Projection perspective (incrustation photo)
│   └── cutout.ts               # Détourage automatique (diffusion depuis les bords)
├── data/
│   ├── catalog.ts              # Catalogue de meubles et escaliers (dimensions réelles)
│   └── palettes.ts             # Palettes de peinture professionnelles
└── components/
    ├── plan/FloorPlanEditor    # Éditeur 2D SVG (polygones, cotes, ouvertures, Velux, escaliers)
    ├── three/View3D            # Scène 3D (murs percés, meubles procéduraux, verrières)
    ├── photo/PhotoStudio       # Repeinture virtuelle + objets en perspective sur photo
    └── panels/                 # Catalogue + propriétés contextuelles
```
