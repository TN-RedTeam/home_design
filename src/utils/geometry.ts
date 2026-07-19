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
