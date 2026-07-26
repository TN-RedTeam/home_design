import type { Opening, Room, Vec2 } from '../types';

/** Pas d'accrochage par défaut (5 cm). */
export const SNAP_STEP = 0.05;

export function snapTo(value: number, enabled: boolean, step = SNAP_STEP): number {
  if (!enabled) return value;
  return Math.round(value / step) * step;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Sommets d'un rectangle, ordre horaire depuis le coin haut-gauche. */
export function rectPoints(x: number, y: number, w: number, l: number): Vec2[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + l },
    { x, y: y + l },
  ];
}

/**
 * Si le polygone est un rectangle aligné sur les axes (4 sommets, arêtes
 * strictement horizontales/verticales), renvoie sa taille et son coin
 * haut-gauche ; sinon `null`. Sert à proposer l'édition largeur/longueur.
 */
export function rectSize(points: Vec2[]): { x: number; y: number; width: number; length: number } | null {
  if (points.length !== 4) return null;
  const eps = 1e-4;
  // Chaque arête doit être strictement horizontale ou verticale, et alterner
  // d'orientation avec la suivante (H,V,H,V ou V,H,V,H).
  for (let i = 0; i < 4; i++) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const c = points[(i + 2) % 4];
    const horizontal = Math.abs(a.y - b.y) < eps && Math.abs(a.x - b.x) > eps;
    const vertical = Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) > eps;
    if (!horizontal && !vertical) return null;
    const nextHorizontal = Math.abs(b.y - c.y) < eps && Math.abs(b.x - c.x) > eps;
    if (horizontal === nextHorizontal) return null;
  }
  const bnds = polygonBounds(points);
  const width = bnds.maxX - bnds.minX;
  const length = bnds.maxY - bnds.minY;
  if (width < eps || length < eps) return null;
  return { x: bnds.minX, y: bnds.minY, width, length };
}

/** Aire d'un polygone (formule du lacet), toujours positive. */
export function polygonArea(points: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Centroïde du polygone (barycentre pondéré par l'aire ; repli sur la moyenne si dégénéré). */
export function polygonCentroid(points: Vec2[]): Vec2 {
  let sx = 0, sy = 0, sa = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    sa += cross;
    sx += (a.x + b.x) * cross;
    sy += (a.y + b.y) * cross;
  }
  if (Math.abs(sa) < 1e-9) {
    const n = points.length || 1;
    return {
      x: points.reduce((acc, p) => acc + p.x, 0) / n,
      y: points.reduce((acc, p) => acc + p.y, 0) / n,
    };
  }
  return { x: sx / (3 * sa), y: sy / (3 * sa) };
}

export function polygonBounds(points: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Boîte englobante de toutes les pièces, avec marge. */
export function planBounds(rooms: Room[], margin = 2): { minX: number; minY: number; maxX: number; maxY: number } {
  if (rooms.length === 0) return { minX: -margin, minY: -margin, maxX: 10 + margin, maxY: 8 + margin };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rooms) {
    const b = polygonBounds(r.points);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

/** Extrémités du mur i (arête points[i] -> points[i+1]). */
export function wallEndpoints(room: Room, wall: number): { a: Vec2; b: Vec2 } {
  const n = room.points.length;
  return { a: room.points[wall % n], b: room.points[(wall + 1) % n] };
}

export function wallLength(room: Room, wall: number): number {
  const { a, b } = wallEndpoints(room, wall);
  return dist(a, b);
}

/** Angle du mur i en degrés (0 = vers +X). */
export function wallAngle(room: Room, wall: number): number {
  const { a, b } = wallEndpoints(room, wall);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** Largeur minimale d'une ouverture (30 cm). */
export const MIN_OPENING = 0.3;

interface OpeningLike {
  id: string;
  wall: number;
  offset: number;
  width: number;
  height: number;
  sillHeight: number;
  type: string;
}

/** Une porte n'a pas d'allège (bas au sol). */
function isDoor(type: string): boolean {
  return type === 'porte' || type === 'porte_entree' || type === 'porte_fenetre';
}

/**
 * Bornes libres [low, high] le long du mur autour de la position `center`,
 * limitées par les ouvertures voisines (celles à gauche/droite de `center`)
 * et par les extrémités du mur [0, wallLen].
 */
function freeSpan(room: Room, wall: number, wallLen: number, center: number, ignoreId: string): { low: number; high: number } {
  let low = 0;
  let high = wallLen;
  for (const o of room.openings) {
    if (o.id === ignoreId || o.wall !== wall) continue;
    const oEnd = o.offset + o.width;
    if (oEnd <= center) low = Math.max(low, oEnd); // voisine à gauche
    else if (o.offset >= center) high = Math.min(high, o.offset); // voisine à droite
    // (une voisine chevauchant center ne devrait pas exister sur un mur bien formé)
  }
  return { low, high };
}

/**
 * Redimensionnement d'un bord d'ouverture À LA SOURIS : le bord opposé est
 * ancré, le bord tiré s'arrête au bord du mur ou d'une voisine, la largeur
 * rogne (jamais de glissement). `along` = position visée le long du mur (m).
 */
export function edgeResizeOpening(
  room: Room,
  o: OpeningLike,
  edge: 'start' | 'end',
  along: number
): { offset: number; width: number } {
  const wallLen = wallLength(room, o.wall);
  const start = o.offset;
  const end = o.offset + o.width;
  if (edge === 'end') {
    // start ancré ; le bord droit bute sur la voisine de droite ou le mur.
    const { high } = freeSpan(room, o.wall, wallLen, start + 1e-6, o.id);
    const newEnd = clamp(along, start + MIN_OPENING, high);
    return { offset: start, width: newEnd - start };
  }
  // start tiré ; end ancré ; bute sur la voisine de gauche ou 0.
  const { low } = freeSpan(room, o.wall, wallLen, end - 1e-6, o.id);
  const newStart = clamp(along, low, end - MIN_OPENING);
  return { offset: newStart, width: end - newStart };
}

/**
 * Corrige une ouverture après une édition clavier ou un changement externe
 * (mur, position) : applique les 3 clamps. Comportement « translate-pour-
 * rentrer » — si l'ouverture se retrouve sur une voisine ou hors du mur, on
 * la ramène dans le trou libre le plus proche (et on rogne seulement si ce
 * trou est plus étroit que la largeur). L'allège des portes est forcée à 0.
 */
export function fitOpening(room: Room, o: OpeningLike): { offset: number; width: number; height: number; sillHeight: number } {
  const wallLen = wallLength(room, o.wall);
  // Largeur : min 30 cm, jamais plus large que le mur entier.
  let width = clamp(o.width, MIN_OPENING, Math.max(MIN_OPENING, wallLen));
  // Trou libre autour du centre actuel de l'ouverture.
  const center = clamp(o.offset + width / 2, 0, wallLen);
  const { low, high } = freeSpan(room, o.wall, wallLen, center, o.id);
  const gap = high - low;
  if (width > gap) width = Math.max(MIN_OPENING, gap);
  // Translate dans [low, high - width].
  const offset = clamp(o.offset, low, Math.max(low, high - width));
  // Hauteur et allège (verticales).
  const roomH = room.height;
  const sillHeight = isDoor(o.type) ? 0 : clamp(o.sillHeight, 0, Math.max(0, roomH - MIN_OPENING));
  const height = clamp(o.height, MIN_OPENING, Math.max(MIN_OPENING, roomH - sillHeight));
  return { offset, width, height, sillHeight };
}

/**
 * Segment d'une ouverture le long de son mur, dans le repère du plan (mètres),
 * avec l'angle du mur pour l'orientation du dessin.
 */
export function openingSegment(room: Room, o: Opening): { x1: number; y1: number; x2: number; y2: number; angle: number } {
  const { a, b } = wallEndpoints(room, o.wall);
  const len = dist(a, b);
  if (len < 1e-9) return { x1: a.x, y1: a.y, x2: a.x, y2: a.y, angle: 0 };
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const off = clamp(o.offset, 0, Math.max(0, len - o.width));
  return {
    x1: a.x + ux * off,
    y1: a.y + uy * off,
    x2: a.x + ux * (off + o.width),
    y2: a.y + uy * (off + o.width),
    angle: (Math.atan2(uy, ux) * 180) / Math.PI,
  };
}

/** Nouveau tableau de sommets où le mur i est porté à la longueur `len` (déplace le sommet i+1). */
export function withEdgeLength(points: Vec2[], wall: number, len: number): Vec2[] {
  const n = points.length;
  const a = points[wall % n];
  const b = points[(wall + 1) % n];
  const cur = dist(a, b);
  if (cur < 1e-9 || len <= 0) return points;
  const ux = (b.x - a.x) / cur;
  const uy = (b.y - a.y) / cur;
  return points.map((p, i) => (i === (wall + 1) % n ? { x: a.x + ux * len, y: a.y + uy * len } : p));
}

export function translatePoints(points: Vec2[], dx: number, dy: number): Vec2[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Coins du rectangle d'emprise d'un meuble (rotation comprise), repère du plan. */
export function furnitureCorners(f: { x: number; y: number; width: number; depth: number; rotation: number }): Vec2[] {
  const a = (f.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const hw = f.width / 2;
  const hd = f.depth / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => ({ x: f.x + p.x * cos - p.y * sin, y: f.y + p.x * sin + p.y * cos }));
}

/** Collision entre deux rectangles orientés (théorème des axes séparateurs). */
export function orientedRectsCollide(a: Vec2[], b: Vec2[]): boolean {
  for (const rect of [a, b]) {
    for (let i = 0; i < rect.length; i++) {
      const p1 = rect[i];
      const p2 = rect[(i + 1) % rect.length];
      // Axe normal à l'arête.
      const nx = p2.y - p1.y;
      const ny = p1.x - p2.x;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const p of a) {
        const proj = p.x * nx + p.y * ny;
        minA = Math.min(minA, proj);
        maxA = Math.max(maxA, proj);
      }
      for (const p of b) {
        const proj = p.x * nx + p.y * ny;
        minB = Math.min(minB, proj);
        maxB = Math.max(maxB, proj);
      }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

export interface PlacementCheck {
  /** Le centre est dans une pièce du niveau. */
  inRoom: boolean;
  /** Chevauche un autre meuble du niveau (tapis et objets plats ignorés). */
  collides: boolean;
  valid: boolean;
}

/** Un meuble est plat (tapis…) s'il fait moins de 6 cm de haut : pas de collision. */
const FLAT_H = 0.06;

/** Validité d'un emplacement de meuble à la façon d'un mode construction de jeu. */
export function checkPlacement(
  rooms: Room[],
  furniture: { id: string; floorId: string; x: number; y: number; width: number; depth: number; rotation: number; height: number }[],
  floorId: string,
  cand: { x: number; y: number; width: number; depth: number; rotation: number; height: number },
  ignoreId?: string
): PlacementCheck {
  const inRoom = rooms.some((r) => r.floorId === floorId && pointInPolygon({ x: cand.x, y: cand.y }, r.points));
  let collides = false;
  if (cand.height >= FLAT_H) {
    const candCorners = furnitureCorners(cand);
    for (const other of furniture) {
      if (other.id === ignoreId || other.floorId !== floorId || other.height < FLAT_H) continue;
      if (orientedRectsCollide(candCorners, furnitureCorners(other))) {
        collides = true;
        break;
      }
    }
  }
  return { inRoom, collides, valid: inRoom && !collides };
}

/** Test d'appartenance d'un point au polygone (ray casting). */
export function pointInPolygon(p: Vec2, points: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
