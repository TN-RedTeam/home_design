# Home Design Studio

Application web professionnelle de **simulation de décoration intérieure** : cartographiez votre maison
pièce par pièce avec les vraies dimensions, ameublez-la virtuellement, testez des couleurs de peinture
et visualisez le résultat en 3D — avant d'acheter ou de repeindre quoi que ce soit.

## Fonctionnalités

### 🗺️ Plan 2D coté
- Dessin de pièces à la souris avec dimensions réelles (largeur, profondeur, hauteur sous plafond)
- Cotes affichées en mètres/centimètres, surface calculée par pièce et pour le projet
- Portes, fenêtres et portes-fenêtres positionnables sur chaque mur (largeur, hauteur, allège)
- Grille avec accrochage 5 cm, outil de mesure, zoom/panoramique
- Raccourcis : `R` pivoter, `D` dupliquer, `Suppr` supprimer, `Échap` désélectionner

### 🛋️ Ameublement aux vraies dimensions
- Catalogue de ~50 meubles avec dimensions réelles du marché (canapés, lits, rangements,
  luminaires, électroménager, salle de bain…)
- Distinction meubles **existants** (relevés chez vous, en pointillés) / **projets d'achat**
- **Produit du web** : repérez un meuble ou luminaire sur un site marchand, reportez ses dimensions
  et sa photo depuis la fiche produit, et testez-le immédiatement sur votre plan
- Glisser-déposer, rotation, duplication, édition des dimensions au centimètre

### 🎨 Peinture et matériaux
- Couleur de peinture **par mur** (N/S/E/O), 6 palettes déco professionnelles + code hexadécimal
  libre (relevez la référence couleur sur le site d'une marque de peinture)
- 7 matériaux de sol (parquets, carrelages, béton ciré, tomettes…)

### 🏠 Vue 3D temps réel
- Murs extrudés à la vraie hauteur avec ouvertures percées (linteaux, allèges, vitrages)
- Meubles volumétriques, luminaires avec éclairage simulé
- Orbite / zoom à la souris, couleurs de murs et sols synchronisées avec le plan

### 📸 Studio Photo — repeindre sans pinceau
- Importez une photo de votre pièce, peignez au pinceau les zones de mur à tester
- Le rendu **préserve les ombres et la texture** du mur (mélange teinte/saturation + assombrissement)
- Palettes déco, intensité réglable, gomme, export PNG du rendu pour comparer

### 💾 Projet
- Sauvegarde automatique dans le navigateur (localStorage)
- Export / import du projet complet en JSON

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
├── types.ts                    # Modèle de domaine (pièces, murs, ouvertures, meubles, photos)
├── store/useStore.ts           # Store Zustand + persistance
├── utils/geometry.ts           # Accrochage, segments d'ouvertures, bornes du plan
├── data/
│   ├── catalog.ts              # Catalogue de meubles (dimensions réelles)
│   └── palettes.ts             # Palettes de peinture professionnelles
└── components/
    ├── plan/FloorPlanEditor    # Éditeur 2D SVG (pièces, cotes, ouvertures, meubles)
    ├── three/View3D            # Scène 3D (murs percés, meubles, lumières)
    ├── photo/PhotoStudio       # Repeinture virtuelle sur photo
    └── panels/                 # Catalogue + propriétés contextuelles
```
