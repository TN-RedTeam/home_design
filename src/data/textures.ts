// Bibliothèque de revêtements fournis avec l'application. Chaque texture est un
// motif SVG *tileable* (le bord droit raccorde le bord gauche, idem haut/bas)
// encodé en data-URL : compact, net à toute échelle, auto-contenu (aucun binaire
// à committer, fonctionne dans l'export/import JSON), chargeable par
// THREE.TextureLoader comme n'importe quelle image.

export type TextureCategory = 'parquet' | 'carrelage' | 'beton' | 'papier_peint';

export const TEXTURE_CATEGORY_LABELS: Record<TextureCategory, string> = {
  parquet: 'Parquets',
  carrelage: 'Carrelages',
  beton: 'Bétons & pierres',
  papier_peint: 'Papiers peints',
};

export interface LibraryTexture {
  id: string;
  name: string;
  category: TextureCategory;
  /** Motif SVG encodé en data-URL. */
  url: string;
  /** Taille réelle conseillée du motif (cm) — pré-remplit l'échelle. */
  suggestedTileCm: number;
  /** Surfaces sur lesquelles la texture est pertinente. */
  surfaces: ('floor' | 'wall')[];
}

/** Encode un fragment SVG (une tuile 100×100) en data-URL. */
function svg(inner: string): string {
  const doc =
    `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'>${inner}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(doc)}`;
}

/** Lames de parquet horizontales décalées (pose à l'anglaise), tileable. */
function parquet(base: string, dark: string, joint: string): string {
  const plank = (y: number, x0: number) => `
    <rect x='${x0}' y='${y}' width='50' height='24' fill='${base}'/>
    <rect x='${x0}' y='${y}' width='50' height='24' fill='none' stroke='${joint}' stroke-width='1'/>
    <rect x='${x0 + 8}' y='${y + 6}' width='30' height='2' fill='${dark}' opacity='0.25'/>`;
  return svg(`
    <rect width='100' height='100' fill='${base}'/>
    ${plank(2, 0)}${plank(2, 50)}
    ${plank(27, -25)}${plank(27, 25)}${plank(27, 75)}
    ${plank(52, 0)}${plank(52, 50)}
    ${plank(77, -25)}${plank(77, 25)}${plank(77, 75)}
  `);
}

/** Carreaux carrés avec joint, tileable (2×2 carreaux de 50 dans la tuile de 100). */
function carrelage(fill: string, joint: string, speckle?: string): string {
  const tile = (x: number, y: number) => `
    <rect x='${x + 1}' y='${y + 1}' width='48' height='48' fill='${fill}'/>
    ${speckle ? `<circle cx='${x + 15}' cy='${y + 20}' r='1.5' fill='${speckle}' opacity='0.4'/><circle cx='${x + 34}' cy='${y + 33}' r='1' fill='${speckle}' opacity='0.4'/>` : ''}`;
  return svg(`
    <rect width='100' height='100' fill='${joint}'/>
    ${tile(0, 0)}${tile(50, 0)}${tile(0, 50)}${tile(50, 50)}
  `);
}

/** Aplat légèrement moucheté (béton / pierre), tileable. */
function beton(fill: string, fleck: string): string {
  let dots = '';
  // Grille pseudo-aléatoire déterministe, bornée à l'intérieur pour rester tileable.
  const pts = [
    [12, 18], [30, 40], [55, 12], [72, 34], [88, 60], [20, 70], [45, 82], [66, 74], [82, 88], [38, 8], [8, 52], [60, 55],
  ];
  for (const [x, y] of pts) dots += `<circle cx='${x}' cy='${y}' r='${1 + ((x * y) % 3) * 0.4}' fill='${fleck}' opacity='0.18'/>`;
  return svg(`<rect width='100' height='100' fill='${fill}'/>${dots}`);
}

/** Papier peint à rayures verticales fines, tileable. */
function rayures(base: string, stripe: string): string {
  return svg(`
    <rect width='100' height='100' fill='${base}'/>
    <rect x='16' y='0' width='6' height='100' fill='${stripe}' opacity='0.5'/>
    <rect x='49' y='0' width='6' height='100' fill='${stripe}' opacity='0.5'/>
    <rect x='82' y='0' width='6' height='100' fill='${stripe}' opacity='0.5'/>
  `);
}

/** Papier peint à motif floral/pois discret, tileable. */
function pois(base: string, dot: string): string {
  const d = (x: number, y: number) => `<circle cx='${x}' cy='${y}' r='4' fill='${dot}' opacity='0.35'/>`;
  return svg(`
    <rect width='100' height='100' fill='${base}'/>
    ${d(25, 25)}${d(75, 25)}${d(50, 50)}${d(0, 50)}${d(100, 50)}${d(25, 75)}${d(75, 75)}${d(0, 0)}${d(100, 0)}${d(0, 100)}${d(100, 100)}
  `);
}

export const TEXTURE_LIBRARY: LibraryTexture[] = [
  { id: 'parquet-chene', name: 'Parquet chêne', category: 'parquet', url: parquet('#c9a26b', '#6b4a2f', '#a07f4f'), suggestedTileCm: 100, surfaces: ['floor', 'wall'] },
  { id: 'parquet-fonce', name: 'Parquet noyer', category: 'parquet', url: parquet('#7a5535', '#3d2817', '#5c3f26'), suggestedTileCm: 100, surfaces: ['floor', 'wall'] },
  { id: 'parquet-gris', name: 'Parquet gris', category: 'parquet', url: parquet('#a9a49b', '#6f6a62', '#8b867d'), suggestedTileCm: 100, surfaces: ['floor', 'wall'] },
  { id: 'carrelage-blanc', name: 'Carrelage blanc', category: 'carrelage', url: carrelage('#eceae4', '#c7c4bc'), suggestedTileCm: 30, surfaces: ['floor', 'wall'] },
  { id: 'carrelage-gris', name: 'Carrelage gris', category: 'carrelage', url: carrelage('#9a9793', '#6d6a66', '#5a5754'), suggestedTileCm: 30, surfaces: ['floor', 'wall'] },
  { id: 'carrelage-noir', name: 'Damier noir', category: 'carrelage', url: carrelage('#2f2e30', '#151416', '#555'), suggestedTileCm: 30, surfaces: ['floor', 'wall'] },
  { id: 'tomette', name: 'Tomettes', category: 'carrelage', url: carrelage('#b3593a', '#7a3a25', '#8f4630'), suggestedTileCm: 20, surfaces: ['floor'] },
  { id: 'beton-cire', name: 'Béton ciré', category: 'beton', url: beton('#b0aca6', '#7d7a75'), suggestedTileCm: 120, surfaces: ['floor', 'wall'] },
  { id: 'beton-brut', name: 'Béton brut', category: 'beton', url: beton('#8f8c88', '#5f5c58'), suggestedTileCm: 120, surfaces: ['floor', 'wall'] },
  { id: 'pierre-claire', name: 'Pierre claire', category: 'beton', url: beton('#d8d2c4', '#a49c8a'), suggestedTileCm: 60, surfaces: ['floor', 'wall'] },
  { id: 'papier-lin', name: 'Lin uni', category: 'papier_peint', url: beton('#e7ddce', '#c3b7a3'), suggestedTileCm: 50, surfaces: ['wall'] },
  { id: 'papier-rayures', name: 'Rayures', category: 'papier_peint', url: rayures('#eae4d8', '#b9a98c'), suggestedTileCm: 50, surfaces: ['wall'] },
  { id: 'papier-vert', name: 'Rayures vertes', category: 'papier_peint', url: rayures('#dfe6da', '#6f8a5f'), suggestedTileCm: 50, surfaces: ['wall'] },
  { id: 'papier-pois', name: 'Pois', category: 'papier_peint', url: pois('#eae7f0', '#8f88a8'), suggestedTileCm: 40, surfaces: ['wall'] },
];

export function findLibraryTexture(id: string): LibraryTexture | undefined {
  return TEXTURE_LIBRARY.find((t) => t.id === id);
}

/** Résout une TextureRef vers son URL/data-URL chargeable, ou null si introuvable. */
export function textureUrl(ref: { kind: 'library'; id: string } | { kind: 'custom'; dataUrl: string }): string | null {
  if (ref.kind === 'custom') return ref.dataUrl;
  return findLibraryTexture(ref.id)?.url ?? null;
}
