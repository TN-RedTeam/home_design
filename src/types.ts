// Modèle de domaine — toutes les dimensions sont en MÈTRES.
// L'affichage (cm / m) est géré par les utilitaires de formatage.

export type ID = string;

export interface Vec2 {
  x: number;
  y: number;
}

export type RoomType =
  | 'salon'
  | 'cuisine'
  | 'chambre'
  | 'salle_de_bain'
  | 'bureau'
  | 'salle_a_manger'
  | 'entree'
  | 'couloir'
  | 'wc'
  | 'buanderie'
  | 'dressing'
  | 'terrasse'
  | 'autre';

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  salon: 'Salon',
  cuisine: 'Cuisine',
  chambre: 'Chambre',
  salle_de_bain: 'Salle de bain',
  bureau: 'Bureau',
  salle_a_manger: 'Salle à manger',
  entree: 'Entrée',
  couloir: 'Couloir',
  wc: 'WC',
  buanderie: 'Buanderie',
  dressing: 'Dressing',
  terrasse: 'Terrasse',
  autre: 'Autre',
};

export type OpeningType = 'porte' | 'porte_entree' | 'fenetre' | 'double_fenetre' | 'porte_fenetre';

export const OPENING_LABELS: Record<OpeningType, string> = {
  porte: 'Porte',
  porte_entree: "Porte d'entrée",
  fenetre: 'Fenêtre',
  double_fenetre: 'Double fenêtre',
  porte_fenetre: 'Porte-fenêtre',
};

/** Dimensions standard proposées à la création d'une ouverture. */
export const OPENING_DEFAULTS: Record<OpeningType, { width: number; height: number; sillHeight: number }> = {
  porte: { width: 0.83, height: 2.04, sillHeight: 0 },
  porte_entree: { width: 0.9, height: 2.15, sillHeight: 0 },
  fenetre: { width: 1.2, height: 1.25, sillHeight: 0.9 },
  double_fenetre: { width: 1.4, height: 1.35, sillHeight: 0.9 },
  porte_fenetre: { width: 2.2, height: 2.15, sillHeight: 0 },
};

/** Ouverture (porte / fenêtre) positionnée sur un mur (arête du polygone). */
export interface Opening {
  id: ID;
  type: OpeningType;
  /** Index du mur porteur : arête points[wall] -> points[(wall+1) % n]. */
  wall: number;
  /** Distance en m entre le début du mur et le bord de l'ouverture. */
  offset: number;
  /** Largeur de l'ouverture en m. */
  width: number;
  /** Hauteur de l'ouverture en m. */
  height: number;
  /** Hauteur d'allège (bas de fenêtre) en m — 0 pour une porte. */
  sillHeight: number;
}

/** Mur = arête du polygone de la pièce. `open` = absence de mur (espace ouvert). */
export interface RoomWall {
  color: string;
  open: boolean;
}

/** Fenêtre de toit (Velux) posée sur le plafond d'une pièce. (x, y) = centre, repère du plan. */
export interface RoofWindow {
  id: ID;
  x: number;
  y: number;
  /** Largeur (axe X) en m. */
  width: number;
  /** Longueur (axe Y) en m. */
  length: number;
}

/** Dimensions standard d'une fenêtre de toit (Velux MK04). */
export const ROOF_WINDOW_DEFAULT = { width: 0.78, length: 0.98 };

export type FloorMaterial =
  | 'parquet_chene'
  | 'parquet_fonce'
  | 'carrelage_blanc'
  | 'carrelage_gris'
  | 'beton_cire'
  | 'moquette'
  | 'tomette';

export const FLOOR_LABELS: Record<FloorMaterial, string> = {
  parquet_chene: 'Parquet chêne clair',
  parquet_fonce: 'Parquet foncé',
  carrelage_blanc: 'Carrelage blanc',
  carrelage_gris: 'Carrelage gris',
  beton_cire: 'Béton ciré',
  moquette: 'Moquette',
  tomette: 'Tomettes',
};

export const FLOOR_COLORS: Record<FloorMaterial, string> = {
  parquet_chene: '#c9a26b',
  parquet_fonce: '#6b4a2f',
  carrelage_blanc: '#e8e6e1',
  carrelage_gris: '#9a9a98',
  beton_cire: '#b0aca6',
  moquette: '#8f8a9e',
  tomette: '#b3593a',
};

/**
 * Pièce polygonale. `points` : sommets ordonnés (sens horaire) dans le repère
 * du plan, en mètres. Le mur i relie points[i] à points[(i+1) % n] ;
 * `walls` a exactement la même longueur que `points`.
 */
export interface Room {
  id: ID;
  name: string;
  type: RoomType;
  points: Vec2[];
  walls: RoomWall[];
  /** Hauteur sous plafond en m. */
  height: number;
  floor: FloorMaterial;
  openings: Opening[];
  /** Fenêtres de toit (Velux). */
  roofWindows: RoofWindow[];
}

export type FurnitureCategory =
  | 'canape'
  | 'fauteuil'
  | 'table'
  | 'table_basse'
  | 'chaise'
  | 'lit'
  | 'rangement'
  | 'bureau'
  | 'luminaire'
  | 'electromenager'
  | 'decoration'
  | 'salle_de_bain'
  | 'escalier'
  | 'exterieur';

export const CATEGORY_LABELS: Record<FurnitureCategory, string> = {
  canape: 'Canapés',
  fauteuil: 'Fauteuils',
  table: 'Tables',
  table_basse: 'Tables basses',
  chaise: 'Chaises',
  lit: 'Lits',
  rangement: 'Rangements',
  bureau: 'Bureaux',
  luminaire: 'Luminaires',
  electromenager: 'Électroménager',
  decoration: 'Décoration',
  salle_de_bain: 'Salle de bain',
  escalier: 'Escaliers',
  exterieur: 'Extérieur',
};

/**
 * Forme vue de dessus pour le rendu 2D / 3D.
 * Les formes `stairs_*` déclenchent un rendu spécifique (marches, sens de montée).
 */
export type FurnitureShape =
  | 'rect'
  | 'round'
  | 'lshape'
  | 'stairs_droit'
  | 'stairs_quart'
  | 'stairs_demi'
  | 'stairs_colimacon';

/** Article du catalogue de meubles (dimensions constructeur). */
export interface CatalogItem {
  id: ID;
  name: string;
  category: FurnitureCategory;
  /** Largeur en m (axe X quand rotation = 0). */
  width: number;
  /** Profondeur en m (axe Y quand rotation = 0). */
  depth: number;
  /** Hauteur en m. */
  height: number;
  shape: FurnitureShape;
  /** Couleur par défaut (hex). */
  color: string;
  /** Description courte orientée conseil déco. */
  description?: string;
}

/** Meuble placé sur le plan (existant chez soi ou ajouté depuis le catalogue). */
export interface PlacedFurniture {
  id: ID;
  /** Référence catalogue, absente pour un meuble personnalisé (relevé photo). */
  catalogId?: ID;
  name: string;
  category: FurnitureCategory;
  shape: FurnitureShape;
  /** Centre du meuble dans le repère du plan, en m. */
  x: number;
  y: number;
  /** Rotation en degrés, sens horaire. */
  rotation: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  /** Meuble déjà présent chez soi (relevé) vs projet d'achat. */
  existing: boolean;
  /** Photo du meuble réel (dataURL) pour les meubles relevés. */
  photoUrl?: string;
}

/** Zone de peinture appliquée sur une photo (module Studio Photo). */
export interface PhotoPaintStroke {
  /** Points du tracé en coordonnées normalisées [0..1] de l'image. */
  points: Vec2[];
  /** Rayon du pinceau normalisé par rapport à la largeur de l'image. */
  radius: number;
  /** true = gomme (efface le masque). */
  erase: boolean;
}

/**
 * Objet (meuble, luminaire…) incrusté dans une photo avec mise en
 * perspective : l'image est projetée sur le quadrilatère `quad`.
 */
export interface PhotoOverlay {
  id: ID;
  name: string;
  /** Image de l'objet (dataURL). */
  imageUrl: string;
  /**
   * Quatre coins en coordonnées normalisées [0..1] de la photo, dans
   * l'ordre : haut-gauche, haut-droit, bas-droit, bas-gauche.
   */
  quad: [Vec2, Vec2, Vec2, Vec2];
  /** Opacité [0..1]. */
  opacity: number;
  /** 'multiply' aide à intégrer les photos produit sur fond blanc. */
  blend: 'normal' | 'multiply';
}

/** Photo d'une pièce avec ses retouches de peinture virtuelle et ses objets incrustés. */
export interface RoomPhoto {
  id: ID;
  roomId?: ID;
  name: string;
  /** Image encodée en dataURL. */
  dataUrl: string;
  /** Couleur de peinture testée. */
  paintColor: string;
  /** Intensité du mélange [0..1]. */
  paintOpacity: number;
  strokes: PhotoPaintStroke[];
  /** Objets incrustés en perspective, dessinés du premier (fond) au dernier (devant). */
  overlays: PhotoOverlay[];
  createdAt: number;
}

export interface Project {
  id: ID;
  name: string;
  rooms: Room[];
  furniture: PlacedFurniture[];
  photos: RoomPhoto[];
  updatedAt: number;
}

export type EditorTool = 'select' | 'addRoom' | 'addPoly' | 'measure';
export type ViewMode = 'plan' | '3d' | 'photo';

export interface PaintColor {
  name: string;
  hex: string;
}

export interface PaintPalette {
  name: string;
  description: string;
  colors: PaintColor[];
}

/** Formate une longueur en m vers un affichage lisible (ex: 2,40 m / 85 cm). */
export function formatLength(meters: number): string {
  if (meters < 1) return `${Math.round(meters * 100)} cm`;
  return `${meters.toFixed(2).replace('.', ',')} m`;
}

/** Surface en m² formatée. */
export function formatArea(m2: number): string {
  return `${m2.toFixed(2).replace('.', ',')} m²`;
}

export function uid(): ID {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
