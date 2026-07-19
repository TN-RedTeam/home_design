import type { PaintColor, PaintPalette } from '../types';

export const PAINT_PALETTES: PaintPalette[] = [
  {
    name: 'Neutres Chaleureux',
    description: 'Palette intemporelle de blancs cassés, lin et grège pour une ambiance apaisante et lumineuse.',
    colors: [
      { name: 'Blanc cassé', hex: '#f5f3f0' },
      { name: 'Lin naturel', hex: '#ece8e0' },
      { name: 'Grège doux', hex: '#e8dfd5' },
      { name: 'Beige chaud', hex: '#d9cfc3' },
      { name: 'Taupe clair', hex: '#c9bfb3' },
      { name: 'Greige', hex: '#c4b5a0' },
      { name: 'Chanvre', hex: '#b8a896' },
      { name: 'Lin gris', hex: '#a89e94' },
    ],
  },
  {
    name: 'Terracotta & Argile',
    description: 'Palette chaleureuse inspirée des terres méditerranéennes et des matériaux naturels.',
    colors: [
      { name: 'Terracotta clair', hex: '#d9a574' },
      { name: 'Ocre doré', hex: '#c9934f' },
      { name: 'Terracotta', hex: '#b8734a' },
      { name: 'Argile chaude', hex: '#a85a3a' },
      { name: 'Ocre foncé', hex: '#945a3a' },
      { name: 'Brique ancienne', hex: '#8a4a35' },
      { name: 'Terracotta foncé', hex: '#704a2f' },
      { name: 'Terre d\'ombre', hex: '#5a3a2a' },
    ],
  },
  {
    name: 'Bleus Profonds',
    description: 'Palette élégante de bleus canard, marine et orage pour une atmosphère intemporelle.',
    colors: [
      { name: 'Bleu ciel', hex: '#b0d0e8' },
      { name: 'Bleu poudré', hex: '#8ab8d8' },
      { name: 'Bleu canard', hex: '#5a9ab0' },
      { name: 'Bleu gris-vert', hex: '#4a7a8a' },
      { name: 'Bleu océan', hex: '#3a6a7a' },
      { name: 'Bleu marine', hex: '#2a4a6a' },
      { name: 'Bleu orage', hex: '#1a3a5a' },
      { name: 'Bleu nuit', hex: '#0a2a4a' },
    ],
  },
  {
    name: 'Verts Nature',
    description: 'Palette apaisante de verts sauge, olive et forêt pour une connexion à la nature.',
    colors: [
      { name: 'Menthe pâle', hex: '#d0dcc8' },
      { name: 'Sauge claire', hex: '#c0cdb8' },
      { name: 'Sauge doux', hex: '#a8bea0' },
      { name: 'Olive clair', hex: '#8aa888' },
      { name: 'Vert amande', hex: '#7a9878' },
      { name: 'Vert forêt', hex: '#6a8a70' },
      { name: 'Vert profond', hex: '#5a7a60' },
      { name: 'Vert foncé', hex: '#3a5a40' },
    ],
  },
  {
    name: 'Audacieux',
    description: 'Palette sophistiquée de bordeaux, aubergine et ocre pour exprimer la personnalité.',
    colors: [
      { name: 'Ocre riche', hex: '#d9c03a' },
      { name: 'Ocre foncé', hex: '#c9a43a' },
      { name: 'Bordeaux clair', hex: '#a87050' },
      { name: 'Aubergine douce', hex: '#8a5a70' },
      { name: 'Bordeaux', hex: '#8a4a50' },
      { name: 'Aubergine', hex: '#6a3a60' },
      { name: 'Bordeaux foncé', hex: '#5a2a40' },
      { name: 'Prune', hex: '#4a1a3a' },
    ],
  },
  {
    name: 'Scandinave',
    description: 'Palette minimaliste de gris clairs, blancs et bleu pâle pour simplicité épurée.',
    colors: [
      { name: 'Blanc pur', hex: '#ffffff' },
      { name: 'Blanc cassé', hex: '#f5f3f0' },
      { name: 'Gris très clair', hex: '#e8e6e0' },
      { name: 'Gris clair', hex: '#d0ccc8' },
      { name: 'Gris moyen', hex: '#b8b4b0' },
      { name: 'Bleu pâle', hex: '#c8d8e8' },
      { name: 'Gris froid', hex: '#a0a8b0' },
      { name: 'Gris pierre', hex: '#8a8a8a' },
    ],
  },
];

export const WOOD_TONES: PaintColor[] = [
  { name: 'Chêne clair', hex: '#d4a574' },
  { name: 'Chêne naturel', hex: '#c9a26b' },
  { name: 'Chêne doré', hex: '#b08a5a' },
  { name: 'Noyer moyen', hex: '#8b6f47' },
  { name: 'Chêne foncé', hex: '#6b4a2f' },
  { name: 'Wengé', hex: '#3a2a1a' },
];
